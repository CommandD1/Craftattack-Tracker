import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";
import { vodsBetween } from "./twitch";

/**
 * Zuschauerwanderung zwischen CraftAttack-Streams (interne Auswertung).
 *
 * Start eines Streams B: Für jeden anderen laufenden Stream A wird der Ø 5 Min vor dem Start mit 20–40 Min danach
 * verglichen, abzüglich der Änderung, die A über dieselbe Fensterlänge sonst hat (bei gleichem Streamalter und
 * gleicher Tageszeit, über alle Zeiten). Jeder Start zählt, egal wie groß B ist; entscheidend ist der Gesamtverlust
 * der anderen. Ende eines Streams A: Zuwachs der übrigen Streams 5–25 Min danach gegenüber 10 Min davor, ebenso
 * gegen das Übliche gerechnet („Erben“).
 *
 * Raids sind ein ausdrücklicher Wechsel, kein Abwandern: Streams, die im Fenster raiden oder geraidet werden, zählen
 * in keiner Berechnung mit; Raids stehen getrennt mit ihrer Zuschauerzahl. Startzeit ist die von Twitch
 * (`meta.startedAt`), nicht der Zeitpunkt, an dem der Tracker den Start bemerkte. Stream-Enden kommen aus dem
 * Zuschauerverlauf und zählen nur, wo der Tracker danach weiterlief (sonst wäre jeder Ausfall ein „Ende“).
 *
 * Grenzen: Ein Start betrifft viele Streams gleichzeitig, Starts und Enden überlagern sich; der t-Wert ist nur ein
 * grober Hinweis. Twitch-Zuschauerzahlen sind gerundet und verzögert.
 */

/** A zählt nur mit mindestens so vielen Zuschauern vorher (kleinere Zahlen schwanken zu stark) */
const MIN_VIEWERS = 20;
/** A muss so lange live sein (die eigene Aufwärmphase verzerrt sonst alles) */
const MIN_AGE_MIN = 30;
/** Lücke zwischen zwei Messpunkten, ab der eine neue Stream-Sitzung beginnt */
const SESSION_GAP_MIN = 15;
/** Start: vorher −5..0, nachher +20..+40 Minuten */
const START_WIN = { b0: -5, b1: 0, a0: 20, a1: 40 } as const;
/** Ende: vorher −10..0, nachher +5..+25 Minuten */
const END_WIN = { b0: -10, b1: 0, a0: 5, a1: 25 } as const;
const BASE_CACHE_MS = 10 * 60_000;
const ANALYSIS_CACHE_MS = 60 * 60_000;

type Win = { b0: number; b1: number; a0: number; a1: number };

interface Series {
  /** Minuten seit 1970 */
  t: Float64Array;
  v: Float64Array;
  /** Präfixsummen, cum[i] = Summe v[0..i-1] */
  cum: Float64Array;
  /** Beginn / Ende der Sitzung je Punkt (Minuten) */
  sess: Float64Array;
  send: Float64Array;
}

interface StartEv {
  b: string;
  /** Minuten */
  t0: number;
  login: string | null;
}

interface RaidEv {
  from: string;
  to: string;
  t: number;
  viewers: number;
}

interface MarkerEv {
  type: "title" | "shared_start" | "shared_end" | "server_event";
  t: number;
  players: string[];
  text: string;
}

interface Base {
  series: Map<string, Series>;
  /** Minuten, in denen der Tracker irgendeinen Zuschauerwert schrieb */
  cover: Set<number>;
  starts: StartEv[];
  /** Echte Startzeiten (Twitch) je Spieler, sortiert, Minuten */
  startsBy: Map<string, Float64Array>;
  raids: RaidEv[];
  markers: MarkerEv[];
  logins: Map<string, string>;
  from: number;
  to: number;
}

/* ------------------------------------------------------------------ Hilfen */

function lowerBound(t: Float64Array, x: number) {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function avg(s: Series, a: number, b: number): number | null {
  const i = lowerBound(s.t, a);
  const j = lowerBound(s.t, b + 1e-9);
  return j - i >= 2 ? (s.cum[j] - s.cum[i]) / (j - i) : null;
}

/** Index des Punkts, zu dem x gehört (Sitzung läuft), sonst −1 */
function pointAt(s: Series, x: number) {
  const k = lowerBound(s.t, x + 1e-9) - 1;
  return k >= 0 && x - s.t[k] <= SESSION_GAP_MIN ? k : -1;
}

const mean = (l: number[]) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : 0);
const stdErr = (l: number[]) => {
  if (l.length < 2) return Infinity;
  const m = mean(l);
  const sd = Math.sqrt(mean(l.map((x) => (x - m) ** 2)));
  return sd > 0 ? sd / Math.sqrt(l.length) : Infinity;
};
const tOf = (l: number[]) => {
  const e = stdErr(l);
  return Number.isFinite(e) ? mean(l) / e : 0;
};

const berlinHour = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" });
const berlinDay = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin" });
const hourCache = new Map<number, number>();
function hourBlock(min: number) {
  const h = Math.floor(min / 60);
  let v = hourCache.get(h);
  if (v === undefined) {
    v = Math.floor(Number(berlinHour.format(new Date(h * 3_600_000))) / 4);
    hourCache.set(h, v);
  }
  return v;
}
const ageBlock = (m: number) => (m < 60 ? 0 : m < 120 ? 1 : m < 240 ? 2 : 3);
/** Berliner Kalendertag „YYYY-MM-DD“ */
export const dayOf = (ms: number) => berlinDay.format(new Date(ms));

