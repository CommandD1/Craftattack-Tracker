import "server-only";
import { connection } from "next/server";
import { getDb } from "./db";
import { ensureLoaded, getAllSessions, getDailyEventSum, getEvents, getState, type StoredSession } from "./store";
import { EVENT_META } from "./events";
import type { BoardKey, TrackerEvent } from "./types";
import { BOARD_KEYS } from "./types";

/* ============================================================ Tage (Europe/Berlin) */

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
const partsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", weekday: "short", hourCycle: "h23" });

/** Kalendertag (YYYY-MM-DD) in Berliner Zeit */
export const dayKey = (ms: number) => dayFmt.format(new Date(ms));

/** Mitternacht (Berlin) eines Tages als Millisekunden – robust gegen Sommer-/Winterzeit */
export function dayStart(day: string): number {
  let t = Date.parse(`${day}T00:00:00Z`) - 2 * 3600_000; // Startschätzung (MESZ)
  for (let i = 0; i < 3; i++) {
    const hour = Number(partsFmt.formatToParts(new Date(t)).find((p) => p.type === "hour")?.value ?? 0);
    const key = dayKey(t);
    if (key === day && hour === 0) return t;
    // Korrigieren: Stunden-Differenz zurückrechnen
    const dayDiff = key < day ? 1 : key > day ? -1 : 0;
    t += dayDiff * 86400_000 - hour * 3600_000;
  }
  return t;
}

export function shiftDay(day: string, days: number): string {
  return dayKey(dayStart(day) + 12 * 3600_000 + days * 86400_000);
}

export const isValidDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** Berliner Wochentag (0 = Montag) und Stunde eines Zeitpunkts */
function berlinSlot(ms: number): { dow: number; hour: number } {
  const parts = partsFmt.formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
  return { dow: dow < 0 ? 0 : dow, hour: hour % 24 };
}

/* ============================================================ Cache */

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  await connection();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ============================================================ Streams als Sessions */

/** Live-Phasen aller Spieler aus Stream-an/aus-Ereignissen (laufende Streams: end = null). */
export async function getLiveSessions(): Promise<StoredSession[]> {
  await ensureLoaded();
  const db = await getDb();
  const rows = (
    await db.query<{ player: string; at: Date; type: string; meta: TrackerEvent["meta"] | null }>(
      `SELECT player, at, type, meta FROM events WHERE type IN ('stream_start', 'stream_end') AND player IS NOT NULL ORDER BY at ASC, id ASC`,
    )
  ).rows;
  const open = new Map<string, string>();
  const out: StoredSession[] = [];
  for (const r of rows) {
    const at = new Date(r.at).toISOString();
    if (r.type === "stream_end") {
      const secs = Number(r.meta?.streamSeconds ?? 0);
      const start = open.get(r.player) ?? new Date(Date.parse(at) - secs * 1000).toISOString();
      out.push({ player: r.player, start, end: at });
      open.delete(r.player);
    } else open.set(r.player, at);
  }
  const state = await getState();
  for (const [player, start] of open) {
    const p = state.players[player];
    out.push({ player, start, end: p?.live ? null : (p?.lastSeen ?? start) });
  }
  for (const p of Object.values(state.players)) {
    if (p.live && p.liveSince && !out.some((s) => s.player === p.id && s.end === null)) out.push({ player: p.id, start: p.liveSince, end: null });
  }
  return out;
}

/** Erster Zeitpunkt, ab dem es Daten gibt */
async function firstDataAt(): Promise<number | null> {
  return cached("firstAt", 300_000, async () => {
    await ensureLoaded();
    const db = await getDb();
    const r = (await db.query<{ at: Date | null }>(`SELECT min(at) AS at FROM history`)).rows[0];
    return r?.at ? new Date(r.at).getTime() : null;
  });
}

type Span = [number, number];

function clip(sessions: StoredSession[], from: number, to: number, now: number): Map<string, Span[]> {
  const out = new Map<string, Span[]>();
  for (const s of sessions) {
    const a = Math.max(from, Date.parse(s.start));
    const b = Math.min(to, s.end ? Date.parse(s.end) : now);
    if (b <= a) continue;
    const l = out.get(s.player) ?? [];
    l.push([a, b]);
    out.set(s.player, l);
  }
  for (const l of out.values()) l.sort((x, y) => x[0] - y[0]);
  return out;
}

