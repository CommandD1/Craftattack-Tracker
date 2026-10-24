import "server-only";
import { getDb } from "./db";
import type { LinkCounts } from "./connectionWeights";

/** Verbindung zweier Spieler über Twitch: Raids, geteilte Chats und Nachrichten im Chat des anderen. */
export interface ConnectionEdge extends LinkCounts {
  last: string;
}

/** Raids, geteilte Chats und Chat-Nachrichten seit `hours` Stunden (null = gesamte Erfassung), zu Paaren zusammengefasst. */
export async function getConnections(hours: number | null): Promise<ConnectionEdge[]> {
  const db = await getDb();
  const since = hours === null ? new Date(0) : new Date(Date.now() - hours * 3600_000);
  const [raids, chats, messages] = await Promise.all([
    db.query<{ src: string; dst: string; n: number; last: Date }>(
      `SELECT player AS src, meta->>'raidTargetPlayerId' AS dst, count(*)::int AS n, max(at) AS last
         FROM events
        WHERE type = 'raid' AND at >= $1 AND player IS NOT NULL AND meta->>'raidTargetPlayerId' IS NOT NULL
        GROUP BY 1, 2`,
      [since],
    ),
    db.query<{ participants: string[]; started_at: Date; last_seen_at: Date; ended_at: Date | null }>(
      `SELECT participants, started_at, last_seen_at, ended_at
         FROM shared_chat_sessions
        WHERE coalesce(ended_at, now()) >= $1 AND cardinality(participants) > 1`,
      [since],
    ),
    // Nur der Kanal, in dem geschrieben wurde; Kopien im geteilten Chat (shared_with) zählen nicht extra
    db.query<{ src: string; dst: string; n: number; last: Date }>(
      `SELECT sender_id AS src, channel_id AS dst, count(*)::int AS n, max(at) AS last
         FROM twitch_chat_messages
        WHERE at >= $1 AND sender_id <> channel_id
        GROUP BY 1, 2`,
      [since],
    ),
  ]);

  const pairs = new Map<string, ConnectionEdge>();
  const pair = (x: string, y: string) => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}|${b}`;
    let e = pairs.get(key);
    if (!e)
      pairs.set(
        key,
        (e = { a, b, raidsAB: 0, raidsBA: 0, chats: 0, chatSeconds: 0, msgsAB: 0, msgsBA: 0, now: false, last: new Date(0).toISOString() }),
      );
    return e;
  };
  const touch = (e: ConnectionEdge, at: Date) => {
    if (at.toISOString() > e.last) e.last = at.toISOString();
  };

  for (const r of raids.rows) {
    if (r.src === r.dst) continue;
    const e = pair(r.src, r.dst);
    if (r.src === e.a) e.raidsAB += r.n;
    else e.raidsBA += r.n;
    touch(e, r.last);
  }
  for (const s of chats.rows) {
    const ids = [...new Set(s.participants)].sort();
    // Bei aus dem Chat erschlossenen Sessions ist last_seen_at der letzte Hinweis; laufende zählen bis jetzt
    const end = s.ended_at ?? new Date();
    const seconds = Math.max(0, Math.round((end.getTime() - Math.max(s.started_at.getTime(), since.getTime())) / 1000));
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const e = pair(ids[i], ids[j]);
        e.chats++;
        e.chatSeconds += seconds;
        if (!s.ended_at) e.now = true;
        touch(e, s.last_seen_at);
      }
  }
  for (const m of messages.rows) {
    const e = pair(m.src, m.dst);
    if (m.src === e.a) e.msgsAB += m.n;
    else e.msgsBA += m.n;
    touch(e, m.last);
  }
  return [...pairs.values()];
}