/** Mitternacht (Berlin) eines Tages und des Folgetags in ms */
export function dayBounds(day: string): [number, number] {
  const [y, m, d] = day.split("-").map(Number);
  // Berlin ist UTC+1 oder +2: Kandidaten prüfen, welcher Zeitpunkt dort 00:00 ist
  const at = (yy: number, mm: number, dd: number) => {
    for (const off of [1, 2]) {
      const ms = Date.UTC(yy, mm - 1, dd, -off);
      if (dayOf(ms) === `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` && dayOf(ms - 60_000) !== dayOf(ms)) return ms;
    }
    return Date.UTC(yy, mm - 1, dd, -1);
  };
  const start = at(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return [start, at(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())];
}

/* ------------------------------------------------------------------ Basisdaten */

async function loadBase(): Promise<Base> {
  const db = await getDb();
  const [rows, ev, players, official] = await Promise.all([
    // Je Spieler eine Zeile mit Zeit- und Zuschauerreihe: ~100 Zeilen statt ~800.000 Objekte
    db.query<{ player: string; ts: number[]; vs: number[] }>(
      `SELECT player, array_agg((extract(epoch FROM at) / 60)::int ORDER BY at) AS ts, array_agg(viewers ORDER BY at) AS vs
         FROM player_history WHERE viewers IS NOT NULL GROUP BY player`,
    ),
    db.query<{ type: string; player: string | null; m: number; value: number | null; meta: Record<string, unknown> | null }>(
      `SELECT type, player, (extract(epoch FROM at) / 60)::float8 AS m, value, meta FROM events
        WHERE type IN ('stream_start', 'raid', 'stream_title', 'shared_chat_start', 'shared_chat_end') ORDER BY at`,
    ),
    db.query<{ id: string; twitch_login: string | null }>(`SELECT id, twitch_login FROM players`),
    // Offizielle Termine (vom Tracker gespeichert): z. B. „Das End öffnet“ erklärt einen Zuschauer-Anstieg bei allen
    db.query<{ events: { title: string; date: string; time: string | null }[] }>(`SELECT events FROM official_events WHERE id = 1`).catch(() => ({ rows: [] })),
  ]);
  const series = new Map<string, Series>();
  const cover = new Set<number>();
  let from = Infinity;
  let to = -Infinity;
  for (const r of rows.rows) {
    const n = r.ts.length;
    const t = Float64Array.from(r.ts);
    const v = Float64Array.from(r.vs);
    const cum = new Float64Array(n + 1);
    const sess = new Float64Array(n);
    const send = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      cum[i + 1] = cum[i] + v[i];
      sess[i] = i > 0 && t[i] - t[i - 1] <= SESSION_GAP_MIN ? sess[i - 1] : t[i];
      cover.add(t[i]);
    }
    for (let i = n - 1; i >= 0; i--) send[i] = i < n - 1 && t[i + 1] - t[i] <= SESSION_GAP_MIN ? send[i + 1] : t[i];
    if (n) {
      from = Math.min(from, t[0]);
      to = Math.max(to, t[n - 1]);
    }
    series.set(r.player, { t, v, cum, sess, send });
  }
  const logins = new Map<string, string>();
  for (const p of players.rows) if (p.twitch_login) logins.set(p.id, p.twitch_login);
  const starts: StartEv[] = [];
  const raids: RaidEv[] = [];
  const markers: MarkerEv[] = [];
  for (const e of ev.rows) {
    const meta = e.meta ?? {};
    if (e.type === "stream_start" && e.player) {
      const started = typeof meta.startedAt === "string" ? Date.parse(meta.startedAt) / 60_000 : NaN;
      const login = typeof meta.login === "string" ? meta.login : null;
      starts.push({ b: e.player, t0: Number.isFinite(started) ? started : e.m, login });
      if (login && !logins.has(e.player)) logins.set(e.player, login);
    } else if (e.type === "raid" && e.player && typeof meta.raidTargetPlayerId === "string") {
      raids.push({ from: e.player, to: meta.raidTargetPlayerId, t: e.m, viewers: e.value ?? 0 });
    } else if (e.type === "stream_title" && e.player) {
      markers.push({ type: "title", t: e.m, players: [e.player], text: typeof meta.title === "string" ? meta.title : "" });
    } else if (e.type === "shared_chat_start" || e.type === "shared_chat_end") {
      const ids = typeof meta.sharedChatPlayers === "string" ? meta.sharedChatPlayers.split(",").filter(Boolean) : e.player ? [e.player] : [];
      markers.push({ type: e.type === "shared_chat_start" ? "shared_start" : "shared_end", t: e.m, players: ids, text: typeof meta.sharedChatNames === "string" ? meta.sharedChatNames : "" });
    }
  }
  for (const o of official.rows[0]?.events ?? []) {
    if (!o.time || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue;
    const [h, mi] = o.time.split(":").map(Number);
    const t = dayBounds(o.date)[0] / 60_000 + h * 60 + mi;
    // Gilt für alle Streams; `players` leer = jeder
    markers.push({ type: "server_event", t, players: [], text: o.title });
  }
  markers.sort((x, y) => x.t - y.t);
  const startsBy = new Map<string, Float64Array>();
  for (const [p, l] of group(starts, (x) => x.b)) startsBy.set(p, Float64Array.from(l.map((x) => x.t0)).sort());
  return { series, cover, starts, startsBy, raids, markers, logins, from, to };
}

/** Lief der Tracker in [a, b] durchgehend (höchstens 3 Minuten ohne irgendeinen Wert)? */
function covered(base: Base, a: number, b: number) {
  for (let x = Math.floor(a); x <= b; x += 3) {
    if (!base.cover.has(x) && !base.cover.has(x + 1) && !base.cover.has(x + 2)) return false;
  }
  return true;
}

function raidNear(base: Base, p: string, a: number, b: number) {
  return base.raids.some((r) => r.t >= a && r.t <= b && (r.from === p || r.to === p));
}

/** Relative Änderung von A im Fenster um t0; null, wenn A nicht das ganze Fenster live ist oder zu klein */
function change(s: Series, t0: number, w: Win): { age: number; before: number; rel: number } | null {
  const k = pointAt(s, t0);
  if (k < 0) return null;
  const age = t0 - s.sess[k];
  if (age < MIN_AGE_MIN || s.send[k] < t0 + w.a1) return null;
  const before = avg(s, t0 + w.b0, t0 + w.b1);
  const after = avg(s, t0 + w.a0, t0 + w.a1);
  if (before === null || after === null || before < MIN_VIEWERS) return null;
  return { age, before, rel: (after - before) / before };
}

/** Übliche Änderung je (Spieler, Streamalter, Tageszeit) über alle Zeiten; Ersatz (Spieler, Streamalter) */
function usualChanges(base: Base, w: Win) {
  const ctrl = new Map<string, number[]>();
  for (const [a, s] of base.series) {
    for (let i = 0; i < s.t.length; i += 5) {
      const t0 = s.t[i];
      if (raidNear(base, a, t0 - 10, t0 + w.a1)) continue;
      const c = change(s, t0, w);
      if (!c) continue;
      for (const k of [`${a}|${ageBlock(c.age)}|${hourBlock(t0)}`, `${a}|${ageBlock(c.age)}`]) {
        const l = ctrl.get(k);
        if (l) l.push(c.rel);
        else ctrl.set(k, [c.rel]);
      }
    }
  }
  return (a: string, age: number, t0: number) => {
    for (const k of [`${a}|${ageBlock(age)}|${hourBlock(t0)}`, `${a}|${ageBlock(age)}`]) {
      const l = ctrl.get(k);
      if (l && l.length >= 5) return mean(l);
    }
    return null;
  };
}

/* ------------------------------------------------------------------ Auswertung */

export interface WaitingRoom {
  id: string;
  n: number;
  baseViewers: number;
  /** Änderung nach fremdem Start minus übliche Änderung (Anteil) */
  effect: number;
  t: number;
  /** Ø zusätzliche Änderung in Zuschauern je fremdem Start (negativ = Verlust) */
  perStart: number;
}

export interface Magnet {
  id: string;
  starts: number;
  /** Ø Gesamtverlust aller anderen je Start (positiv = abgezogen) */
  pulled: number;
  t: number;
}

export interface Pair {
  a: string;
  b: string;
  n: number;
  /** Ø zusätzliche Änderung in Zuschauern (Start: Verlust von A; Ende: Zuwachs von B) */
  perEvent: number;
  t: number;
}

export interface RaidFlow {
  from: string;
  to: string;
  n: number;
  viewers: number;
}

/** Ein Raid mit Bindung: Anteil der Raid-Zuschauer, die nach m Minuten noch da sind */
export interface RaidStay {
  from: string;
  to: string;
  /** ms */
  at: number;
  /** Raid-Größe laut Twitch */
  viewers: number;
  /** Zuschauer von B vor dem Raid (Median 6–1 Min davor) */
  before: number;
  /** angekommen: höchster Stand in 8 Min nach dem Raid, als Anteil der Raid-Größe */
  arrived: number;
  r10: number | null;
  r30: number | null;
  r60: number | null;
}

export interface RaidRetention {
  /** Je Minute nach dem Raid: Median und mittlere Hälfte (25–75 %) des Anteils, der noch da ist */
  curve: { m: number; median: number; p25: number; p75: number; n: number }[];
  /** Median „angekommen“ */
  arrived: number;
  raids: RaidStay[];
  /** Je Raid-Ziel (mind. 3 Raids): Median nach 30 Min */
  byTarget: { to: string; n: number; r30: number; arrived: number }[];
  skipped: number;
}

export interface ExampleLine {
  a: string;
  before: number;
  points: [number, number][];
  loss: number;
}

export interface Example {
  b: string;
  at: number;
  pulled: number;
  lines: ExampleLine[];
}

export interface Migration {
  from: number | null;
  to: number | null;
  starts: number;
  ends: number;
  endsWithRaid: number;
  observations: number;
  skippedRaid: number;
  overall: { effect: number; se: number };
  waitingRooms: WaitingRoom[];
  magnets: Magnet[];
  pairs: Pair[];
  heirs: Pair[];
  raidFlows: RaidFlow[];
  raidRetention: RaidRetention;
  examples: Example[];
  /** Beobachtungen je Spieler für die Spieleransicht (Start: A verliert; Ende: C gewinnt) */
  startObs: Map<string, { b: string; t0: number; exAbs: number; before: number }[]>;
  endObs: Map<string, { a: string; t: number; gain: number; before: number }[]>;
}

function group<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) {
    const k = key(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

async function computeMigration(): Promise<Migration> {
  const base = await getBase();
  const usualStart = usualChanges(base, START_WIN);
  const usualEnd = usualChanges(base, END_WIN);

  // Starts (nur wo der Tracker das ganze Fenster lief)
  const starts = base.starts.filter((s) => covered(base, s.t0 + START_WIN.b0, s.t0 + START_WIN.a1));
  type SObs = { a: string; b: string; t0: number; before: number; ex: number; exAbs: number; idx: number };
  const obs: SObs[] = [];
  let skippedRaid = 0;
  starts.forEach((s, idx) => {
    for (const [a, sa] of base.series) {
      if (a === s.b) continue;
      const c = change(sa, s.t0, START_WIN);
      if (!c) continue;
      if (raidNear(base, a, s.t0 - 10, s.t0 + START_WIN.a1)) {
        skippedRaid++;
        continue;
      }
      const u = usualStart(a, c.age, s.t0);
      if (u === null) continue;
      const ex = c.rel - u;
      obs.push({ a, b: s.b, t0: s.t0, before: c.before, ex, exAbs: ex * c.before, idx });
    }
  });

  const waitingRooms: WaitingRoom[] = [...group(obs, (o) => o.a)]
    .filter(([, l]) => l.length >= 15)
    .map(([id, l]) => {
      const e = l.map((o) => o.ex);
      return { id, n: l.length, baseViewers: mean(l.map((o) => o.before)), effect: mean(e), t: tOf(e), perStart: mean(l.map((o) => o.exAbs)) };
    })
    .sort((x, y) => x.effect - y.effect);

  const perStart = new Map<number, number>();
  for (const o of obs) perStart.set(o.idx, (perStart.get(o.idx) ?? 0) - o.exAbs);
  const magnets: Magnet[] = [...group([...perStart], ([idx]) => starts[idx].b)]
    .filter(([, l]) => l.length >= 3)
    .map(([id, l]) => {
      const v = l.map(([, x]) => x);
      return { id, starts: l.length, pulled: mean(v), t: tOf(v) };
    })
    .sort((x, y) => y.pulled - x.pulled);

  const pairs: Pair[] = [...group(obs, (o) => `${o.a}|${o.b}`)].map(([k, l]) => {
    const [a, b] = k.split("|");
    const v = l.map((o) => o.exAbs);
    return { a, b, n: l.length, perEvent: mean(v), t: tOf(v) };
  });

  // Enden aus dem Verlauf; Raid des endenden Streams kurz davor/danach = Raid-Ende
  type End = { a: string; t: number; before: number; raid: boolean };
  const ends: End[] = [];
  for (const [a, s] of base.series) {
    for (let i = 0; i < s.t.length; i++) {
      if (s.send[i] !== s.t[i] || s.t[i] - s.sess[i] < MIN_AGE_MIN) continue;
      const t = s.t[i];
      if (!covered(base, t - 15, t + END_WIN.a1)) continue;
      const before = avg(s, t - 15, t - 5);
      if (before === null || before < MIN_VIEWERS) continue;
      ends.push({ a, t, before, raid: base.raids.some((r) => r.from === a && r.t >= t - 10 && r.t <= t + 10) });
    }
  }
  type EObs = { a: string; c: string; t: number; before: number; gain: number };
  const eobs: EObs[] = [];
  for (const e of ends) {
    for (const [c, sc] of base.series) {
      if (c === e.a) continue;
      const ch = change(sc, e.t, END_WIN);
      if (!ch) continue;
      // Raid-Ziel und andere Raids im Fenster: ausdrücklicher Wechsel, kein Abwandern
      if (raidNear(base, c, e.t - 10, e.t + END_WIN.a1)) continue;
      const u = usualEnd(c, ch.age, e.t);
      if (u === null) continue;
      eobs.push({ a: e.a, c, t: e.t, before: ch.before, gain: (ch.rel - u) * ch.before });
    }
  }
  const heirs: Pair[] = [...group(eobs, (o) => `${o.a}|${o.c}`)].map(([k, l]) => {
    const [a, b] = k.split("|");
    const v = l.map((o) => o.gain);
    return { a, b, n: l.length, perEvent: mean(v), t: tOf(v) };
  });

  const raidFlows: RaidFlow[] = [...group(base.raids, (r) => `${r.from}|${r.to}`)]
    .map(([k, l]) => {
      const [from, to] = k.split("|");
      return { from, to, n: l.length, viewers: l.reduce((s, r) => s + r.viewers, 0) };
    })
    .sort((x, y) => y.viewers - x.viewers);

  const raidRetention = computeRaidRetention(base);

  // Beispiele: die Starts mit dem größten Gesamtverlust der anderen, die drei größten Verlierer
  const byIdx = group(obs, (o) => o.idx);
  const examples: Example[] = [...perStart]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 6)
    .map(([idx, pulled]) => {
      const s = starts[idx];
      const losers = [...(byIdx.get(idx) ?? [])].sort((x, y) => x.exAbs - y.exAbs).slice(0, 3);
      return {
        b: s.b,
        at: s.t0 * 60_000,
        pulled,
        lines: losers.map((o) => {
          const sa = base.series.get(o.a)!;
          const points: [number, number][] = [];
          for (let k = lowerBound(sa.t, s.t0 - 30); k < sa.t.length && sa.t[k] <= s.t0 + 60; k++) {
            points.push([Math.round((sa.t[k] - s.t0) * 10) / 10, Math.round((1000 * sa.v[k]) / o.before) / 10]);
          }
          return { a: o.a, before: o.before, points, loss: o.exAbs };
        }),
      };
    });

  const startObs = new Map<string, { b: string; t0: number; exAbs: number; before: number }[]>();
  for (const o of obs) {
    const l = startObs.get(o.a) ?? [];
    l.push({ b: o.b, t0: o.t0, exAbs: o.exAbs, before: o.before });
    startObs.set(o.a, l);
  }
  const endObs = new Map<string, { a: string; t: number; gain: number; before: number }[]>();
  for (const o of eobs) {
    const l = endObs.get(o.c) ?? [];
    l.push({ a: o.a, t: o.t, gain: o.gain, before: o.before });
    endObs.set(o.c, l);
  }

  const all = obs.map((o) => o.ex);
  return {
    from: Number.isFinite(base.from) ? base.from * 60_000 : null,
    to: Number.isFinite(base.to) ? base.to * 60_000 : null,
    starts: starts.length,
    ends: ends.length,
    endsWithRaid: ends.filter((e) => e.raid).length,
    observations: obs.length,
    skippedRaid,
    overall: { effect: mean(all), se: stdErr(all) },
    waitingRooms,
    magnets,
    pairs,
    heirs,
    raidFlows,
    raidRetention,
    examples,
    startObs,
    endObs,
  };
}

/* ------------------------------------------------------------------ Raid-Bindung */

/** Raids zählen ab so vielen Zuschauern (kleinere gehen im Rauschen unter) */
const RAID_MIN_VIEWERS = 50;
const RAID_HORIZON = 60;

/**
 * Wie viele Raid-Zuschauer bleiben? Je Raid A → B: Stand von B vorher (Median 6–1 Min davor), dann je Minute der
 * Median ±2 Min abzüglich B's eigenem Trend der 15 Min davor, als Anteil der Raid-Größe laut Twitch. Twitch-Zahlen
 * kommen in Stufen von ~3 Min und zeigen den Raid 1–3 Min nach der Meldung, daher „angekommen“ als Höchststand in
 * 8 Min. Nur Raids, bei denen B von 20 Min davor bis 60 Min danach durchgehend live ist und keinen weiteren Raid
 * in dieser Stunde bekommt.
 */
function computeRaidRetention(base: Base): RaidRetention {
  const liveThrough = (s: Series, a: number, b: number) => {
    const i = lowerBound(s.t, a);
    const j = lowerBound(s.t, b + 1e-9) - 1;
    if (i >= s.t.length || j < i || s.t[i] > a + 5 || s.t[j] < b - 5) return false;
    for (let k = i + 1; k <= j; k++) if (s.t[k] - s.t[k - 1] > 10) return false;
    return true;
  };
  const maxIn = (s: Series, a: number, b: number) => {
    let m: number | null = null;
    for (let i = lowerBound(s.t, a); i < s.t.length && s.t[i] <= b; i++) m = Math.max(m ?? 0, s.v[i]);
    return m;
  };
  const raids: RaidStay[] = [];
  const perMinute: number[][] = Array.from({ length: RAID_HORIZON + 1 }, () => []);
  let skipped = 0;
  for (const r of base.raids) {
    const s = base.series.get(r.to);
    if (!s || r.viewers < RAID_MIN_VIEWERS) continue;
    const t = r.t;
    if (!liveThrough(s, t - 20, t + RAID_HORIZON) || base.raids.some((o) => o !== r && o.to === r.to && Math.abs(o.t - t) < RAID_HORIZON)) {
      skipped++;
      continue;
    }
    const before = medianIn(s, t - 6, t - 1);
    const pre = medianIn(s, t - 21, t - 16);
    const peak = maxIn(s, t, t + 8);
    if (before === null || peak === null) {
      skipped++;
      continue;
    }
    const trend = pre !== null ? (before - pre) / 15 : 0;
    const stay = (m: number) => {
      const v = medianIn(s, t + m - 2, t + m + 2);
      return v === null ? null : (v - before - trend * m) / r.viewers;
    };
    for (let m = 0; m <= RAID_HORIZON; m++) {
      const x = stay(m);
      if (x !== null) perMinute[m].push(x);
    }
    raids.push({ from: r.from, to: r.to, at: t * 60_000, viewers: r.viewers, before, arrived: (peak - before) / r.viewers, r10: stay(10), r30: stay(30), r60: stay(60) });
  }
  const q = (l: number[], p: number) => {
    const v = [...l].sort((x, y) => x - y);
    return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0;
  };
  const curve = perMinute.map((l, m) => ({ m, median: l.length ? median(l) : 0, p25: q(l, 0.25), p75: q(l, 0.75), n: l.length }));
  const byTarget = [...group(raids, (r) => r.to)]
    .filter(([, l]) => l.length >= 3)
    .map(([to, l]) => ({ to, n: l.length, r30: median(l.map((r) => r.r30 ?? 0)), arrived: median(l.map((r) => r.arrived)) }))
    .sort((x, y) => y.r30 - x.r30);
  return { curve, arrived: raids.length ? median(raids.map((r) => r.arrived)) : 0, raids: raids.sort((x, y) => y.at - x.at), byTarget, skipped };
}

/* ------------------------------------------------------------------ Tagesverlauf */

export interface DayStack {
  day: string;
  /** Beginn der 5-Minuten-Abschnitte (ms) */
  times: number[];
  /** Hatte der Tracker in diesem Abschnitt Daten? Sonst ist er eine Lücke, nicht „0 Zuschauer“ */
  covered: boolean[];
  /** feste Reihenfolge: die größten Streams der Staffel, zuletzt „Andere“ (id = "") */
  series: { id: string; values: number[] }[];
  /** Zuschauerstunden und Spitze je Streamer an diesem Tag, absteigend */
  table: { id: string; hours: number; peak: number }[];
}

const BIN_MIN = 5;
/** So viele Streams bekommen eine eigene Farbe (Rest = „Andere“); die Palette prüft 8 Plätze, einer bleibt grau */
const STACK_SLOTS = 7;

/** Die Streams mit den meisten Zuschauerminuten der Staffel – feste Farbe je Streamer, egal welcher Tag */
function seasonTop(base: Base): string[] {
  return [...base.series]
    .map(([id, s]) => ({ id, total: s.cum[s.cum.length - 1] }))
    .sort((x, y) => y.total - x.total)
    .slice(0, STACK_SLOTS)
    .map((x) => x.id);
}

export async function getDayStack(day: string): Promise<DayStack> {
  const base = await getBase();
  const [a, b] = dayBounds(day);
  const t0 = a / 60_000;
  const t1 = b / 60_000;
  const bins = Math.round((t1 - t0) / BIN_MIN);
  const times = Array.from({ length: bins }, (_, i) => (t0 + i * BIN_MIN) * 60_000);
  const coveredBins = Array.from({ length: bins }, (_, i) => {
    for (let x = t0 + i * BIN_MIN; x < t0 + (i + 1) * BIN_MIN; x++) if (base.cover.has(x)) return true;
    return false;
  });
  const top = seasonTop(base);
  const others = new Array<number>(bins).fill(0);
  const series: DayStack["series"] = top.map((id) => ({ id, values: new Array<number>(bins).fill(0) }));
  const table: DayStack["table"] = [];
  for (const [id, s] of base.series) {
    const vals = new Array<number>(bins).fill(0);
    let minutes = 0;
    let peak = 0;
    for (let i = 0; i < bins; i++) {
      const m = avg(s, t0 + i * BIN_MIN, t0 + (i + 1) * BIN_MIN - 1e-6);
      // Ein einzelner Punkt im Abschnitt reicht hier (Durchschnitt braucht sonst zwei)
      const k = lowerBound(s.t, t0 + i * BIN_MIN);
      const single = k < s.t.length && s.t[k] < t0 + (i + 1) * BIN_MIN ? s.v[k] : 0;
      vals[i] = Math.round(m ?? single);
      minutes += vals[i] * BIN_MIN;
      peak = Math.max(peak, vals[i]);
    }
    if (minutes === 0) continue;
    table.push({ id, hours: minutes / 60, peak });
    const slot = top.indexOf(id);
    if (slot >= 0) series[slot].values = vals;
    else for (let i = 0; i < bins; i++) others[i] += vals[i];
  }
  table.sort((x, y) => y.hours - x.hours);
  return { day, times, covered: coveredBins, series: [...series, { id: "", values: others }], table };
}

/* ------------------------------------------------------------------ Tage überlagern */

/** Pseudo-Spieler: alle Streams zusammen */
export const ALL_STREAMS = "__alle";
/** Höchstens so viele Tage auf einmal */
const OVERLAY_MAX_DAYS = 31;

export interface Overlay {
  id: string;
  days: string[];
  /** Minute des Tages (Berlin) je 5-Minuten-Abschnitt */
  minutes: number[];
  /**
   * je Tag je Abschnitt: Zuschauer (Ø im Abschnitt), 0 = Tracker lief, Stream war aus, null = Tracker lief nicht.
   * Ohne diese Trennung würden Summe und Durchschnitt Ausfälle als „0 Zuschauer“ zählen.
   */
  values: (number | null)[][];
}

/** Zuschauer eines Streams in [a, b): Ø, bei nur einem Punkt dieser, ohne Punkt 0 */
function binValue(s: Series, a: number, b: number) {
  const m = avg(s, a, b - 1e-6);
  if (m !== null) return m;
  const k = lowerBound(s.t, a);
  return k < s.t.length && s.t[k] < b ? s.v[k] : 0;
}

export async function getOverlay(id: string, fromDay: string, toDay: string): Promise<Overlay> {
  const base = await getBase();
  const [lo, hi] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
  const all = new Set<string>();
  for (const m of base.cover) all.add(dayOf(m * 60_000));
  const days = [...all].filter((d) => d >= lo && d <= hi).sort().slice(-OVERLAY_MAX_DAYS);
  const bins = (24 * 60) / BIN_MIN;
  const minutes = Array.from({ length: bins }, (_, i) => i * BIN_MIN);
  const series = id === ALL_STREAMS ? [...base.series.values()] : [base.series.get(id)].filter((x): x is Series => Boolean(x));
  const values = days.map((d) => {
    const t0 = dayBounds(d)[0] / 60_000;
    return minutes.map((m) => {
      const a = t0 + m;
      const b = a + BIN_MIN;
      let covered = false;
      for (let x = a; x < b && !covered; x++) covered = base.cover.has(x);
      if (!covered) return null;
      return Math.round(series.reduce((sum, sr) => sum + binValue(sr, a, b), 0));
    });
  });
  return { id, days, minutes, values };
}

/** Streamer mit Zuschauerdaten, nach Zuschauerminuten der Staffel absteigend */
export async function getStreamers(): Promise<string[]> {
  const base = await getBase();
  return [...base.series].sort((x, y) => y[1].cum[y[1].cum.length - 1] - x[1].cum[x[1].cum.length - 1]).map(([id]) => id);
}

/** Tage mit Zuschauerdaten, neueste zuerst */
export async function getDays(): Promise<string[]> {
  const base = await getBase();
  const days = new Set<string>();
  for (const m of base.cover) days.add(dayOf(m * 60_000));
  return [...days].sort().reverse();
}

/* ------------------------------------------------------------------ Spieleransicht */

export interface ChartMarker {
  /** ms */
  at: number;
  kind: "own_start" | "own_end" | "title" | "raid_in" | "raid_out" | "shared_start" | "shared_end" | "server_event" | "other_start" | "other_end";
  /** beteiligter anderer Spieler */
  other?: string;
  /** Zuschauer: Raid-Größe bzw. zusätzliche Änderung durch fremden Start/Ende */
  viewers?: number;
  text?: string;
}

export interface Anomaly {
  /** ms */
  from: number;
  to: number;
  /** tatsächliche Änderung in Zuschauern über den Abschnitt */
  change: number;
  /** erwartete Änderung in Zuschauern (übliches Muster dieses Streams + was alle anderen gleichzeitig tun) */
  expected: number;
  /** gleichzeitige Änderung aller anderen Streams (Anteil, Median) */
  market: number;
  kind: "dip" | "hype";
}

export interface VodSpan {
  /** ms: Sitzung, für die das VOD gilt */
  from: number;
  to: number;
  vodId: string;
  /** ms: Zeitpunkt, der im VOD bei 0:00 liegt */
  vodStart: number;
}

export interface PlayerDay {
  id: string;
  day: string;
  /** [ms, Zuschauer] */
  points: [number, number][];
  markers: ChartMarker[];
  anomalies: Anomaly[];
  vods: VodSpan[];
  /** Tage, an denen der Spieler live war, neueste zuerst */
  days: string[];
}

/**
 * Ein fremder Start/Ende gilt als Ursache, wenn die zusätzliche Änderung mindestens CAUSE_SD Standardabweichungen
 * der üblichen Schwankung dieses Streams beträgt (bei 5.000 Zuschauern schwankt es sonst um mehrere Hundert) und
 * mindestens CAUSE_MIN_ABS Zuschauer.
 */
const CAUSE_SD = 2;
const CAUSE_MIN_ABS = 30;
/** Ungeklärte Änderung: mindestens so viele Zuschauer bzw. dieser Anteil */
const ANOMALY_MIN_SHARE = 0.05;
/** Ungeklärt: 10-Minuten-Änderung mindestens so viele Standardabweichungen vom Üblichen dieses Streams */
const ANOMALY_Z = 3;
const ANOMALY_WIN = 10;

/** Verlauf eines Spielers an einem Tag; ohne (gültigen) Tag der letzte Tag, an dem er live war */
function medianIn(s: Series, a: number, b: number): number | null {
  const vals: number[] = [];
  for (let j = lowerBound(s.t, a); j < s.t.length && s.t[j] <= b; j++) vals.push(s.v[j]);
  if (vals.length < 2) return null;
  vals.sort((x, y) => x - y);
  const h = vals.length >> 1;
  return vals.length % 2 ? vals[h] : (vals[h - 1] + vals[h]) / 2;
}

/**
 * Anhaltende Änderung um t: Median der 5 Min davor gegen 5–10 Min danach, innerhalb einer Sitzung. Twitch-Zahlen
 * kommen in Stufen von ~3 Min und haben Nadeln von 1–2 Min; der Median übergeht beides.
 */
function medianStep(s: Series, t: number, starts: Float64Array | undefined): { before: number; after: number; age: number; end: number } | null {
  const k = pointAt(s, t);
  const k2 = pointAt(s, t + ANOMALY_WIN);
  if (k < 0 || k2 < 0 || s.sess[k2] !== s.sess[k]) return null;
  const before = medianIn(s, t - 5, t);
  const after = medianIn(s, t + 5, t + ANOMALY_WIN);
  if (before === null || after === null || before < MIN_VIEWERS) return null;
  return { before, after, age: streamAge(s, k, t, starts), end: s.t[k2] };
}

/**
 * Minuten seit dem echten Streamstart (Twitch). Lücken im Verlauf kommen meist von Tracker-Ausfällen, nicht von
 * Streamstarts; ohne Start in dieser Sitzung (Tracker kam mitten im Stream zurück) gilt der Stream als lange live.
 */
function streamAge(s: Series, k: number, t: number, starts: Float64Array | undefined): number {
  if (starts) {
    const j = lowerBound(starts, t + 1e-9) - 1;
    if (j >= 0 && starts[j] >= s.sess[k] - 60) return t - starts[j];
  }
  return Number.POSITIVE_INFINITY;
}

/** Feinere Streamalter-Stufen, damit die Aufwärmphase ihr eigenes übliches Muster hat; −1 = zu früh zum Bewerten */
const fineAge = (m: number) => (m < 10 ? -1 : m < 20 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : m < 240 ? 4 : 5);

const median = (l: number[]) => {
  const v = [...l].sort((x, y) => x - y);
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
};

/**
 * Übliche Änderung aller Streams je (Streamalter, Tageszeit) bzw. Streamalter – Ersatz für Streamer mit wenigen
 * eigenen Daten (die Aufwärmphase nach dem Start sieht bei allen ähnlich aus). Einmal je Basisdaten berechnet.
 */
const globalUsualCache = new WeakMap<Base, Map<string, number>>();
function globalUsual(base: Base): Map<string, number> {
  const hit = globalUsualCache.get(base);
  if (hit) return hit;
  const lists = new Map<string, number[]>();
  for (const [p, sp] of base.series) {
    for (let i = 0; i < sp.t.length; i += 4) {
      const st = medianStep(sp, sp.t[i], base.startsBy.get(p));
      if (!st || fineAge(st.age) < 0) continue;
      const rel = (st.after - st.before) / st.before;
      for (const k of [`${fineAge(st.age)}|${hourBlock(sp.t[i])}`, `${fineAge(st.age)}`]) {
        const l = lists.get(k);
        if (l) l.push(rel);
        else lists.set(k, [rel]);
      }
    }
  }
  const out = new Map<string, number>();
  for (const [k, l] of lists) if (l.length >= 30) out.set(k, median(l));
  globalUsualCache.set(base, out);
  return out;
}

/** Was alle anderen Streams gleichzeitig tun: Median ihrer Änderung um t (ohne Raid-Beteiligte und Aufwärmphase) */
function marketAt(base: Base, t: number, exclude: string): number | null {
  const rels: number[] = [];
  for (const [p, sp] of base.series) {
    if (p === exclude) continue;
    const st = medianStep(sp, t, base.startsBy.get(p));
    if (!st || st.age < MIN_AGE_MIN || raidNear(base, p, t - 10, t + 15)) continue;
    rels.push((st.after - st.before) / st.before);
  }
  return rels.length >= 3 ? median(rels) : null;
}

export async function getPlayerDay(id: string, wanted?: string): Promise<PlayerDay | null> {
  const [base, mig] = await Promise.all([getBase(), getViewerMigration()]);
  const s = base.series.get(id);
  if (!s || s.t.length === 0) return null;
  const daySet = new Set<string>();
  for (let i = 0; i < s.t.length; i += 10) daySet.add(dayOf(s.t[i] * 60_000));
  daySet.add(dayOf(s.t[s.t.length - 1] * 60_000));
  const days = [...daySet].sort().reverse();
  const day = wanted && daySet.has(wanted) ? wanted : days[0];
  const [a, b] = dayBounds(day);
  const t0 = a / 60_000;
  const t1 = b / 60_000;
  const points: [number, number][] = [];
  for (let i = lowerBound(s.t, t0); i < s.t.length && s.t[i] < t1; i++) points.push([s.t[i] * 60_000, s.v[i]]);

  // Ereignisse auch 30 Min vor/nach dem Tag sammeln: Sie erklären Änderungen kurz vor Mitternacht; angezeigt
  // werden am Ende nur die des Tages
  const markers: ChartMarker[] = [];
  const inDay = (x: number) => x >= t0 - 30 && x < t1 + 30;
  for (const st of base.starts) if (st.b === id && inDay(st.t0)) markers.push({ at: st.t0 * 60_000, kind: "own_start" });
  for (let i = lowerBound(s.t, t0); i < s.t.length && s.t[i] < t1; i++) {
    if (s.send[i] === s.t[i] && covered(base, s.t[i], s.t[i] + 15)) markers.push({ at: s.t[i] * 60_000, kind: "own_end" });
  }
  for (const r of base.raids) {
    if (!inDay(r.t)) continue;
    if (r.to === id) markers.push({ at: r.t * 60_000, kind: "raid_in", other: r.from, viewers: r.viewers });
    if (r.from === id) markers.push({ at: r.t * 60_000, kind: "raid_out", other: r.to, viewers: r.viewers });
  }
  for (const m of base.markers) {
    if (!inDay(m.t) || (m.players.length > 0 && !m.players.includes(id))) continue;
    // Server-Event nur, wenn der Spieler um diese Zeit live war
    if (m.type === "server_event" && pointAt(s, m.t) < 0 && pointAt(s, m.t + 30) < 0) continue;
    markers.push({ at: m.t * 60_000, kind: m.type, text: m.text });
  }
  const sdOf = (l: number[]) => {
    const mu = mean(l);
    return Math.sqrt(mean(l.map((x) => (x - mu) ** 2)));
  };
  const so = mig.startObs.get(id) ?? [];
  const sdStart = sdOf(so.map((o) => o.exAbs));
  for (const o of so) {
    if (inDay(o.t0) && o.exAbs <= -Math.max(CAUSE_MIN_ABS, CAUSE_SD * sdStart)) markers.push({ at: o.t0 * 60_000, kind: "other_start", other: o.b, viewers: Math.round(o.exAbs) });
  }
  const eo = mig.endObs.get(id) ?? [];
  const sdEnd = sdOf(eo.map((o) => o.gain));
  for (const o of eo) {
    if (inDay(o.t) && o.gain >= Math.max(CAUSE_MIN_ABS, CAUSE_SD * sdEnd)) markers.push({ at: o.t * 60_000, kind: "other_end", other: o.a, viewers: Math.round(o.gain) });
  }
  markers.sort((x, y) => x.at - y.at);
  // Gleiche Ereignisse zur gleichen Zeit nur einmal (doppelte Messpunkte mit gleichem Zeitstempel)
  const seen = new Set<string>();
  for (let i = markers.length - 1; i >= 0; i--) {
    const k = `${markers[i].kind}|${markers[i].at}|${markers[i].other ?? ""}`;
    if (seen.has(k)) markers.splice(i, 1);
    else seen.add(k);
  }

  // Ungeklärte Einbrüche/Hypes. Erwartet wird, was dieser Stream sonst bei diesem Streamalter (inkl. Aufwärmphase)
  // und dieser Tageszeit tut, plus was gleichzeitig mit allen anderen Streams passiert (Abendandrang, Server-Event).
  // Ungeklärt ist nur, was deutlich darüber hinausgeht und kein Ereignis in der Nähe hat.
  const myStarts = base.startsBy.get(id);
  const usualMap = new Map<string, number[]>();
  for (let i = 0; i < s.t.length; i += 2) {
    const st = medianStep(s, s.t[i], myStarts);
    if (!st || fineAge(st.age) < 0) continue;
    const rel = (st.after - st.before) / st.before;
    for (const k of [`${fineAge(st.age)}|${hourBlock(s.t[i])}`, `${fineAge(st.age)}`]) {
      const l = usualMap.get(k);
      if (l) l.push(rel);
      else usualMap.set(k, [rel]);
    }
  }
  // Eigenes Muster, wenn genug eigene Daten; sonst das aller Streams (gleiches Streamalter, gleiche Tageszeit)
  const everyone = globalUsual(base);
  const usualAt = (age: number, t: number) => {
    for (const k of [`${fineAge(age)}|${hourBlock(t)}`, `${fineAge(age)}`]) {
      const l = usualMap.get(k);
      if (l && l.length >= 20) return median(l);
      const g = everyone.get(k);
      if (g !== undefined) return g;
    }
    return 0;
  };
  // Streuung der Abweichung vom Erwarteten über die ganze Staffel dieses Streams
  const resids: number[] = [];
  for (let i = 0; i < s.t.length; i += 6) {
    const st = medianStep(s, s.t[i], myStarts);
    if (!st || fineAge(st.age) < 0) continue;
    resids.push((st.after - st.before) / st.before - usualAt(st.age, s.t[i]) - (marketAt(base, s.t[i], id) ?? 0));
  }
  const mu = resids.length ? median(resids) : 0;
  const sd = resids.length ? Math.sqrt(mean(resids.map((x) => (x - mu) ** 2))) || 1 : 1;
  const near = (x: number) => markers.some((m) => m.at >= (x - 10) * 60_000 && m.at <= (x + ANOMALY_WIN + 5) * 60_000);
  const anomalies: Anomaly[] = [];
  for (let i = lowerBound(s.t, t0); i < s.t.length && s.t[i] < t1; i++) {
    const t = s.t[i];
    const st = medianStep(s, t, myStarts);
    if (!st || fineAge(st.age) < 0) continue;
    const rel = (st.after - st.before) / st.before;
    const market = marketAt(base, t, id) ?? 0;
    const expectedRel = usualAt(st.age, t) + market;
    const resid = rel - expectedRel;
    const residAbs = resid * st.before;
    if (Math.abs(resid - mu) < ANOMALY_Z * sd || Math.abs(residAbs) < Math.max(CAUSE_MIN_ABS, ANOMALY_MIN_SHARE * st.before)) continue;
    if (!covered(base, t, st.end) || near(t)) continue;
    const kind = resid > mu ? "hype" : "dip";
    // Anstieg in der ersten Stunde nach dem Start ist das Hereinströmen – wie steil, hängt vor allem an der Größe
    // des Streamers, nicht an etwas Besonderem im Stream
    if (kind === "hype" && st.age < 60) continue;
    const change = st.after - st.before;
    const expected = expectedRel * st.before;
    const last = anomalies[anomalies.length - 1];
    if (last && last.kind === kind && t * 60_000 <= last.to) {
      last.to = Math.max(last.to, st.end * 60_000);
      if (kind === "dip" ? change < last.change : change > last.change) {
        last.change = Math.round(change);
        last.expected = Math.round(expected);
        last.market = market;
      }
    } else anomalies.push({ from: t * 60_000, to: st.end * 60_000, change: Math.round(change), expected: Math.round(expected), market, kind });
  }

  // Alle VODs des Tages mit echtem Beginn und Ende (Twitch-API): Ein Klick nimmt das VOD, das seinen Zeitpunkt abdeckt
  const login = base.logins.get(id);
  const vods: VodSpan[] = login
    ? (await vodsBetween(login, a, b).catch(() => [])).map((v) => ({ from: v.start, to: v.end, vodId: v.id, vodStart: v.start }))
    : [];
  const shown = markers.filter((m) => m.at >= a && m.at < b);
  return { id, day, points, markers: shown, anomalies, vods, days };
}

/* ------------------------------------------------------------------ Zwischenspeicher */

const swr = createSwrCache();
const getBase = () => swr("viewer-base", BASE_CACHE_MS, loadBase);

/** Ergebnis der Analyse, eine Stunde zwischengespeichert */
export function getViewerMigration(): Promise<Migration> {
  return swr("viewer-migration", ANALYSIS_CACHE_MS, computeMigration);
}