export interface DayNav {
  day: string;
  prev: string | null;
  next: string | null;
  from: number;
  to: number;
  /** Ab wann an diesem Tag Daten vorliegen (null = ganzer Tag) */
  dataFrom: number | null;
}

async function dayNav(day: string | undefined, now: number): Promise<DayNav> {
  const today = dayKey(now);
  const d = day && isValidDay(day) && day <= today ? day : today;
  const first = await firstDataAt();
  const firstDay = first ? dayKey(first) : today;
  const from = dayStart(d);
  const to = dayStart(shiftDay(d, 1));
  return {
    day: d,
    prev: d > firstDay ? shiftDay(d, -1) : null,
    next: d < today ? shiftDay(d, 1) : null,
    from,
    to,
    dataFrom: first !== null && first > from && first < to ? first : null,
  };
}

/* ============================================================ Zeitstrahl */

export interface TimelineRow {
  id: string;
  name: string;
  uuid: string;
  online: Span[];
  live: Span[];
  seconds: number;
}

export async function getDayTimeline(day?: string): Promise<{ nav: DayNav; rows: TimelineRow[]; now: number }> {
  const now = Date.now();
  const nav = await dayNav(day, now);
  const [sessions, lives, state] = await Promise.all([getAllSessions(), getLiveSessions(), getState()]);
  const on = clip(sessions, nav.from, nav.to, now);
  const li = clip(lives, nav.from, nav.to, now);
  const ids = new Set([...on.keys(), ...li.keys()]);
  const rows: TimelineRow[] = [...ids].map((id) => {
    const p = state.players[id];
    const o = on.get(id) ?? [];
    return { id, name: p?.name ?? id, uuid: p?.uuid ?? "", online: o, live: li.get(id) ?? [], seconds: o.reduce((s, [a, b]) => s + (b - a) / 1000, 0) };
  });
  rows.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "de"));
  return { nav, rows, now };
}

/* ============================================================ Zeitraffer */

export interface TimelapseFrame {
  at: number;
  /** Indizes in `players` */
  online: number[];
  live: number[];
  deaths: number | null;
  viewers: number | null;
  messages: string[];
}

export interface Timelapse {
  nav: DayNav;
  stepMinutes: number;
  players: { id: string; name: string; uuid: string }[];
  frames: TimelapseFrame[];
}

const TIMELAPSE_TYPES = new Set<TrackerEvent["type"]>(["death", "first_join", "milestone", "record", "rank", "server_online", "server_offline", "stream_start"]);

