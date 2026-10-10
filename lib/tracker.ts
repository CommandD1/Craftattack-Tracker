import "server-only";
import { appendEvents, getState, recordPlayerPoints, saveState } from "./store";
import {
  BOARD_KEYS,
  type ApiExtPlayer,
  type ApiStats,
  type BoardEntry,
  type BoardKey,
  type EventType,
  type PlayerState,
  type TrackerEvent,
  type TrackerState,
} from "./types";

export const STATS_URL = process.env.CA_STATS_URL ?? "https://craftattack.one/api/stats";
/**
 * Pro-Spieler-Endpunkt: liefert alle Zähler (außer Spielzeit) und den Rang – auch außerhalb der Top 10.
 * Erwartet den Twitch-Login (nicht die Spieler-ID), siehe `extLogins`.
 */
export const EXT_URL = process.env.CA_EXT_URL ?? "https://craftattack.one/api/ext";
export const POLL_INTERVAL_MS = Number(process.env.CA_POLL_INTERVAL_MS ?? 30_000);
/** Wie viele ext-Anfragen gleichzeitig laufen */
const EXT_CONCURRENCY = Number(process.env.CA_EXT_CONCURRENCY ?? 8);

/** Board-Keys, deren Anstieg als Ereignis protokolliert wird */
const COUNTER_EVENTS: Partial<Record<BoardKey, EventType>> = {
  deaths: "death",
  diamonds: "diamonds",
  blocksBroken: "blocksBroken",
  mobsKilled: "mobsKilled",
  distance: "distance",
};

/** Mindest-Delta, ab dem ein Zähler-Ereignis entsteht (sonst zu viel Rauschen) */
const MIN_DELTA: Partial<Record<BoardKey, number>> = {
  distance: 500, // Meter
  blocksBroken: 100,
  mobsKilled: 10,
};

/** Meilensteine pro Zähler – beim Überschreiten gibt es ein Ereignis */
const MILESTONES: Partial<Record<BoardKey, number[]>> = {
  playtimeSeconds: [6, 12, 24, 48, 100, 200, 500].map((h) => h * 3600),
  deaths: [5, 10, 25, 50, 100],
  diamonds: [64, 128, 256, 512, 1000, 2000, 5000, 10000],
  blocksBroken: [1000, 5000, 10000, 50000, 100000, 500000],
  mobsKilled: [100, 500, 1000, 5000, 10000],
  distance: [10000, 50000, 100000, 500000, 1000000],
};
const BOARD_LABEL: Record<BoardKey, string> = {
  playtimeSeconds: "Dauerzocker",
  diamonds: "Diamantenbank",
  deaths: "Friedhof",
  blocksBroken: "Abrissbirne",
  mobsKilled: "Monsterjäger",
  distance: "Weltenbummler",
};

let seq = 0;
function eventId(at: string) {
  seq = (seq + 1) % 100000;
  return `${Date.parse(at).toString(36)}-${seq.toString(36)}`;
}

