import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Interne Seiten (/intern/…): Zugang nur mit `?key=` gleich INTERN_KEY (Server-Umgebung). Der Code ist öffentlich,
 * der Pfad also bekannt; ohne passenden Schlüssel (oder ohne gesetzten INTERN_KEY) gibt es eine gewöhnliche 404.
 */
export function internAllowed(key: unknown): key is string {
  const secret = process.env.INTERN_KEY ?? "";
  if (secret.length < 16 || typeof key !== "string") return false;
  const a = Buffer.from(key);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