export async function getTimelapse(day?: string): Promise<Timelapse> {
  const now = Date.now();
  const nav = await dayNav(day, now);
  const step = 5;
  const stepMs = step * 60_000;
  const [sessions, lives, state, events] = await Promise.all([getAllSessions(), getLiveSessions(), getState(), getEvents()]);
  await ensureLoaded();
  const db = await getDb();
  const hist = (
    await db.query<{ at: Date; deaths: number | string; viewers: number | string }>(
      `SELECT to_timestamp(floor(extract(epoch FROM at) / $1) * $1) AS at, max(deaths) AS deaths, max(viewers) AS viewers
         FROM history WHERE at >= $2 AND at < $3 GROUP BY 1 ORDER BY 1`,
      [step * 60, new Date(nav.from), new Date(nav.to)],
    )
  ).rows;
  const histAt = new Map(hist.map((h) => [new Date(h.at).getTime(), h]));

  const on = clip(sessions, nav.from, nav.to, now);
  const li = clip(lives, nav.from, nav.to, now);
  const ids = [...new Set([...on.keys(), ...li.keys()])];
  const players = ids
    .map((id) => ({ id, name: state.players[id]?.name ?? id, uuid: state.players[id]?.uuid ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const index = new Map(players.map((p, i) => [p.id, i]));
  const covers = (spans: Span[] | undefined, t: number) => Boolean(spans?.some(([a, b]) => a <= t && t < b));

  // Ereignisse des Tages als kurze Texte
  const dayEvents = events.filter((e) => {
    const t = Date.parse(e.at);
    return t >= nav.from && t < nav.to && TIMELAPSE_TYPES.has(e.type) && !(e.type === "death" && e.meta?.unknown);
  });
  const text = (e: TrackerEvent) => `${e.player ? `${e.playerName ?? e.player} ` : ""}${EVENT_META[e.type].text(e)}`;

  const end = Math.min(nav.to, now);
  const frames: TimelapseFrame[] = [];
  let ei = 0;
  const sorted = [...dayEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let lastDeaths: number | null = null;
  for (let t = nav.from; t <= end; t += stepMs) {
    const online: number[] = [];
    const live: number[] = [];
    for (const id of ids) {
      const i = index.get(id)!;
      if (covers(on.get(id), t)) online.push(i);
      if (covers(li.get(id), t)) live.push(i);
    }
    const h = histAt.get(t);
    if (h) lastDeaths = Number(h.deaths);
    const messages: string[] = [];
    while (ei < sorted.length && Date.parse(sorted[ei].at) <= t) {
      if (Date.parse(sorted[ei].at) > t - stepMs) messages.push(text(sorted[ei]));
      ei++;
    }
    frames.push({ at: t, online, live, deaths: h ? Number(h.deaths) : lastDeaths, viewers: h ? Number(h.viewers) : null, messages: messages.slice(0, 6) });
  }
  return { nav, stepMinutes: step, players, frames };
}

/* ============================================================ Statistik-Erweiterungen */

export interface DayRow {
  day: string;
  players: number;
  maxOnline: number;
  playerHours: number;
  deaths: number;
  maxViewers: number;
}
export interface StatsExtras {
  heatmap: (number | null)[][]; // [7][24] Ø online
  days: DayRow[];
  deathsByHour: { hour: number; deaths: number; playerHours: number; rate: number | null }[];
  deathStreaks: { id: string; name: string; uuid: string; count: number; from: string; to: string }[];
  deathRate: { id: string; name: string; uuid: string; deaths: number; hours: number; perHour: number }[];
  loyalty: {
    perDay: { day: string; players: number }[];
    groups: { h24: number; d3: number; d7: number; gone: number };
    gone: { id: string; name: string; uuid: string; days: number; lastSeen: string }[];
    total: number;
  };
  availability: {
    ratio: number | null;
    outages: { from: string; to: string | null; minutes: number | null }[];
    gaps: { from: string; to: string; minutes: number }[];
  };
  fullest: { at: string; value: number }[];
  mostViewers: { at: string; value: number }[];
  totals: { playerHours: number; players: number };
}

export async function getStatsExtras(): Promise<StatsExtras> {
  return cached("statsExtras", 120_000, async () => {
    const now = Date.now();
    await ensureLoaded();
    const db = await getDb();
    const [hourly, deathsPerDay, sessions, state, events, gapRows, topOnline, topViewers] = await Promise.all([
      db.query<{ h: Date; avg_online: number | string; max_online: number; max_viewers: number; n: number | string }>(
        `SELECT date_trunc('hour', at) AS h, avg(online_count) AS avg_online, max(online_count) AS max_online, max(viewers) AS max_viewers, count(*) AS n
           FROM history GROUP BY 1 ORDER BY 1`,
      ),
      getDailyEventSum("death"),
      getAllSessions(),
      getState(),
      getEvents(),
      db.query<{ at: Date; prev: Date }>(
        `SELECT at, prev FROM (SELECT at, lag(at) OVER (ORDER BY at) AS prev FROM history) x WHERE prev IS NOT NULL AND at - prev > interval '5 minutes' ORDER BY at DESC LIMIT 20`,
      ),
      db.query<{ at: Date; v: number }>(`SELECT at, online_count AS v FROM history ORDER BY online_count DESC, at ASC LIMIT 400`),
      db.query<{ at: Date; v: number }>(`SELECT at, viewers AS v FROM history ORDER BY viewers DESC, at ASC LIMIT 400`),
    ]);

    // Heatmap Wochentag × Stunde (Ø online)
    const sum = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const cnt = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const hourOfDay = Array(24).fill(0) as number[]; // Spielerstunden je Tagesstunde
    const dayAgg = new Map<string, { maxOnline: number; maxViewers: number; playerHours: number }>();
    for (const r of hourly.rows) {
      const t = new Date(r.h).getTime();
      const { dow, hour } = berlinSlot(t + 1800_000);
      const avg = Number(r.avg_online);
      // Anteil der Stunde, der tatsächlich beobachtet wurde (30-s-Takt → max. 120 Punkte)
      const share = Math.min(1, Number(r.n) / 110);
      sum[dow][hour] += avg;
      cnt[dow][hour] += 1;
      hourOfDay[hour] += avg * share;
      const d = dayKey(t + 1800_000);
      const a = dayAgg.get(d) ?? { maxOnline: 0, maxViewers: 0, playerHours: 0 };
      a.maxOnline = Math.max(a.maxOnline, r.max_online);
      a.maxViewers = Math.max(a.maxViewers, r.max_viewers);
      a.playerHours += avg * share;
      dayAgg.set(d, a);
    }
    const heatmap = sum.map((row, d) => row.map((v, h) => (cnt[d][h] ? Math.round((v / cnt[d][h]) * 10) / 10 : null)));

    // Spieler pro Tag und Spielstunden pro Tag aus Sessions
    const playersPerDay = new Map<string, Set<string>>();
    const hoursPerDay = new Map<string, number>();
    const trackedSec = new Map<string, number>();
    for (const s of sessions) {
      const a = Date.parse(s.start);
      const b = s.end ? Date.parse(s.end) : now;
      if (b <= a) continue;
      trackedSec.set(s.player, (trackedSec.get(s.player) ?? 0) + (b - a) / 1000);
      let t = a;
      while (t < b) {
        const d = dayKey(t);
        const next = Math.min(b, dayStart(shiftDay(d, 1)));
        (playersPerDay.get(d) ?? playersPerDay.set(d, new Set()).get(d)!).add(s.player);
        hoursPerDay.set(d, (hoursPerDay.get(d) ?? 0) + (next - t) / 3600_000);
        t = next;
      }
    }
    const deathsDay = new Map(deathsPerDay.map((d) => [d.day, d.value]));
    const allDays = [...new Set([...dayAgg.keys(), ...playersPerDay.keys()])].sort();
    const days: DayRow[] = allDays.map((day) => ({
      day,
      players: playersPerDay.get(day)?.size ?? 0,
      maxOnline: dayAgg.get(day)?.maxOnline ?? 0,
      playerHours: hoursPerDay.get(day) ?? dayAgg.get(day)?.playerHours ?? 0,
      deaths: deathsDay.get(day) ?? 0,
      maxViewers: dayAgg.get(day)?.maxViewers ?? 0,
    }));

    // Tode nach Tagesstunde
    const deathEvents = events.filter((e) => e.type === "death");
    const deathsHour = Array(24).fill(0) as number[];
    for (const e of deathEvents) deathsHour[berlinSlot(Date.parse(e.at)).hour] += e.delta ?? 1;
    const deathsByHour = deathsHour.map((d, hour) => {
      const ph = hourOfDay[hour];
      return { hour, deaths: d, playerHours: Math.round(ph), rate: ph >= 3 ? Math.round((d / ph) * 100 * 10) / 10 : null };
    });

    // Tod-Serien (≥ 3 Tode eines Spielers in 60 Minuten)
    const byPlayer = new Map<string, TrackerEvent[]>();
    for (const e of deathEvents) if (e.player && !e.meta?.unknown) (byPlayer.get(e.player) ?? byPlayer.set(e.player, []).get(e.player)!).push(e);
    const deathStreaks: StatsExtras["deathStreaks"] = [];
    for (const [id, list] of byPlayer) {
      list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      let i = 0;
      while (i < list.length) {
        let j = i;
        let count = 0;
        while (j < list.length && Date.parse(list[j].at) - Date.parse(list[i].at) <= 3600_000) count += list[j++].delta ?? 1;
        if (count >= 3) {
          deathStreaks.push({ id, name: list[i].playerName ?? id, uuid: list[i].uuid ?? "", count, from: list[i].at, to: list[j - 1].at });
          i = j;
        } else i++;
      }
    }
    deathStreaks.sort((a, b) => b.count - a.count || Date.parse(b.from) - Date.parse(a.from));

    // Todesrate je Spieler (Tode laut Ereignissen / getrackte Online-Stunden)
    const deathRate: StatsExtras["deathRate"] = [];
    for (const [id, list] of byPlayer) {
      const hours = (trackedSec.get(id) ?? 0) / 3600;
      const deaths = list.reduce((s, e) => s + (e.delta ?? 1), 0);
      if (hours < 1 || deaths < 2) continue;
      deathRate.push({ id, name: state.players[id]?.name ?? id, uuid: state.players[id]?.uuid ?? "", deaths, hours: Math.round(hours * 10) / 10, perHour: Math.round((deaths / hours) * 100) / 100 });
    }
    deathRate.sort((a, b) => b.perHour - a.perHour);

    // Treue
    const players = Object.values(state.players).filter((p) => p.sessions > 0 || p.online);
    const groups = { h24: 0, d3: 0, d7: 0, gone: 0 };
    const gone: StatsExtras["loyalty"]["gone"] = [];
    for (const p of players) {
      const ageDays = p.online ? 0 : (now - Date.parse(p.lastSeen)) / 86400_000;
      if (ageDays <= 1) groups.h24++;
      else if (ageDays <= 3) groups.d3++;
      else if (ageDays <= 7) groups.d7++;
      else groups.gone++;
      if (ageDays > 3) gone.push({ id: p.id, name: p.name, uuid: p.uuid, days: Math.floor(ageDays), lastSeen: p.lastSeen });
    }
    gone.sort((a, b) => b.days - a.days);
    const loyalty = { perDay: allDays.map((day) => ({ day, players: playersPerDay.get(day)?.size ?? 0 })), groups, gone, total: players.length };

    // Verfügbarkeit
    const first = hourly.rows.length ? new Date(hourly.rows[0].h).getTime() : now;
    const serverEvents = events.filter((e) => e.type === "server_online" || e.type === "server_offline").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const outages: StatsExtras["availability"]["outages"] = [];
    let offlineSince: string | null = state.latest && state.latest.serverOnline === false && serverEvents.length === 0 ? state.startedAt : null;
    for (const e of serverEvents) {
      if (e.type === "server_offline") offlineSince = e.at;
      else if (offlineSince) {
        outages.push({ from: offlineSince, to: e.at, minutes: Math.round((Date.parse(e.at) - Date.parse(offlineSince)) / 60_000) });
        offlineSince = null;
      }
    }
    if (offlineSince) outages.push({ from: offlineSince, to: null, minutes: null });
    const offlineMs = outages.reduce((s, o) => s + ((o.to ? Date.parse(o.to) : now) - Date.parse(o.from)), 0);
    const span = now - first;
    const gaps = gapRows.rows.map((r) => ({ from: new Date(r.prev).toISOString(), to: new Date(r.at).toISOString(), minutes: Math.round((new Date(r.at).getTime() - new Date(r.prev).getTime()) / 60_000) }));
    const availability = { ratio: span > 3600_000 ? Math.max(0, 1 - offlineMs / span) : null, outages: outages.reverse().slice(0, 10), gaps };

    // Vollste Momente (mind. 2 h Abstand)
    const spread = (rows: { at: Date; v: number }[]) => {
      const out: { at: string; value: number }[] = [];
      for (const r of rows) {
        const t = new Date(r.at).getTime();
        if (out.some((o) => Math.abs(Date.parse(o.at) - t) < 2 * 3600_000)) continue;
        out.push({ at: new Date(t).toISOString(), value: Number(r.v) });
        if (out.length >= 8) break;
      }
      return out;
    };

    const totals = { playerHours: [...hoursPerDay.values()].reduce((s, v) => s + v, 0), players: players.length };
    return { heatmap, days, deathsByHour, deathStreaks: deathStreaks.slice(0, 10), deathRate: deathRate.slice(0, 10), loyalty, availability, fullest: spread(topOnline.rows), mostViewers: spread(topViewers.rows), totals };
  });
}

/* ============================================================ Startseite: Verlauf + Bewegung */

export interface TrendPoint {
  at: number;
  online: number;
  live: number;
  viewers: number;
}

/** Letzte `hours` Stunden Server-Verlauf, auf 2-Minuten-Bündel (Maximum) verdichtet. */
export async function getHistoryRange(hours: number): Promise<TrendPoint[]> {
  return cached(`range:${hours}`, 60_000, async () => {
    await ensureLoaded();
    const db = await getDb();
    const minutes = hours <= 6 ? 1 : hours <= 24 ? 2 : 5;
    const rows = (
      await db.query<{ at: Date; online: number; live: number; viewers: number }>(
        `SELECT to_timestamp(floor(extract(epoch FROM at) / ($1 * 60)) * ($1 * 60)) AS at, max(online_count) AS online, max(live_count) AS live, max(viewers) AS viewers
           FROM history WHERE at >= $2 GROUP BY 1 ORDER BY 1`,
        [minutes, new Date(Date.now() - hours * 3600_000)],
      )
    ).rows;
    return rows.map((r) => ({ at: new Date(r.at).getTime(), online: Number(r.online), live: Number(r.live), viewers: Number(r.viewers) }));
  });
}

/** Rang je Spieler vor 24 h in jedem Board (aus player_history), für ▲/▼ in den Bestenlisten. */
export async function getBoardRanksBefore(hoursAgo = 24): Promise<Partial<Record<BoardKey, Record<string, number>>>> {
  return cached(`ranksBefore:${hoursAgo}`, 300_000, async () => {
    await ensureLoaded();
    const db = await getDb();
    const col: Record<BoardKey, string> = { playtimeSeconds: "playtime_seconds", deaths: "deaths", diamonds: "diamonds", blocksBroken: "blocks_broken", mobsKilled: "mobs_killed", distance: "distance" };
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000);
    const out: Partial<Record<BoardKey, Record<string, number>>> = {};
    for (const key of BOARD_KEYS) {
      const rows = (
        await db.query<{ player: string; value: number | string }>(
          `SELECT DISTINCT ON (player) player, ${col[key]} AS value FROM player_history WHERE at <= $1 AND ${col[key]} IS NOT NULL ORDER BY player, at DESC`,
          [cutoff],
        )
      ).rows;
      rows.sort((a, b) => Number(b.value) - Number(a.value));
      out[key] = Object.fromEntries(rows.map((r, i) => [r.player, i + 1]));
    }
    return out;
  });
}

/**
 * Rang je Spieler vor `hoursAgo` Stunden in der Dauergäste-Liste (Online-Zeit laut Tracker).
 * Rückgerechnet aus den Sessions: aktuelle Tracker-Sekunden minus Online-Zeit innerhalb des Zeitfensters.
 */
export async function getTrackedRanksBefore(hoursAgo = 24): Promise<Record<string, number>> {
  return cached(`trackedRanksBefore:${hoursAgo}`, 300_000, async () => {
    const [state, sessions] = await Promise.all([getState(), getAllSessions()]);
    const now = Date.now();
    const cutoff = now - hoursAgo * 3600_000;
    const recent = new Map<string, number>();
    for (const s of sessions) {
      const start = Date.parse(s.start);
      const end = s.end ? Date.parse(s.end) : now;
      const overlap = Math.min(end, now) - Math.max(start, cutoff);
      if (overlap > 0) recent.set(s.player, (recent.get(s.player) ?? 0) + overlap / 1000);
    }
    const rows: { id: string; value: number }[] = [];
    for (const p of Object.values(state.players)) {
      const nowSecs = p.trackedSeconds + (p.online && p.sessionStart ? (now - Date.parse(p.sessionStart)) / 1000 : 0);
      const before = nowSecs - (recent.get(p.id) ?? 0);
      // Nur wer damals schon Online-Zeit hatte (und vor dem Zeitpunkt überhaupt bekannt war), hatte einen Platz
      if (before > 0 && Date.parse(p.firstSeen) <= cutoff) rows.push({ id: p.id, value: before });
    }
    rows.sort((a, b) => b.value - a.value);
    return Object.fromEntries(rows.map((r, i) => [r.id, i + 1]));
  });
}