export async function fetchStats(): Promise<ApiStats> {
  const res = await fetch(STATS_URL, {
    headers: { accept: "application/json", "user-agent": "actracker/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ApiStats;
}

export type ExtPlayer = NonNullable<ApiExtPlayer["player"]>;

/** Holt die Einzelstatistik eines Spielers per Twitch-Login; `null`, wenn die API ihn nicht kennt. */
export async function fetchExtPlayer(login: string): Promise<ExtPlayer | null> {
  const res = await fetch(`${EXT_URL}/${encodeURIComponent(login)}`, {
    headers: { accept: "application/json", "user-agent": "actracker/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as ApiExtPlayer;
  return data.player ?? null;
}

/**
 * Fragt alle Logins parallel (begrenzt) ab. Ergebnis ist nach Spieler-ID (aus der Antwort) abgelegt.
 * Fehlgeschlagene Spieler fehlen einfach im Ergebnis.
 */
export async function fetchExtAll(logins: Iterable<string>): Promise<{ players: Map<string, ExtPlayer>; failed: number }> {
  const queue = [...new Set(logins)];
  const players = new Map<string, ExtPlayer>();
  let failed = 0;
  const worker = async () => {
    for (let login = queue.shift(); login !== undefined; login = queue.shift()) {
      try {
        const p = await fetchExtPlayer(login);
        if (p) players.set(p.id, p);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, EXT_CONCURRENCY) }, worker));
  return { players, failed };
}

/** Alle Spieler-IDs, die der Tracker kennt oder die im aktuellen Snapshot vorkommen. */
export function knownPlayerIds(state: TrackerState, stats: ApiStats): Set<string> {
  const ids = new Set(Object.keys(state.players));
  for (const p of stats.online) ids.add(p.id);
  for (const l of stats.live ?? []) ids.add(l.id);
  for (const key of BOARD_KEYS) for (const e of stats.boards?.[key] ?? []) ids.add(e.id);
  return ids;
}

/**
 * Twitch-Logins für die ext-Abfrage: gespeicherter Login des Spielers, sonst der Login aus dem aktuellen
 * Live-Status, sonst die Spieler-ID (stimmt bei den meisten Spielern mit dem Login überein).
 */
export function extLogins(state: TrackerState, stats: ApiStats, ids: Iterable<string>): Set<string> {
  const liveLogin = new Map<string, string>();
  for (const l of stats.live ?? []) liveLogin.set(l.id, l.login);
  for (const p of stats.online) if (p.live?.login) liveLogin.set(p.id, p.live.login);
  const logins = new Set<string>();
  for (const id of ids) logins.add(state.players[id]?.twitchLogin ?? liveLogin.get(id) ?? id);
  return logins;
}

const newPlayers = new Set<string>();

function ensurePlayer(
  state: TrackerState,
  p: { id: string; name: string; uuid: string },
  now: string,
): PlayerState {
  let ps = state.players[p.id];
  if (!ps) {
    ps = {
      id: p.id,
      name: p.name,
      uuid: p.uuid,
      online: false,
      live: null,
      stats: {},
      firstSeen: now,
      lastSeen: now,
      sessionStart: null,
      trackedSeconds: 0,
      sessions: 0,
      liveSince: null,
      peakViewers: 0,
      longestSession: 0,
      ranks: {},
      twitchLogin: null,
    };
    state.players[p.id] = ps;
    newPlayers.add(p.id);
  }
  ps.name = p.name || ps.name;
  ps.uuid = p.uuid || ps.uuid;
  return ps;
}

/** Vergleicht neuen Snapshot mit dem gespeicherten Zustand und erzeugt Ereignisse. */
export function diffSnapshot(
  state: TrackerState,
  stats: ApiStats,
  nowDate = new Date(),
  ext: Map<string, ExtPlayer> = new Map(),
): TrackerEvent[] {
  const now = nowDate.toISOString();
  const events: TrackerEvent[] = [];
  const push = (e: Omit<TrackerEvent, "id" | "at">) => events.push({ id: eventId(now), at: now, ...e });

  const first = state.latest === null;

  // --- Server-Status
  if (state.serverOnline !== null && state.serverOnline !== stats.serverOnline) {
    push({
      type: stats.serverOnline ? "server_online" : "server_offline",
      where: "server",
      meta: { onlineCount: stats.onlineCount },
    });
  }
  state.serverOnline = stats.serverOnline;

  // --- Online-Spieler: Join / Leave
  newPlayers.clear();
  const onlineNow = new Set(stats.online.map((p) => p.id));
  for (const p of stats.online) {
    const ps = ensurePlayer(state, p, now);
    ps.lastSeen = now;
    if (!ps.online) {
      ps.online = true;
      ps.sessionStart = now;
      ps.sessions += 1;
      if (!first) {
        push({
          type: newPlayers.has(p.id) ? "first_join" : "join",
          player: p.id,
          playerName: p.name,
          uuid: p.uuid,
          where: "server",
        });
      }
    }
  }
  for (const ps of Object.values(state.players)) {
    if (ps.online && !onlineNow.has(ps.id)) {
      ps.online = false;
      const started = ps.sessionStart ? Date.parse(ps.sessionStart) : nowDate.getTime();
      const dur = Math.max(0, Math.round((nowDate.getTime() - started) / 1000));
      ps.trackedSeconds += dur;
      ps.longestSession = Math.max(ps.longestSession ?? 0, dur);
      ps.sessionStart = null;
      push({
        type: "leave",
        player: ps.id,
        playerName: ps.name,
        uuid: ps.uuid,
        where: "server",
        meta: { sessionSeconds: dur },
      });
    }
  }

  // --- Twitch: Live-Status / Titel / Viewer
  const liveNow = new Map<string, ApiStats["live"][number]>();
  for (const l of stats.live ?? []) liveNow.set(l.id, l);
  for (const p of stats.online) {
    if (p.live && !liveNow.has(p.id)) liveNow.set(p.id, { ...p.live, id: p.id, name: p.name });
  }

  for (const l of liveNow.values()) {
    const ps = ensurePlayer(state, { id: l.id, name: l.name, uuid: state.players[l.id]?.uuid ?? "" }, now);
    const prev = ps.live;
    ps.peakViewers = Math.max(ps.peakViewers, l.viewers);
    if (!prev) {
      ps.liveSince = now;
      if (!first) {
        push({
          type: "stream_start",
          player: l.id,
          playerName: l.name,
          uuid: ps.uuid,
          where: "twitch",
          value: l.viewers,
          meta: { title: l.title, login: l.login },
        });
      }
    } else if (prev.title !== l.title) {
      push({
        type: "stream_title",
        player: l.id,
        playerName: l.name,
        uuid: ps.uuid,
        where: "twitch",
        value: l.viewers,
        meta: { title: l.title, previousTitle: prev.title, login: l.login },
      });
    }
    ps.live = { login: l.login, title: l.title, viewers: l.viewers };
    if (l.login) ps.twitchLogin = l.login;
  }
  for (const ps of Object.values(state.players)) {
    if (ps.live && !liveNow.has(ps.id)) {
      const since = ps.liveSince ? Date.parse(ps.liveSince) : nowDate.getTime();
      push({
        type: "stream_end",
        player: ps.id,
        playerName: ps.name,
        uuid: ps.uuid,
        where: "twitch",
        meta: {
          login: ps.live.login,
          streamSeconds: Math.max(0, Math.round((nowDate.getTime() - since) / 1000)),
          peakViewers: ps.peakViewers,
        },
      });
      ps.live = null;
      ps.liveSince = null;
    }
  }

  // --- Einzelstatistiken (/api/ext/<login>): Name und Ränge für alle abgefragten Spieler übernehmen
  for (const [id, x] of ext) {
    const ps = ensurePlayer(state, { id, name: x.name, uuid: state.players[id]?.uuid ?? "" }, now);
    ps.ranks = { ...x.ranks };
  }

  // --- Boards: Zähler-Deltas
  for (const key of BOARD_KEYS) {
    const list = stats.boards?.[key] ?? [];
    const prevList = state.latest?.boards?.[key] ?? [];
    // Wer neu in einer Top-10 auftaucht, lag vorher höchstens auf dem Wert des alten 10. Platzes
    // (bzw. bei 0, wenn die Liste noch nicht voll war). So wird z. B. der erste Tod eines Spielers
    // ihm zugeordnet statt als "unbekannt" zu landen.
    const floor = prevList.length >= 10 ? prevList[prevList.length - 1].value : 0;
    // Alle Spieler außerhalb der Top 10 kommen über die Einzelstatistik dazu (außer Spielzeit, die gibt es dort nicht).
    const inList = new Set(list.map((e) => e.id));
    const extEntries: (BoardEntry & { fromExt: true })[] = [];
    if (key !== "playtimeSeconds") {
      for (const [id, x] of ext) {
        if (inList.has(id)) continue;
        const value = x[key];
        if (typeof value !== "number") continue;
        extEntries.push({ id, name: x.name, uuid: state.players[id]?.uuid ?? "", value, fromExt: true });
      }
    }
    for (const entry of [...list, ...extEntries] as (BoardEntry & { fromExt?: true })[]) {
      const ps = ensurePlayer(state, entry, now);
      const known = ps.stats[key];
      ps.stats[key] = entry.value;
      const type = COUNTER_EVENTS[key];
      if (!type || first) continue;
      // Erster ext-Wert eines Spielers: nur merken, kein Ereignis (wir wissen nicht, wann das passiert ist)
      if (entry.fromExt && known === undefined) continue;
      const prev = known ?? floor;
      const delta = entry.value - prev;
      if (delta <= 0) continue;
      for (const m of MILESTONES[key] ?? []) {
        if (prev < m && entry.value >= m) {
          push({
            type: "milestone",
            player: entry.id,
            playerName: entry.name,
            uuid: entry.uuid,
            where: "server",
            value: m,
            meta: { board: key, label: BOARD_LABEL[key] },
          });
        }
      }
      if (delta < (MIN_DELTA[key] ?? 1)) continue;
      push({
        type,
        player: entry.id,
        playerName: entry.name,
        uuid: entry.uuid,
        where: "server",
        delta,
        value: entry.value,
      });
    }
    // Rang-Wechsel in den Top 3 (nur Aufstiege)
    if (!first) {
      for (let i = 0; i < Math.min(3, list.length); i++) {
        const entry = list[i];
        const before = prevList.findIndex((e) => e.id === entry.id);
        if (before === i) continue;
        if (before !== -1 && before < i) continue;
        push({
          type: "rank",
          player: entry.id,
          playerName: entry.name,
          uuid: entry.uuid,
          where: "server",
          value: i + 1,
          meta: { board: key, label: BOARD_LABEL[key], before: before === -1 ? null : before + 1, score: entry.value },
        });
      }
    }
  }

  // --- Totals: Tode, die keinem Spieler zugeordnet werden konnten
  // (z. B. Spieler, die der Tracker noch nie gesehen hat, oder wenn die ext-Abfrage fehlgeschlagen ist)
  if (!first && state.latest) {
    const prevDeaths = state.latest.totals?.deaths ?? 0;
    const explained = events.filter((e) => e.type === "death").reduce((s, e) => s + (e.delta ?? 0), 0);
    const unexplained = (stats.totals?.deaths ?? 0) - prevDeaths - explained;
    if (unexplained > 0) {
      push({
        type: "death",
        where: "server",
        delta: unexplained,
        value: stats.totals.deaths,
        meta: { unknown: true },
      });
    }
  }

  // --- Verlauf
  const viewers = [...liveNow.values()].reduce((s, l) => s + l.viewers, 0);
  state.history.push({
    at: now,
    onlineCount: stats.onlineCount,
    liveCount: liveNow.size,
    viewers,
    playtimeSeconds: stats.totals?.playtimeSeconds ?? 0,
    deaths: stats.totals?.deaths ?? 0,
  });

  // --- Rekorde (seit Tracker-Start)
  const rec = state.records;
  const bump = (key: keyof typeof rec, value: number, label: string, notify: (prev: number) => boolean) => {
    const prev = rec[key]?.value ?? -1;
    if (value <= prev) return;
    const had = rec[key] !== null;
    rec[key] = { value, at: now };
    if (!first && had && notify(prev)) {
      push({ type: "record", where: "server", value, delta: value - prev, meta: { key, label } });
    }
  };
  bump("peakOnline", stats.onlineCount, "Spieler gleichzeitig online", () => true);
  bump("peakLive", liveNow.size, "Streams gleichzeitig live", () => true);
  bump("peakViewers", viewers, "Zuschauer gesamt", (prev) => Math.floor(viewers / 10000) > Math.floor(prev / 10000));

  state.latest = stats;
  state.lastOk = now;
  state.eventCount += events.length;
  return events;
}

let polling = false;
export async function pollOnce(): Promise<{ ok: boolean; events: number; error?: string }> {
  if (polling) return { ok: false, events: 0, error: "busy" };
  polling = true;
  try {
    const state = await getState();
    const now = new Date();
    state.lastPoll = now.toISOString();
    state.polls += 1;
    try {
      const stats = await fetchStats();
      // Einzelstatistiken für alle bekannten Spieler – Fehler hier sind nicht fatal, dann gibt es eben nur die Top 10
      const ext = await fetchExtAll(extLogins(state, stats, knownPlayerIds(state, stats)));
      if (ext.failed > 0) console.warn(`[tracker] ${ext.failed} ext-Anfragen fehlgeschlagen`);
      const first = state.latest === null;
      const events = diffSnapshot(state, stats, now, ext.players);
      if (first) {
        events.unshift({
          id: eventId(now.toISOString()),
          at: now.toISOString(),
          type: "tracker_start",
          where: "tracker",
          meta: { online: stats.onlineCount, live: stats.live?.length ?? 0 },
        });
        state.eventCount += 1;
      }
      state.lastError = null;
      await appendEvents(events);
      await saveState(state);
      await recordPlayerPoints(Object.values(state.players), now.toISOString());
      return { ok: true, events: events.length };
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      await saveState(state);
      return { ok: false, events: 0, error: state.lastError };
    }
  } finally {
    polling = false;
  }
}

type Globals = typeof globalThis & { __acPollTimer?: ReturnType<typeof setInterval> };

/** Startet die Endlosschleife (einmal pro Prozess). */
export function startPolling() {
  const gl = globalThis as Globals;
  if (gl.__acPollTimer) return;
  const tick = () => {
    pollOnce().catch((e) => console.error("[tracker] poll failed", e));
  };
  tick();
  gl.__acPollTimer = setInterval(tick, POLL_INTERVAL_MS);
  console.log(`[tracker] polling ${STATS_URL} alle ${POLL_INTERVAL_MS / 1000}s`);
}
