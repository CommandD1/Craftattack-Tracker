import "server-only";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db";
import { deleteEvents, getEvents, getState, insertPastEvents, updateEventMeta } from "./store";
import type { TrackerEvent } from "./types";
import { loadVoicePairs, loadVoiceSummary } from "./voiceSummary";

/**
 * Voicechat als Datenquelle: Wer war mit wem in einer Gruppe von Simple Voice Chat? Gelesen vom VOD-Scan des
 * Videoprojekts (~/craftattack-stats) aus der Gruppenliste in den Stream-Aufnahmen, ein Bild alle 10 Sekunden, nur
 * solange der Streamer auf dem Server und nicht AFK war. Nur, was in der Liste eines gescannten Streamers zu sehen war;
 * Stellen, an denen sich zwei Streamer derselben Gruppe widersprechen, zählen nicht.
 *
 * - Tracker: liest stündlich voice-events.json (scripts/chat/export-voice-events.mjs) und trägt Ereignisse ein:
 *   `voice_session` (Sitzung ab 10 min, mit Mitspielern und Sprung ins VOD), `voice_first` (erstes Mal zusammen,
 *   Paare ab 1 h insgesamt). IDs: Spieler + Beginn bzw. Paar, bleiben also stabil; ändert sich der Inhalt (Scan
 *   nachgebessert), wird `meta` aktualisiert, fehlt ein Ereignis in einer neuen Datei, wird es gelöscht.
 * - Verbindungen (lib/connections.ts): Minuten je Mitspieler (`meta.with` + `meta.withMin`) ergeben die Voicechat-Zeit.
 * - Website: Zahlen je Spieler und für /voicechat aus voice-summary.json und voice-pairs.json (lib/voiceSummary.ts).
 */
const DIR = process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review");
const FILE = join(DIR, "voice-events.json");
const TYPES = ["voice_session", "voice_first"] as const;
const SYNC_MS = 30 * 60_000;
/** Höchstens so viele Mitspieler mit Namen im Text, der Rest als „und N weiteren“ */
const NAMED = 4;

type VodAt = [string, number] | null;
type VoiceEventsFile = {
  made: string;
  /** [Spieler, von ms, bis ms, Minuten in der Gruppe, [[Mitspieler, Minuten]], zu Beginn dabei, [VOD, Sekunde]] */
  sessions: [string, number, number, number, [string, number][], string[], VodAt][];
  /** [a, b, erste gemeinsame Minute (ms), Minuten gesamt, [VOD, Sekunde]] */
  firsts: [string, string, number, number, VodAt][];
};

