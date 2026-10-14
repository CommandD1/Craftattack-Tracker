import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/neonAuth";
import { FILES_BUCKET, objectStorage } from "@/lib/objectStorage";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;

async function readBoundedFormData(request: Request): Promise<FormData | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
}

interface UserFileRow {
  id: string;
  file_name: string;
  size_bytes: number;
  created_at: Date;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Bitte anmelden." }, { status: 401 });

  const db = await getDb();
  const { rows } = await db.query<UserFileRow>(
    `SELECT id, file_name, size_bytes, created_at
       FROM user_files
      WHERE owner_id = $1
      ORDER BY created_at DESC`,
    [user.id],
  );

  return NextResponse.json({
    files: rows.map((file) => ({
      id: file.id,
      name: file.file_name,
      size: file.size_bytes,
      createdAt: file.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Bitte anmelden." }, { status: 401 });

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return NextResponse.json({ error: "Ungültige Content-Length." }, { status: 400 });
    }
    if (contentLength > MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD) {
      return NextResponse.json({ error: "Datei ist größer als 10 MiB." }, { status: 413 });
    }
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return NextResponse.json({ error: "Multipart-Formular erwartet." }, { status: 415 });
  }

  const form = await readBoundedFormData(request);
  if (!form) return NextResponse.json({ error: "Datei ist größer als 10 MiB." }, { status: 413 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Leere Dateien können nicht hochgeladen werden." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Datei ist größer als 10 MiB." }, { status: 413 });
  }

  const name = file.name.trim().slice(0, 255);
  if (!name) return NextResponse.json({ error: "Dateiname fehlt." }, { status: 400 });

  const id = randomUUID();
  const objectKey = `users/${encodeURIComponent(user.id)}/${id}`;
  await objectStorage.send(
    new PutObjectCommand({
      Bucket: FILES_BUCKET,
      Key: objectKey,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentLength: file.size,
      ContentType: "application/octet-stream",
    }),
  );

  try {
    const db = await getDb();
    await db.query(
      `INSERT INTO user_files (id, owner_id, object_key, file_name, size_bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, user.id, objectKey, name, file.size],
    );
  } catch (error) {
    try {
      await objectStorage.send(new DeleteObjectCommand({ Bucket: FILES_BUCKET, Key: objectKey }));
    } catch (cleanupError) {
      console.error("[files] Upload konnte nach Datenbankfehler nicht bereinigt werden:", cleanupError);
    }
    throw error;
  }

  return NextResponse.json({ file: { id, name, size: file.size } }, { status: 201 });
}
