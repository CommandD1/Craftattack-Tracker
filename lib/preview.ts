import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { previewKeyOk } from "./previewKey";

/** Schlüssel aus der Adresse prüfen (zusätzlich zu proxy.ts); falsch → 404. Liefert den Basis-Pfad /vorschau/<key>. */
export async function previewGate(params: Promise<{ key: string }>): Promise<string> {
  await connection();
  const { key } = await params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  if (!ok) notFound();
  return `/vorschau/${encodeURIComponent(key)}`;
}

/** Detailseite eines Ereignisses in der Vorschau */
export const previewEventHref = (base: string, id: string) => `${base}/ereignis/${encodeURIComponent(id)}`;
