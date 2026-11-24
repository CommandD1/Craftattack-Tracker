import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";

/**
 * YouTube-Livestreams der Teilnehmer (aus `youtube_videos`, lib/youtube.ts) als Ersatz-Aufzeichnung: Twitch hat
 * immer Vorrang; YouTube springt ein, wenn es kein Twitch-VOD gibt (gelöscht oder nur auf YouTube gestreamt).
 * Nur Livestreams, die als Video auf YouTube geblieben sind. Alle Streams zusammen sind wenige Hundert Zeilen.
 */
export interface YoutubeLive {
  player: string;
  id: string;
  title: string;
  start: number;
  end: number;
  ca: boolean;
}

const swr = createSwrCache({ maxEntries: 2 });
/** Vorlauf beim Sprung an eine Stelle, wie bei Twitch-Links */
const LEAD_S = 15;

export function getYoutubeLives(): Promise<YoutubeLive[]> {
  return swr("lives", 15 * 60_000, async () => {
    const db = await getDb();
    const r = await db.query<{ player: string; id: string; title: string; live_start: Date; live_end: Date | null; duration_s: number | null; ca: boolean }>(
      `SELECT player, id, title, live_start, live_end, duration_s, ca FROM youtube_videos
        WHERE format = 'livestream' AND live_start IS NOT NULL ORDER BY live_start`,
    );
    return r.rows.map((x) => ({
      player: x.player,
      id: x.id,
      title: x.title,
      start: x.live_start.getTime(),
      end: x.live_end?.getTime() ?? x.live_start.getTime() + (x.duration_s ?? 0) * 1000,
      ca: x.ca,
    }));
  }).catch(() => []);
}

/** Livestream des Spielers, der zu diesem Zeitpunkt lief, mit Position in Sekunden */
export function youtubeAt(lives: YoutubeLive[], player: string, atMs: number): { id: string; offset: number } | null {
  const l = lives.find((x) => x.player === player && atMs >= x.start && atMs <= x.end);
  return l ? { id: l.id, offset: Math.max(0, (atMs - l.start) / 1000) } : null;
}

export function youtubeMomentUrl(id: string, offsetS: number, leadS = LEAD_S): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.max(0, Math.floor(offsetS - leadS))}s`;
}
