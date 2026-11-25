import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadVoiceSummary } from "./voiceSummary";

type ChatStats = { lines: number; events: number; byStatus?: Record<string, number>; until?: string };

/**
 * Nur den Block „stats“ aus review/chat-review.json lesen (steht am Anfang der 7,5 MB großen Datei): die ersten
 * 16 KB statt der ganzen Datei, damit die Website nichts Großes im Speicher hält.
 */
async function chatStats(): Promise<ChatStats | null> {
  const file = join(process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review"), "chat-review.json");
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(file, "r");
    const buf = Buffer.alloc(16_384);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const i = head.indexOf('"stats"');
    if (i < 0) return null;
    const start = head.indexOf("{", i);
    let depth = 0;
    for (let j = start; j < head.length; j++) {
      if (head[j] === "{") depth++;
      else if (head[j] === "}" && --depth === 0) return JSON.parse(head.slice(start, j + 1)) as ChatStats;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** Live-Zahlen für die Projektkarte /vorschau/<key>/projekt: Tracker-DB plus Stand des VOD-Scans (Dateien in review/) */
export interface ProjectNumbers {
  startedAt: string | null;
  polls: number;
  dbBytes: number;
  players: number;
  events: number;
  eventsBy: Record<string, number>;
  history: number;
  playerHistory: number;
  twitchVods: number;
  twitchVodHours: number;
  clips: number;
  chatMessages: number;
  snapshots: number;
  ytChannels: number;
  ytVideos: number;
  ytCa14: number;
  ytViews: number;
  scan: { done: number; total: number; reached: string | null; frames: number; heads: number; known: number; groups: number; groupHours: number } | null;
  chat: { lines: number; events: number; open: number; until: string | null } | null;
}

const swr = createSwrCache({ maxEntries: 2 });

export function getProjectNumbers(): Promise<ProjectNumbers> {
  return swr("project", 10 * 60_000, async () => {
    const db = await getDb();
    const one = async <T,>(sql: string) => (await db.query<T & Record<string, unknown>>(sql)).rows[0] as T;
    const [meta, size, players, ev, by, hist, ph, vods, clips, msgs, snaps, yt, voice, chat] = await Promise.all([
      one<{ started_at: Date | null; polls: number }>(`SELECT started_at, polls FROM tracker_meta WHERE id = 1`),
      one<{ b: string }>(`SELECT pg_database_size(current_database()) AS b`),
      one<{ n: string }>(`SELECT count(*) AS n FROM players`),
      one<{ n: string }>(`SELECT count(*) AS n FROM events`),
      db.query<{ w: string; n: string }>(`SELECT "where" AS w, count(*) AS n FROM events GROUP BY 1`).then((r) => r.rows),
      one<{ n: string }>(`SELECT count(*) AS n FROM history`),
      one<{ n: string }>(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'player_history'`),
      one<{ n: string; h: number }>(`SELECT count(*) AS n, coalesce(sum(duration_s), 0) / 3600.0 AS h FROM twitch_vods`),
      one<{ n: string }>(`SELECT count(*) AS n FROM twitch_clips`),
      one<{ n: string }>(`SELECT count(*) AS n FROM twitch_chat_messages`),
      one<{ n: string }>(`SELECT count(*) AS n FROM snapshots`),
      one<{ c: string; v: string; ca: string; views: string }>(
        `SELECT (SELECT count(*) FROM youtube_channels) AS c, count(*) AS v, count(*) FILTER (WHERE ca14) AS ca, coalesce(sum(views) FILTER (WHERE ca14), 0) AS views FROM youtube_videos`,
      ),
      loadVoiceSummary(),
      chatStats(),
    ]);
    const stats = chat;
    return {
      startedAt: meta?.started_at?.toISOString() ?? null,
      polls: Number(meta?.polls ?? 0),
      dbBytes: Number(size.b),
      players: Number(players.n),
      events: Number(ev.n),
      eventsBy: Object.fromEntries(by.map((r) => [r.w, Number(r.n)])),
      history: Number(hist.n),
      playerHistory: Number(ph?.n ?? 0),
      twitchVods: Number(vods.n),
      twitchVodHours: Math.round(Number(vods.h)),
      clips: Number(clips.n),
      chatMessages: Number(msgs.n),
      snapshots: Number(snaps.n),
      ytChannels: Number(yt.c),
      ytVideos: Number(yt.v),
      ytCa14: Number(yt.ca),
      ytViews: Number(yt.views),
      scan: voice
        ? { done: voice.scan.done, total: voice.scan.total, reached: voice.scan.reached, frames: voice.totals.frames, heads: voice.totals.heads, known: voice.totals.known + voice.totals.inferred, groups: voice.totals.groups, groupHours: voice.totals.groupHours }
        : null,
      chat: stats ? { lines: stats.lines, events: stats.events, open: stats.byStatus?.open ?? 0, until: stats.until ?? null } : null,
    };
  });
}
