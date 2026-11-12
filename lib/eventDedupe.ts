import "server-only";
import { getDb } from "./db";
import { deleteEventsById } from "./store";

/**
 * Doppelte Ereignisse vermeiden und aus dem Verlauf entfernen.
 *
 * Meilensteine: Zwei Quellen für denselben Zähler wechseln sich manchmal ab (z. B. 9.997 ↔ 10.001), jedes
 * Überschreiten erzeugte dann denselben Meilenstein erneut (bis 12× in 11 Min). Jetzt zählt jede Marke je Spieler
 * und Zähler nur einmal (`milestoneSeen`).
 *
 * Streams: Fehlt ein Stream in einer Twitch-Antwort kurz, meldete der Tracker „offline“ und eine Minute später
 * wieder „live“, obwohl Twitch denselben Beginn (startedAt) meldet. Taucht derselbe Stream binnen 30 Min wieder auf,
 * gilt er als durchgehend: kein neuer Start, und das vorschnelle Ende wird wieder gelöscht (`streamFlicker`).
 */

const reached = new Set<string>();
let reachedLoaded: Promise<void> | null = null;

/** Einmal je Prozess: bereits erreichte Meilensteine aus der DB */
export function loadReachedMilestones(): Promise<void> {
  reachedLoaded ??= (async () => {
    const db = await getDb();
    const rows = (await db.query<{ player: string; board: string; value: number }>(
      `SELECT DISTINCT player, meta->>'board' AS board, value FROM events WHERE type = 'milestone' AND player IS NOT NULL`,
    )).rows;
    for (const r of rows) reached.add(`${r.player}|${r.board}|${Number(r.value)}`);
  })().catch((err: unknown) => {
    reachedLoaded = null;
    throw err;
  });
  return reachedLoaded;
}

/** true = diesen Meilenstein hat der Spieler schon (dann kein neues Ereignis); merkt ihn sonst */
export function milestoneSeen(player: string, board: string, value: number): boolean {
  const k = `${player}|${board}|${value}`;
  if (reached.has(k)) return true;
  reached.add(k);
  return false;
}

interface StreamEnd {
  startedAt: string | null;
  at: number;
  liveSince: string | null;
  livePeak: number;
  endId: string;
}
const recentEnds = new Map<string, StreamEnd>();
const pendingDeletes: string[] = [];
const FLICKER_MS = 30 * 60_000;

/** Stream-Ende merken (für den Fall, dass derselbe Stream gleich wieder auftaucht) */
export function noteStreamEnd(player: string, end: StreamEnd) {
  recentEnds.set(player, end);
}

/**
 * Taucht derselbe Stream (gleicher Beginn laut Twitch) binnen 30 Min wieder auf? Dann den gemerkten Stand
 * zurückgeben und das vorschnelle Ende zum Löschen vormerken; sonst null.
 */
export function streamFlicker(player: string, startedAt: string | null, nowMs: number): StreamEnd | null {
  const e = recentEnds.get(player);
  if (!e) return null;
  recentEnds.delete(player);
  if (!startedAt || !e.startedAt || e.startedAt !== startedAt || nowMs - e.at > FLICKER_MS) return null;
  pendingDeletes.push(e.endId);
  return e;
}

/** Vorgemerkte vorschnelle Stream-Enden löschen (nach dem Speichern eines Polls aufrufen) */
export async function flushStreamFlickers(): Promise<number> {
  if (!pendingDeletes.length) return 0;
  const ids = pendingDeletes.splice(0);
  return deleteEventsById(ids);
}

/**
 * Verlauf bereinigen (einmalig, lib/backfill.ts): doppelte Meilensteine (der früheste bleibt) und Stream-Flackern
 * (das vorschnelle Ende und der erneute Start). Flackern = derselbe Beginn laut Twitch, oder – bei alten Ereignissen
 * ohne Beginn – ein einziges VOD über die ganze Lücke (ein echter Neustart beginnt bei Twitch ein neues VOD).
 */
export async function removeDuplicateHistory(): Promise<{ milestones: number; streams: number }> {
  const db = await getDb();
  const dupMilestones = (
    await db.query<{ id: string }>(
      `SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY player, meta->>'board', value ORDER BY at, id) AS rn
           FROM events WHERE type = 'milestone' AND player IS NOT NULL
       ) x WHERE rn > 1`,
    )
  ).rows.map((r) => r.id);
  const flicker = (
    await db.query<{ sid: string; eid: string }>(
      `WITH s AS (
         SELECT id, player, at, meta->>'startedAt' AS sa, lag(at) OVER w AS pat, lag(meta->>'startedAt') OVER w AS psa
           FROM events WHERE type = 'stream_start'
         WINDOW w AS (PARTITION BY player ORDER BY at)
       )
       SELECT s.id AS sid, e.id AS eid
         FROM s
         JOIN LATERAL (
           SELECT id, at FROM events e
            WHERE e.type = 'stream_end' AND e.player = s.player AND e.at > s.pat AND e.at <= s.at
            ORDER BY e.at DESC LIMIT 1
         ) e ON true
        WHERE s.pat IS NOT NULL AND s.at - e.at < interval '30 minutes'
          AND (
            (s.sa IS NOT NULL AND s.psa IS NOT NULL AND s.sa = s.psa)
            OR ((s.sa IS NULL OR s.psa IS NULL) AND EXISTS (
              SELECT 1 FROM twitch_vods v
               WHERE v.player = s.player AND v.created_at <= e.at - interval '1 minute'
                 AND v.created_at + make_interval(secs => v.duration_s) >= s.at + interval '1 minute'))
          )`,
    )
  ).rows.flatMap((r) => [r.sid, r.eid]);
  const milestones = dupMilestones.length ? await deleteEventsById(dupMilestones) : 0;
  const streams = flicker.length ? await deleteEventsById([...new Set(flicker)]) : 0;
  return { milestones, streams };
}
