import "server-only";
import { getDb } from "./db";
import type { PlayerPoint, PlayerState, TotalsPoint, TrackerEvent, TrackerRecords, TrackerState } from "./types";

const MAX_EVENTS_IN_MEMORY = 20000;
const MAX_HISTORY_POINTS = 2880; // 24 h bei 30 s

type Globals = typeof globalThis & {
  __acTracker?: {
    state: TrackerState | null;
    events: TrackerEvent[];
    loaded: Promise<void> | null;
    /** Anzahl History-Punkte, die bereits in der DB liegen */
    historySaved: number;
  };
};

function g() {
  const gl = globalThis as Globals;
  if (!gl.__acTracker) gl.__acTracker = { state: null, events: [], loaded: null, historySaved: 0 };
  return gl.__acTracker;
}

export function freshState(): TrackerState {
  return {
    startedAt: new Date().toISOString(),
    lastPoll: null,
    lastOk: null,
    lastError: null,
    polls: 0,
    serverOnline: null,
    latest: null,
    players: {},
    history: [],
    eventCount: 0,
    records: { peakOnline: null, peakViewers: null, peakLive: null },
  };
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

/* ---------- Zeilen ↔ Objekte ---------- */

interface MetaRow {
  started_at: Date;
  last_poll: Date | null;
  last_ok: Date | null;
  last_error: string | null;
  polls: number;
  server_online: boolean | null;
  latest: TrackerState["latest"];
  event_count: number;
  records: TrackerRecords | null;
}

interface PlayerRow {
  id: string;
  name: string;
  uuid: string;
  online: boolean;
  live: PlayerState["live"];
  stats: PlayerState["stats"];
  ranks: PlayerState["ranks"] | null;
  first_seen: Date;
  last_seen: Date;
  session_start: Date | null;
  tracked_seconds: number;
  sessions: number;
  live_since: Date | null;
  peak_viewers: number;
  longest_session: number;
}

interface EventRow {
  id: string;
  at: Date;
  type: TrackerEvent["type"];
  player: string | null;
  player_name: string | null;
  uuid: string | null;
  where: TrackerEvent["where"];
  delta: number | null;
  value: number | null;
  meta: TrackerEvent["meta"] | null;
}

interface HistoryRow {
  at: Date;
  online_count: number;
  live_count: number;
  viewers: number;
  playtime_seconds: number | string;
  deaths: number;
}

function rowToPlayer(r: PlayerRow): PlayerState {
  return {
    id: r.id,
    name: r.name,
    uuid: r.uuid,
    online: r.online,
    live: r.live,
    stats: r.stats ?? {},
    ranks: r.ranks ?? {},
    firstSeen: iso(r.first_seen)!,
    lastSeen: iso(r.last_seen)!,
    sessionStart: iso(r.session_start),
    trackedSeconds: r.tracked_seconds,
    sessions: r.sessions,
    liveSince: iso(r.live_since),
    peakViewers: r.peak_viewers,
    longestSession: r.longest_session ?? 0,
  };
}

function rowToEvent(r: EventRow): TrackerEvent {
  const e: TrackerEvent = { id: r.id, at: iso(r.at)!, type: r.type, where: r.where };
  if (r.player) e.player = r.player;
  if (r.player_name) e.playerName = r.player_name;
  if (r.uuid) e.uuid = r.uuid;
  if (r.delta !== null) e.delta = Number(r.delta);
  if (r.value !== null) e.value = Number(r.value);
  if (r.meta) e.meta = r.meta;
  return e;
}

function rowToPoint(r: HistoryRow): TotalsPoint {
  return {
    at: iso(r.at)!,
    onlineCount: r.online_count,
    liveCount: r.live_count,
    viewers: r.viewers,
    playtimeSeconds: Number(r.playtime_seconds),
    deaths: r.deaths,
  };
}

/* ---------- Laden ---------- */

async function loadFromDb() {
  const store = g();
  const db = await getDb();

  const meta = (await db.query<MetaRow>(`SELECT * FROM tracker_meta WHERE id = 1`)).rows[0];
  const state = freshState();
  if (meta) {
    state.startedAt = iso(meta.started_at)!;
    state.lastPoll = iso(meta.last_poll);
    state.lastOk = iso(meta.last_ok);
    state.lastError = meta.last_error;
    state.polls = meta.polls;
    state.serverOnline = meta.server_online;
    state.latest = meta.latest;
    state.eventCount = meta.event_count;
    if (meta.records) state.records = { ...state.records, ...meta.records };
  }

  const players = (await db.query<PlayerRow>(`SELECT * FROM players`)).rows;
  for (const r of players) state.players[r.id] = rowToPlayer(r);

  const hist = (
    await db.query<HistoryRow>(`SELECT * FROM history ORDER BY at DESC LIMIT $1`, [MAX_HISTORY_POINTS])
  ).rows;
  state.history = hist.reverse().map(rowToPoint);
  store.historySaved = state.history.length;

  const events = (
    await db.query<EventRow>(`SELECT * FROM events ORDER BY at DESC, id DESC LIMIT $1`, [MAX_EVENTS_IN_MEMORY])
  ).rows;
  store.events = events.reverse().map(rowToEvent);

  const total = (await db.query<{ n: number | string }>(`SELECT count(*)::int AS n FROM events`)).rows[0];
  state.eventCount = Math.max(state.eventCount, Number(total?.n ?? 0));

  store.state = state;
}

export async function ensureLoaded() {
  const store = g();
  if (!store.loaded) store.loaded = loadFromDb();
  await store.loaded;
}

export async function getState(): Promise<TrackerState> {
  await ensureLoaded();
  const state = g().state!;
  // Felder, die nach einem Update neu dazugekommen sind, bei altem In-Memory-Zustand nachziehen
  state.records ??= { peakOnline: null, peakViewers: null, peakLive: null };
  for (const p of Object.values(state.players)) {
    p.longestSession ??= 0;
    p.ranks ??= {};
  }
  return state;
}

export async function getEvents(): Promise<TrackerEvent[]> {
  await ensureLoaded();
  return g().events;
}

/* ---------- Speichern ---------- */

export async function saveState(state: TrackerState) {
  await ensureLoaded();
  const store = g();
  const db = await getDb();

  if (state.history.length > MAX_HISTORY_POINTS) {
    const drop = state.history.length - MAX_HISTORY_POINTS;
    state.history = state.history.slice(drop);
    store.historySaved = Math.max(0, store.historySaved - drop);
  }
  store.state = state;

  await db.query(
    `INSERT INTO tracker_meta (id, started_at, last_poll, last_ok, last_error, polls, server_online, latest, event_count, records)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       started_at = EXCLUDED.started_at, last_poll = EXCLUDED.last_poll, last_ok = EXCLUDED.last_ok,
       last_error = EXCLUDED.last_error, polls = EXCLUDED.polls, server_online = EXCLUDED.server_online,
       latest = EXCLUDED.latest, event_count = EXCLUDED.event_count, records = EXCLUDED.records`,
    [
      toDate(state.startedAt),
      toDate(state.lastPoll),
      toDate(state.lastOk),
      state.lastError,
      state.polls,
      state.serverOnline,
      state.latest ? JSON.stringify(state.latest) : null,
      state.eventCount,
      JSON.stringify(state.records),
    ],
  );

  // Spieler: alle upserten (≈100 Zeilen, ein Statement pro Spieler ist hier völlig ausreichend)
  for (const p of Object.values(state.players)) {
    await db.query(
      `INSERT INTO players (id, name, uuid, online, live, stats, first_seen, last_seen, session_start,
                            tracked_seconds, sessions, live_since, peak_viewers, longest_session, ranks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, uuid = EXCLUDED.uuid, online = EXCLUDED.online, live = EXCLUDED.live,
         stats = EXCLUDED.stats, first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
         session_start = EXCLUDED.session_start, tracked_seconds = EXCLUDED.tracked_seconds,
         sessions = EXCLUDED.sessions, live_since = EXCLUDED.live_since, peak_viewers = EXCLUDED.peak_viewers,
         longest_session = EXCLUDED.longest_session, ranks = EXCLUDED.ranks`,
      [
        p.id,
        p.name,
        p.uuid,
        p.online,
        p.live ? JSON.stringify(p.live) : null,
        JSON.stringify(p.stats),
        toDate(p.firstSeen),
        toDate(p.lastSeen),
        toDate(p.sessionStart),
        p.trackedSeconds,
        p.sessions,
        toDate(p.liveSince),
        p.peakViewers,
        p.longestSession,
        JSON.stringify(p.ranks ?? {}),
      ],
    );
  }

  // Verlauf: nur neue Punkte anhängen
  const fresh = state.history.slice(store.historySaved);
  for (const h of fresh) {
    await db.query(
      `INSERT INTO history (at, online_count, live_count, viewers, playtime_seconds, deaths)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (at) DO NOTHING`,
      [toDate(h.at), h.onlineCount, h.liveCount, h.viewers, h.playtimeSeconds, h.deaths],
    );
  }
  store.historySaved = state.history.length;
}

export async function appendEvents(events: TrackerEvent[]) {
  if (events.length === 0) return;
  await ensureLoaded();
  const store = g();
  const db = await getDb();
  store.events.push(...events);
  if (store.events.length > MAX_EVENTS_IN_MEMORY) {
    store.events = store.events.slice(-MAX_EVENTS_IN_MEMORY);
  }
  for (const e of events) {
    await db.query(
      `INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [
        e.id,
        toDate(e.at),
        e.type,
        e.player ?? null,
        e.playerName ?? null,
        e.uuid ?? null,
        e.where,
        e.delta ?? null,
        e.value ?? null,
        e.meta ? JSON.stringify(e.meta) : null,
      ],
    );
  }
}

/* ---------- Spieler-Zeitreihe ---------- */

const PLAYER_POINT_MAX_GAP_MS = 5 * 60_000;
const lastPoint = new Map<string, { at: number; sig: string }>();

function pointSignature(p: PlayerPoint) {
  return [p.online, p.viewers, p.playtimeSeconds, p.deaths, p.diamonds, p.blocksBroken, p.mobsKilled, p.distance].join("|");
}

/** Schreibt pro Spieler einen Punkt, wenn sich etwas geändert hat oder der letzte Punkt zu alt ist. */
export async function recordPlayerPoints(players: PlayerState[], at: string) {
  await ensureLoaded();
  const db = await getDb();
  const t = Date.parse(at);
  for (const p of players) {
    const hasData = p.online || p.live || Object.keys(p.stats).length > 0;
    if (!hasData) continue;
    const point: PlayerPoint = {
      at,
      online: p.online,
      viewers: p.live ? p.live.viewers : null,
      playtimeSeconds: p.stats.playtimeSeconds ?? null,
      deaths: p.stats.deaths ?? null,
      diamonds: p.stats.diamonds ?? null,
      blocksBroken: p.stats.blocksBroken ?? null,
      mobsKilled: p.stats.mobsKilled ?? null,
      distance: p.stats.distance ?? null,
    };
    const sig = pointSignature(point);
    const last = lastPoint.get(p.id);
    if (last && last.sig === sig && t - last.at < PLAYER_POINT_MAX_GAP_MS) continue;
    await db.query(
      `INSERT INTO player_history (player, at, online, viewers, playtime_seconds, deaths, diamonds, blocks_broken, mobs_killed, distance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (player, at) DO NOTHING`,
      [p.id, toDate(at), point.online, point.viewers, point.playtimeSeconds, point.deaths, point.diamonds, point.blocksBroken, point.mobsKilled, point.distance],
    );
    lastPoint.set(p.id, { at: t, sig });
  }
}

interface PlayerPointRow {
  at: Date;
  online: boolean;
  viewers: number | null;
  playtime_seconds: number | null;
  deaths: number | null;
  diamonds: number | null;
  blocks_broken: number | null;
  mobs_killed: number | null;
  distance: number | null;
}

export async function getPlayerHistory(id: string, limit = 3000): Promise<PlayerPoint[]> {
  await ensureLoaded();
  const db = await getDb();
  const rows = (
    await db.query<PlayerPointRow>(`SELECT * FROM player_history WHERE player = $1 ORDER BY at DESC LIMIT $2`, [id, limit])
  ).rows;
  return rows.reverse().map((r) => ({
    at: iso(r.at)!,
    online: r.online,
    viewers: r.viewers,
    playtimeSeconds: r.playtime_seconds,
    deaths: r.deaths,
    diamonds: r.diamonds,
    blocksBroken: r.blocks_broken,
    mobsKilled: r.mobs_killed,
    distance: r.distance === null ? null : Number(r.distance),
  }));
}

/* ---------- Komplette Bestenlisten (alle bekannten Spieler) ---------- */

export interface FullBoardEntry {
  id: string;
  name: string;
  uuid: string;
  value: number;
  /** Zeitpunkt, zu dem der Wert zuletzt in der API zu sehen war */
  at: string;
  online: boolean;
}

const COLUMN: Record<string, string> = {
  playtimeSeconds: "playtime_seconds",
  deaths: "deaths",
  diamonds: "diamonds",
  blocksBroken: "blocks_broken",
  mobsKilled: "mobs_killed",
  distance: "distance",
};

/** Letzter bekannter Wert pro Spieler für ein Board, absteigend sortiert. */
export async function getFullBoard(key: string): Promise<FullBoardEntry[]> {
  const col = COLUMN[key];
  if (!col) return [];
  await ensureLoaded();
  const db = await getDb();
  const rows = (
    await db.query<{ player: string; at: Date; value: number | string }>(
      `SELECT DISTINCT ON (player) player, at, ${col} AS value
         FROM player_history
        WHERE ${col} IS NOT NULL
        ORDER BY player, at DESC`,
    )
  ).rows;
  const players = g().state?.players ?? {};
  return rows
    .map((r) => {
      const p = players[r.player];
      return {
        id: r.player,
        name: p?.name ?? r.player,
        uuid: p?.uuid ?? "",
        value: Number(r.value),
        at: iso(r.at)!,
        online: p?.online ?? false,
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "de"));
}

/* ---------- Sessions aller Spieler (aus Join/Leave-Ereignissen) ---------- */

export interface StoredSession {
  player: string;
  start: string;
  end: string | null;
}

/**
 * Baut aus allen Join/Leave-Ereignissen in der DB die Sessions aller Spieler.
 * Laufende Sessions (Spieler gerade online) haben `end = null`.
 */
export async function getAllSessions(): Promise<StoredSession[]> {
  await ensureLoaded();
  const db = await getDb();
  const rows = (
    await db.query<{ player: string; at: Date; type: string; meta: TrackerEvent["meta"] | null }>(
      `SELECT player, at, type, meta FROM events
        WHERE type IN ('join', 'first_join', 'leave') AND player IS NOT NULL
        ORDER BY at ASC, id ASC`,
    )
  ).rows;
  const open = new Map<string, string>();
  const out: StoredSession[] = [];
  for (const r of rows) {
    const at = iso(r.at)!;
    if (r.type === "leave") {
      const secs = Number(r.meta?.sessionSeconds ?? 0);
      const start = open.get(r.player) ?? new Date(Date.parse(at) - secs * 1000).toISOString();
      out.push({ player: r.player, start, end: at });
      open.delete(r.player);
    } else {
      open.set(r.player, at);
    }
  }
  const players = g().state?.players ?? {};
  for (const [player, start] of open) {
    const p = players[player];
    // Nur wirklich noch laufende Sessions bleiben offen; sonst Ende unbekannt → beim letzten Gesehen-Zeitpunkt
    out.push({ player, start, end: p?.online ? null : (p?.lastSeen ?? start) });
  }
  // Spieler, die beim Tracker-Start schon online waren (kein Join-Ereignis), über sessionStart ergänzen
  for (const p of Object.values(players)) {
    if (p.online && p.sessionStart && !out.some((s) => s.player === p.id && s.end === null)) {
      out.push({ player: p.id, start: p.sessionStart, end: null });
    }
  }
  return out;
}