const vodUrl = (v: VodAt) => {
  if (!v) return null;
  const s = Math.max(0, Math.round(v[1]));
  return `https://www.twitch.tv/videos/${encodeURIComponent(v[0])}?t=${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
};

async function buildEvents(f: VoiceEventsFile): Promise<TrackerEvent[]> {
  const { players } = await getState();
  const out: TrackerEvent[] = [];
  for (const s of f.sessions) {
    const [id, from, to, minutes, partners, , vod] = s;
    const p = players[id];
    // gleich lange Mitspieler nach ID, damit sich die Reihenfolge nicht stündlich ändert
    const known = partners.filter(([o]) => players[o]).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    if (!p || !known.length) continue;
    const named = known.slice(0, NAMED).map(([o]) => players[o].name);
    const url = vodUrl(vod);
    out.push({
      id: `voice-${id}-${from}`,
      at: new Date(from).toISOString(),
      type: "voice_session",
      player: id,
      playerName: p.name,
      uuid: p.uuid,
      where: "server",
      meta: {
        endAt: new Date(to).toISOString(),
        seconds: Math.round((to - from) / 1000),
        minutes,
        with: known.map(([o]) => o).join(","),
        withMin: known.map(([, n]) => n).join(","),
        withNames: named.join("\n"),
        withMore: known.length - named.length,
        ...(url ? { vodUrl: url } : {}),
        source: "voice-scan",
      },
    });
  }
  for (const r of f.firsts) {
    const [a, b, at, minutes, vod] = r;
    const pa = players[a], pb = players[b];
    if (!pa || !pb) continue;
    const url = vodUrl(vod);
    out.push({
      id: `voicefirst-${a}-${b}`,
      at: new Date(at).toISOString(),
      type: "voice_first",
      player: a,
      playerName: pa.name,
      uuid: pa.uuid,
      where: "server",
      meta: { withId: b, withName: pb.name, totalSeconds: minutes * 60, ...(url ? { vodUrl: url } : {}), source: "voice-scan" },
    });
  }
  return out;
}

async function syncVoice(): Promise<{ added: number; changed: number; removed: number; total: number } | null> {
  const f = JSON.parse(await readFile(FILE, "utf8")) as VoiceEventsFile;
  // Schutz: eine halbe oder leere Datei löscht nicht alle Ereignisse
  if (!Array.isArray(f.sessions) || f.sessions.length < 100) return null;
  const events = await buildEvents(f);
  const have = new Map((await getEvents()).filter((e) => e.type === "voice_session" || e.type === "voice_first").map((e) => [e.id, e]));
  // Gleiche ID, anderer Inhalt (Scan nachgebessert): nur meta neu; Felder, die wegfallen, werden null
  let changed = 0;
  for (const e of events) {
    const old = have.get(e.id);
    if (!old) continue;
    const meta = e.meta ?? {};
    const gone = Object.fromEntries(Object.keys(old.meta ?? {}).filter((k) => !(k in meta)).map((k) => [k, null]));
    if (JSON.stringify({ ...old.meta, ...gone, ...meta }) === JSON.stringify(old.meta)) continue;
    await updateEventMeta(old, { ...gone, ...meta });
    changed++;
  }
  const added = await insertPastEvents(events.filter((e) => !have.has(e.id)));
  const removed = await deleteEvents([...TYPES], events.map((e) => e.id));
  return { added, changed, removed, total: events.length };
}

/** Tracker: Voicechat-Ereignisse aus dem VOD-Scan übernehmen (beim Start nach 5 min, dann alle 30 min bei neuer Datei) */
export function startVoiceSync() {
  const gl = globalThis as typeof globalThis & { __acVoice?: boolean };
  if (gl.__acVoice) return;
  gl.__acVoice = true;
  let lastMtime = 0;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const m = (await stat(FILE).catch(() => null))?.mtimeMs ?? 0;
      if (!m || m === lastMtime) return;
      const r = await syncVoice();
      lastMtime = m;
      if (r) console.log(`[voice] ${r.total} Voicechat-Ereignisse · ${r.added} neu · ${r.changed} geändert · ${r.removed} entfernt`);
    } catch (err) {
      console.warn("[voice] Abgleich fehlgeschlagen:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5 * 60_000).unref();
  setInterval(run, SYNC_MS).unref();
}

export type VoiceProfile = {
  hours: number;
  talk: number | null;
  deaf: number | null;
  sessions: number;
  longest: { at: string; seconds: number; id: string } | null;
  days: number;
  /** [Spieler, Sekunden] – alle Mitspieler ab 1 Minute, längste zuerst */
  partners: [string, number][];
  made: string;
};

/** Voicechat-Zahlen eines Spielers fürs Profil (null = nie in einer erkannten Gruppe) */
export async function getVoiceProfile(id: string): Promise<VoiceProfile | null> {
  const [sum, pairs, db] = await Promise.all([loadVoiceSummary(), loadVoicePairs(), getDb()]);
  const me = sum?.players.find((p) => p.id === id);
  if (!sum || !me || !me.hours) return null;
  const partners = (pairs?.pairs ?? [])
    .filter(([a, b]) => a === id || b === id)
    .map(([a, b, s]) => [a === id ? b : a, s] as [string, number])
    .sort((x, y) => y[1] - x[1]);
  const { rows } = await db.query<{ n: string; days: string; longest: string | null; lat: Date | null; lid: string | null }>(
    `SELECT count(*) n, count(DISTINCT (at AT TIME ZONE 'Europe/Berlin')::date) days,
            max((meta->>'seconds')::int) longest,
            (array_agg(at ORDER BY (meta->>'seconds')::int DESC))[1] lat,
            (array_agg(id ORDER BY (meta->>'seconds')::int DESC))[1] lid
       FROM events WHERE type = 'voice_session' AND player = $1`,
    [id],
  );
  const r = rows[0];
  return {
    hours: me.hours,
    talk: me.talk,
    deaf: me.deaf,
    sessions: Number(r?.n ?? 0),
    days: Number(r?.days ?? 0),
    longest: r?.longest && r.lat && r.lid ? { at: r.lat.toISOString(), seconds: Number(r.longest), id: r.lid } : null,
    partners,
    made: sum.made,
  };
}
