import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/neonAuth";
import { FILES_BUCKET, objectStorage } from "@/lib/objectStorage";

interface UserFileRow {
  object_key: string;
  file_name: string;
}

export async function GET(_request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Bitte anmelden." }, { status: 401 });

  const { id } = await params;
  const db = await getDb();
  const { rows } = await db.query<UserFileRow>(
    `SELECT object_key, file_name
       FROM user_files
      WHERE id = $1 AND owner_id = $2`,
    [id, user.id],
  );
  const file = rows[0];
  if (!file) return NextResponse.json({ error: "Datei nicht gefunden." }, { status: 404 });

  const object = await objectStorage.send(
    new GetObjectCommand({ Bucket: FILES_BUCKET, Key: file.object_key }),
  );
  if (!object.Body) throw new Error(`Object storage returned an empty body for file ${id}`);

  const body = await object.Body.transformToByteArray();
  const responseBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(responseBody).set(body);
  return new Response(responseBody, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "content-length": String(body.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
