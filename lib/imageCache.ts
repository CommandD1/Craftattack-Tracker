import "server-only";
import { craftAttackPausedResponse, fetchCraftAttack, USER_AGENT } from "./craftattackFetch";
import { getDb } from "./db";

/**
 * Bilder (Köpfe, Skins) mit Zwischenspeicher in der Datenbank. Quellen werden der Reihe nach versucht:
 * frischer Eintrag → Abruf (bei Erfolg gespeichert) → alter Eintrag → nächste Quelle. So bleiben Köpfe sichtbar,
 * auch wenn eine Quelle sperrt oder pausiert, und überstehen jeden Deploy.
 */

const FRESH_MS = 24 * 60 * 60_000;
const CACHE_HEADER = "public, max-age=86400, stale-while-revalidate=604800";

export interface ImageSource {
  /** Schlüssel im Zwischenspeicher, z. B. `ca-head:zarbex` */
  key: string;
  /** Abruf; `null` = diesmal nicht versuchen (Quelle pausiert, bekanntermaßen nicht vorhanden) */
  load: () => Promise<Response | null>;
}

async function getCached(key: string): Promise<{ type: string; body: Buffer; at: number } | null> {
  const db = await getDb();
  const r = (await db.query<{ content_type: string; body: Buffer; fetched_at: Date }>(`SELECT content_type, body, fetched_at FROM image_cache WHERE key = $1`, [key])).rows[0];
  return r ? { type: r.content_type, body: r.body, at: new Date(r.fetched_at).getTime() } : null;
}

async function saveCached(key: string, type: string, body: Buffer) {
  const db = await getDb();
  await db.query(
    `INSERT INTO image_cache (key, content_type, body, fetched_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, body = EXCLUDED.body, fetched_at = now()`,
    [key, type, body],
  );
}

const image = (type: string, body: Buffer) =>
  new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": CACHE_HEADER } });

export async function serveImage(sources: ImageSource[]): Promise<Response> {
  for (const s of sources) {
    const hit = await getCached(s.key).catch(() => null);
    if (hit && Date.now() - hit.at < FRESH_MS) return image(hit.type, hit.body);
    try {
      const r = await s.load();
      if (r?.ok) {
        const type = r.headers.get("content-type") ?? "image/png";
        const body = Buffer.from(await r.arrayBuffer());
        if (type.startsWith("image/") && body.length > 0) {
          await saveCached(s.key, type, body).catch((err: unknown) => console.warn("[bild] Speichern fehlgeschlagen:", err instanceof Error ? err.message : err));
          return image(type, body);
        }
      }
    } catch {
      /* Quelle nicht erreichbar: alter Eintrag oder nächste Quelle */
    }
    if (hit) return image(hit.type, hit.body);
  }
  return new Response(null, { status: 404 });
}

/** Bilder, die craftattack.one nicht hat (404), einen Tag lang nicht erneut anfragen */
const missing = new Map<string, number>();

/** Quelle craftattack.one: übersprungen, solange Anfragen pausiert sind (nach einer Sperre) oder das Bild fehlt */
export function craftAttackImage(key: string, url: string): ImageSource {
  return {
    key,
    load: async () => {
      if (craftAttackPausedResponse(url)) return null;
      const miss = missing.get(url);
      if (miss && Date.now() - miss < FRESH_MS) return null;
      const r = await fetchCraftAttack(url, { headers: { "user-agent": USER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (r.status === 404) missing.set(url, Date.now());
      return r;
    },
  };
}

/** Quelle über `fetch` (z. B. mc-heads.net) */
export function webImage(key: string, url: string): ImageSource {
  return { key, load: () => fetch(url, { headers: { "user-agent": USER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(10_000) }) };
}
