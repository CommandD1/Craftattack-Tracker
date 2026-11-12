import "server-only";
import { getDb } from "./db";
import { insertPastEvents } from "./store";
import type { TrackerEvent } from "./types";

/**
 * Follower-Schübe aus dem Verlauf nachtragen. Der Tracker legt „follower_burst“ live an, wenn ein Streamer auf dem
 * Server mehr als 20 neue Follower je Minute bekommt (lib/tracker.ts, diffFollowers). Schlägt eine Follower-Abfrage
 * fehl, misst die nächste über einen längeren Abstand, die Rate verwässert und der Schub fehlt (bis 2026-11-11 rund 140).
 * Dieser Job (nur Tracker, alle 10 Min) prüft dieselbe Regel auf den Minutenwerten in player_history:
 * - je Spieler und Minute der letzte Follower-Stand; online auf dem Server in beiden Minuten
 * - Zuwachs je Minute > 20, gemessen über mindestens 60 s (so oft fragt der Tracker die Follower ab; kürzere Abstände
 *   zwischen zwei Zeilen würden die Rate überschätzen)
 * - schon vorhandener Schub dieses Spielers ±3 Min → nichts anlegen; mehr als verdoppelt = Messfehler der API
 *   (ein Kanal sprang einmal von 1.661 auf 1.095.732)
 * Nur Beobachtetes: die Werte stehen so im Verlauf. Feste IDs, also beliebig oft wiederholbar.
 */

const RATE_PER_MIN = 20;
const RUN_MS = 10 * 60_000;
/** Nur abgeschlossene Minuten (die laufende kann noch Zeilen bekommen) */
const SETTLE_MS = 3 * 60_000;

export async function buildFollowerBursts(): Promise<number> {
  const db = await getDb();
  const meta = (await db.query<{ follower_bursts_until: Date | null }>(`SELECT follower_bursts_until FROM tracker_meta WHERE id = 1`)).rows[0];
  const cursor = meta?.follower_bursts_until?.getTime() ?? 0;
  const until = Date.now() - SETTLE_MS;
  if (until <= cursor) return 0;
  // Eine Minute vor dem Cursor als Vergleich
  const from = new Date(Math.max(0, cursor - 5 * 60_000));
  const rows = (
    await db.query<{ player: string; at: Date; gain: number; secs: number; on_server: number | null; name: string; uuid: string }>(
      `WITH m AS (
         SELECT player, date_trunc('minute', at) AS mi, max(at) AS at, max(followers_total) AS f,
                max(followers_on_server) AS on_server, bool_and(online) AS onl
           FROM player_history
          WHERE at > $1 AND at <= $2 AND followers_total IS NOT NULL
          GROUP BY 1, 2
       ), h AS (
         SELECT m.*, lag(at) OVER w AS pat, lag(onl) OVER w AS pon, lag(f) OVER w AS pf
           FROM m WINDOW w AS (PARTITION BY player ORDER BY mi)
       )
       SELECT h.player, h.at, (h.f - h.pf)::int AS gain, extract(epoch FROM h.at - h.pat)::float AS secs, h.on_server, p.name, p.uuid
         FROM h JOIN players p ON p.id = h.player
        WHERE h.at > $3 AND h.onl AND h.pon AND h.f > h.pf
          -- Messfehler der API (z. B. 1.661 → 1.095.732 bei einem Kanal): mehr als verdoppelt zählt nicht
          AND h.f < 2 * h.pf
          AND h.at - h.pat < interval '3 minutes'
          AND (h.f - h.pf) * 60.0 > $4 * greatest(60, extract(epoch FROM h.at - h.pat))
          AND NOT EXISTS (
            SELECT 1 FROM events e WHERE e.type = 'follower_burst' AND e.player = h.player
               AND e.at BETWEEN h.at - interval '3 minutes' AND h.at + interval '3 minutes')`,
      [from, new Date(until), new Date(cursor), RATE_PER_MIN],
    )
  ).rows;
  const events: TrackerEvent[] = rows.map((r) => ({
    id: `fburst-${r.player}-${Math.floor(r.at.getTime() / 60_000).toString(36)}`,
    at: r.at.toISOString(),
    type: "follower_burst",
    player: r.player,
    playerName: r.name,
    uuid: r.uuid,
    where: "twitch",
    delta: r.gain,
    ...(r.on_server !== null ? { value: r.on_server } : {}),
    meta: { windowSeconds: Math.round(Math.max(60, r.secs)), ...(r.on_server !== null ? { followerGainOnServer: r.on_server } : {}), source: "history" },
  }));
  let added = 0;
  for (let i = 0; i < events.length; i += 1000) added += await insertPastEvents(events.slice(i, i + 1000));
  await db.query(`UPDATE tracker_meta SET follower_bursts_until = $1 WHERE id = 1`, [new Date(until)]);
  return added;
}

export function startFollowerBursts() {
  const gl = globalThis as typeof globalThis & { __acFollowerBursts?: boolean };
  if (gl.__acFollowerBursts) return;
  gl.__acFollowerBursts = true;
  const run = () =>
    void buildFollowerBursts()
      .then((n) => n && console.log(`[tracker] ${n} Follower-Schübe aus dem Verlauf nachgetragen`))
      .catch((err: unknown) => console.warn("[tracker] Follower-Schübe aus dem Verlauf fehlgeschlagen:", err instanceof Error ? err.message : err));
  setTimeout(run, 3 * 60_000).unref();
  setInterval(run, RUN_MS).unref();
}
