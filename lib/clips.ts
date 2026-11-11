import "server-only";
import { getDb } from "./db";

/** Ein Twitch-Clip aus twitch_clips (geholt von lib/twitchHistory.ts) */
export interface Clip {
  id: string;
  player: string;
  name: string;
  uuid: string;
  at: string;
  title: string;
  views: number;
  seconds: number;
  url: string;
  thumbnail: string | null;
  creator: string | null;
}

/**
 * Meistgesehene Clips aus der Zeit auf dem Server (CraftAttack, nicht andere Inhalte): eines Spielers (`player`) oder aller, optional nur der letzten `hours` Stunden. Je Kanal
 * höchstens `perPlayer`, damit ein großer Streamer nicht die ganze Liste füllt.
 */
export async function getTopClips({ player, hours, limit = 8, perPlayer = 2 }: { player?: string; hours?: number; limit?: number; perPlayer?: number }): Promise<Clip[]> {
  const db = await getDb();
  const rows = (
    await db.query<{ id: string; player: string; name: string; uuid: string; created_at: Date; title: string; view_count: number; duration: number; url: string; thumbnail: string | null; creator_name: string | null }>(
      `SELECT * FROM (
         SELECT c.*, p.name, p.uuid, row_number() OVER (PARTITION BY c.player ORDER BY c.view_count DESC) AS n
           FROM twitch_clips c JOIN players p ON p.id = c.player
          WHERE c.on_server AND ($1::text IS NULL OR c.player = $1) AND ($2::int IS NULL OR c.created_at >= now() - make_interval(hours => $2))
       ) x
       WHERE $1::text IS NOT NULL OR n <= $3
       ORDER BY view_count DESC
       LIMIT $4`,
      [player ?? null, hours ?? null, perPlayer, limit],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    player: r.player,
    name: r.name,
    uuid: r.uuid,
    at: r.created_at.toISOString(),
    title: r.title,
    views: r.view_count,
    seconds: Math.round(r.duration),
    url: r.url,
    // Über den eigenen Server (app/api/clip-thumb): der Browser verbindet sich so nicht ohne Einwilligung mit Twitch
    thumbnail: r.thumbnail ? `/api/clip-thumb/${encodeURIComponent(r.id)}` : null,
    creator: r.creator_name,
  }));
}

/** Nur diese Twitch-Adressen werden für Vorschaubilder abgerufen (kein offener Bild-Proxy) */
const THUMB_HOSTS = new Set(["static-cdn.jtvnw.net", "clips-media-assets2.twitch.tv"]);

/** Gespeicherte Vorschaubild-Adresse eines Clips, sofern sie auf Twitchs CDN zeigt */
export async function getClipThumbnailUrl(id: string): Promise<string | null> {
  const db = await getDb();
  const url = (await db.query<{ thumbnail: string | null }>(`SELECT thumbnail FROM twitch_clips WHERE id = $1`, [id])).rows[0]?.thumbnail;
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && THUMB_HOSTS.has(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}
