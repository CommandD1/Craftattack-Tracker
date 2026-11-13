import "server-only";
import { getDb } from "./db";

/**
 * Wann hat der Live-Chat (lib/twitchIrc.ts) wirklich mitgeschrieben? Grundlage für die VOD-Nachlese
 * (scripts/vod-chat.mjs), die genau die Lücken aus den VODs füllt:
 * - `irc_uptime`: je Minute, in der die Verbindung stand (angemeldet, zuletzt vor < 7 Min etwas empfangen) und keine
 *   Nachricht verloren ging. Fehlt eine Minute, gilt sie für alle Kanäle als Lücke.
 * - `irc_joined`: je Kanal (Spieler-ID) und 5-Minuten-Abschnitt, in dem Twitch das JOIN bestätigt hatte. Fehlt ein
 *   Abschnitt, während der Kanal live war, gilt er für diesen Kanal als Lücke.
 * - Verlorene Nachrichten (alle Versuche gescheitert) markieren ihre Minute als Lücke (`ok = false`).
 */

const FLUSH_MS = 60_000;

type Globals = typeof globalThis & {
  __acIrcCoverage?: { minutes: Set<number>; joined: Set<string>; lost: Set<number>; timer: ReturnType<typeof setInterval> | null };
};

function mem() {
  const g = globalThis as Globals;
  g.__acIrcCoverage ??= { minutes: new Set(), joined: new Set(), lost: new Set(), timer: null };
  const m = g.__acIrcCoverage;
  m.timer ??= setInterval(() => void flushIrcCoverage(), FLUSH_MS);
  return m;
}

/** Verbindung steht jetzt; `channels` = Spieler-IDs der bestätigt beigetretenen Kanäle */
export function noteIrcAlive(channels: Iterable<string>, now = Date.now()) {
  const m = mem();
  m.minutes.add(Math.floor(now / 60_000));
  const bin = Math.floor(now / 300_000);
  for (const id of channels) m.joined.add(`${id}|${bin}`);
}

/** Eine Nachricht aus dieser Zeit (ms) ging endgültig verloren */
export function noteIrcLost(at: number) {
  if (Number.isFinite(at)) mem().lost.add(Math.floor(at / 60_000));
}

/**
 * Fenster, in dem der Chat nach einem Neustart oder Verbindungsabbruch noch nicht in allen Kanälen mitlas (Twitch
 * erlaubt 20 JOINs je 10 s, 107 Kanäle brauchen also ~1 Min). Solche Lücken sind kürzer als eine Minute je Kanal und
 * fallen in irc_uptime nicht auf; scripts/vod-chat.mjs liest sie aus den VODs nach.
 */
export async function noteIrcRejoin(fromMs: number, toMs: number) {
  if (!(toMs > fromMs)) return;
  try {
    const db = await getDb();
    await db.query(`INSERT INTO irc_rejoin (from_ms, to_ms) VALUES ($1, $2) ON CONFLICT (from_ms) DO UPDATE SET to_ms = GREATEST(irc_rejoin.to_ms, EXCLUDED.to_ms)`, [
      Math.floor(fromMs),
      Math.ceil(toMs),
    ]);
  } catch (e) {
    console.error("[irc-coverage] Wiedereinstieg nicht gespeichert:", e instanceof Error ? e.message : e);
  }
}

export async function flushIrcCoverage() {
  const m = mem();
  if (!m.minutes.size && !m.joined.size && !m.lost.size) return;
  const minutes = [...m.minutes];
  const joined = [...m.joined].map((k) => k.split("|"));
  const lost = [...m.lost];
  m.minutes.clear();
  m.joined.clear();
  m.lost.clear();
  try {
    const db = await getDb();
    if (minutes.length)
      await db.query(`INSERT INTO irc_uptime (minute, ok) SELECT unnest($1::int[]), true ON CONFLICT (minute) DO NOTHING`, [minutes]);
    if (joined.length)
      await db.query(`INSERT INTO irc_joined (player, bin) SELECT * FROM unnest($1::text[], $2::int[]) ON CONFLICT DO NOTHING`, [joined.map((j) => j[0]), joined.map((j) => Number(j[1]))]);
    if (lost.length)
      await db.query(`INSERT INTO irc_uptime (minute, ok) SELECT unnest($1::int[]), false ON CONFLICT (minute) DO UPDATE SET ok = false`, [lost]);
  } catch (e) {
    // Beim nächsten Mal erneut versuchen (fehlt die Minute ganz, gilt sie später als Lücke: lieber zu viel nachlesen)
    for (const x of minutes) m.minutes.add(x);
    for (const [id, bin] of joined) m.joined.add(`${id}|${bin}`);
    for (const x of lost) m.lost.add(x);
    console.error("[irc-coverage] Speichern fehlgeschlagen:", e instanceof Error ? e.message : e);
  }
}
