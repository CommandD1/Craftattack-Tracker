import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";

/**
 * Zuschauerwanderung: Verlieren laufende CraftAttack-Streams Zuschauer, wenn ein anderer CraftAttack-Streamer live
 * geht („Wartezimmer“)? Für jeden Start von B mit nennenswertem Publikum wird die Zuschauerzahl jedes anderen
 * laufenden Streams A vor dem Start (Ø der 5 Min davor) mit 10–20 Min danach verglichen. Weil Streams von selbst
 * wachsen und schrumpfen (Aufwärmphase, Tageszeit), zählt nur die Abweichung von A's üblicher Änderung über die
 * gleiche Fensterlänge – bei gleichem Streamalter und gleicher Tageszeit, zu Zeiten ohne fremden Start.
 *
 * Grenzen: Ein Start betrifft viele A gleichzeitig, und nahe beieinander liegende Starts überlagern sich. Der t-Wert
 * ist deshalb nur ein grober Hinweis, keine strenge Signifikanz. Zuschauerzahlen von Twitch sind gerundet und
 * verzögert; Raids (A beendet den Stream) fallen heraus, weil A danach keine Zuschauer mehr hat.
 */

/** Ein Start zählt, wenn B 10–30 Min danach mindestens so viele Zuschauer hat */
const MIN_B_PEAK = 300;
/** A zählt nur mit mindestens so vielen Zuschauern vor dem Start (kleine Zahlen schwanken zu stark) */
const MIN_A_VIEWERS = 100;
/** A muss seit mindestens so vielen Minuten live sein (die eigene Aufwärmphase verzerrt sonst alles) */
const MIN_A_AGE_MIN = 30;
/** Lücke zwischen zwei Messpunkten, ab der eine neue Stream-Sitzung beginnt */
const SESSION_GAP_MIN = 15;
/** Vergleichsfenster zählen nicht, wenn ein großer Start näher als das liegt */
const NEAR_START_MIN = 30;
const CACHE_MS = 60 * 60_000;

export interface WaitingRoom {
  id: string;
  /** Anzahl fremder Starts, während A lief */
  n: number;
  /** Ø Zuschauer von A vor den Starts */
  baseViewers: number;
  /** Änderung nach fremdem Start minus übliche Änderung (Anteil, −0,1 = 10 % weniger als sonst) */
  effect: number;
  /** grober t-Wert (Effekt / Standardfehler) */
  t: number;
  /** Ø zusätzlicher Verlust in Zuschauern je fremdem Start (negativ = Verlust) */
  perStart: number;
}

export interface Magnet {
  id: string;
  starts: number;
  /** Summe der zusätzlichen Verluste aller anderen Streams je Start (positiv = abgezogen) */
  pulled: number;
  /** Ø Spitze von B 10–30 Min nach dem Start */
  peak: number;
}

export interface Pair {
  a: string;
  b: string;
  n: number;
  /** Ø zusätzlicher Verlust von A je Start von B (negativ = Verlust) */
  perStart: number;
}

export interface ExampleLine {
  a: string;
  /** Ø Zuschauer von A in den 5 Min vor dem Start */
  before: number;
  /** [Minuten relativ zum Start, Zuschauer in % von `before`] */
  points: [number, number][];
  /** zusätzlicher Verlust in Zuschauern (negativ) */
  loss: number;
}

export interface Example {
  b: string;
  /** Start (ms) */
  at: number;
  peak: number;
  /** Summe der zusätzlichen Verluste aller anderen (positiv) */
  pulled: number;
  lines: ExampleLine[];
}

export interface Migration {
  from: number | null;
  to: number | null;
  streamers: number;
  bigStarts: number;
  observations: number;
  overall: { effect: number; se: number };
  waitingRooms: WaitingRoom[];
  magnets: Magnet[];
  pairs: Pair[];
  examples: Example[];
}

interface Series {
  /** Zeit in Minuten seit 1970 */
  t: Float64Array;
  v: Float64Array;
  /** Präfixsummen der Zuschauer, cum[i] = Summe v[0..i-1] */
  cum: Float64Array;
  /** Beginn der Sitzung je Punkt (Minuten) */
  sess: Float64Array;
}

/** erster Index mit t[i] >= x */
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

/** Ø Zuschauer in [a, b] (mindestens 2 Punkte) */
function avg(s: Series, a: number, b: number): number | null {
  const i = lowerBound(s.t, a);
  const j = lowerBound(s.t, b + 1e-9);
  return j - i >= 2 ? (s.cum[j] - s.cum[i]) / (j - i) : null;
}

function peak(s: Series, a: number, b: number): number | null {
  let m: number | null = null;
  for (let i = lowerBound(s.t, a); i < s.t.length && s.t[i] <= b; i++) m = Math.max(m ?? 0, s.v[i]);
  return m;
}

/** Minuten seit Beginn der laufenden Sitzung, null wenn A gerade nicht live ist */
function ageAt(s: Series, x: number): number | null {
  const k = lowerBound(s.t, x + 1e-9) - 1;
  if (k < 0 || x - s.t[k] > SESSION_GAP_MIN) return null;
  return x - s.sess[k];
}

const mean = (l: number[]) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : 0);
const stdErr = (l: number[]) => {
  if (l.length < 2) return Infinity;
  const m = mean(l);
  return Math.sqrt(mean(l.map((x) => (x - m) ** 2))) / Math.sqrt(l.length);
};

const berlinHour = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" });
const hourCache = new Map<number, number>();
/** Tageszeit-Block (4 Stunden, Berliner Zeit) */
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

async function compute(): Promise<Migration> {
  const db = await getDb();
  // Je Spieler eine Zeile mit Zeit- und Zuschauerreihe: 94 Zeilen statt ~800.000 Objekte (wenig Speicher)
  const [rows, startRows] = await Promise.all([
    db.query<{ player: string; ts: number[]; vs: number[] }>(
      `SELECT player, array_agg((extract(epoch FROM at) / 60)::int ORDER BY at) AS ts, array_agg(viewers ORDER BY at) AS vs
         FROM player_history WHERE viewers IS NOT NULL GROUP BY player`,
    ),
    db.query<{ player: string; m: number }>(`SELECT player, (extract(epoch FROM at) / 60)::float8 AS m FROM events WHERE type = 'stream_start' ORDER BY at`),
  ]);
  const series = new Map<string, Series>();
  let from = Infinity;
  let to = -Infinity;
  for (const r of rows.rows) {
    const n = r.ts.length;
    const t = Float64Array.from(r.ts);
    const v = Float64Array.from(r.vs);
    const cum = new Float64Array(n + 1);
    const sess = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      cum[i + 1] = cum[i] + v[i];
      sess[i] = i > 0 && t[i] - t[i - 1] <= SESSION_GAP_MIN ? sess[i - 1] : t[i];
    }
    if (n) {
      from = Math.min(from, t[0]);
      to = Math.max(to, t[n - 1]);
    }
    series.set(r.player, { t, v, cum, sess });
  }

  // Große Starts
  const big: { b: string; t0: number; peak: number }[] = [];
  for (const s of startRows.rows) {
    const sb = series.get(s.player);
    const p = sb ? peak(sb, s.m + 10, s.m + 30) : null;
    if (p !== null && p >= MIN_B_PEAK) big.push({ b: s.player, t0: s.m, peak: p });
  }
  const bigT = Float64Array.from(big.map((x) => x.t0)).sort();
  const nearBig = (x: number) => {
    const i = lowerBound(bigT, x - NEAR_START_MIN);
    return i < bigT.length && bigT[i] <= x + NEAR_START_MIN;
  };
  const change = (s: Series, t0: number) => {
    const before = avg(s, t0 - 5, t0);
    const after = avg(s, t0 + 10, t0 + 20);
    return before === null || after === null || before < MIN_A_VIEWERS ? null : { before, rel: (after - before) / before };
  };

  // Übliche Änderung je (A, Streamalter, Tageszeit); Ersatz (A, Streamalter), wenn zu wenige Fenster
  const ctrl = new Map<string, number[]>();
  for (const [a, s] of series) {
    for (let i = 0; i < s.t.length; i += 5) {
      const t0 = s.t[i];
      if (nearBig(t0)) continue;
      const age = ageAt(s, t0);
      if (age === null || age < MIN_A_AGE_MIN) continue;
      const c = change(s, t0);
      if (!c) continue;
      for (const k of [`${a}|${ageBlock(age)}|${hourBlock(t0)}`, `${a}|${ageBlock(age)}`]) {
        const l = ctrl.get(k);
        if (l) l.push(c.rel);
        else ctrl.set(k, [c.rel]);
      }
    }
  }
  const usual = (a: string, age: number, t0: number) => {
    for (const k of [`${a}|${ageBlock(age)}|${hourBlock(t0)}`, `${a}|${ageBlock(age)}`]) {
      const l = ctrl.get(k);
      if (l && l.length >= 5) return mean(l);
    }
    return null;
  };

  type Obs = { a: string; b: string; t0: number; before: number; ex: number; exAbs: number; startIdx: number };
  const obs: Obs[] = [];
  big.forEach((s, startIdx) => {
    for (const [a, sa] of series) {
      if (a === s.b) continue;
      const age = ageAt(sa, s.t0);
      if (age === null || age < MIN_A_AGE_MIN) continue;
      const c = change(sa, s.t0);
      if (!c) continue;
      const u = usual(a, age, s.t0);
      if (u === null) continue;
      obs.push({ a, b: s.b, t0: s.t0, before: c.before, ex: c.rel - u, exAbs: (c.rel - u) * c.before, startIdx });
    }
  });

  const group = <K extends string>(list: Obs[], key: (o: Obs) => K) => {
    const m = new Map<K, Obs[]>();
    for (const o of list) {
      const k = key(o);
      const l = m.get(k);
      if (l) l.push(o);
      else m.set(k, [o]);
    }
    return m;
  };

  const waitingRooms: WaitingRoom[] = [...group(obs, (o) => o.a)]
    .filter(([, l]) => l.length >= 10)
    .map(([id, l]) => {
      const e = l.map((o) => o.ex);
      return { id, n: l.length, baseViewers: mean(l.map((o) => o.before)), effect: mean(e), t: mean(e) / stdErr(e), perStart: mean(l.map((o) => o.exAbs)) };
    })
    .sort((x, y) => x.effect - y.effect);

  const byStart = group(obs, (o) => String(o.startIdx) as `${number}`);
  const pulledOf = (idx: number) => -(byStart.get(String(idx) as `${number}`) ?? []).reduce((s, o) => s + o.exAbs, 0);
  const magnets: Magnet[] = [...group(obs, (o) => o.b)]
    .map(([id, l]) => {
      const idx = [...new Set(l.map((o) => o.startIdx))];
      return { id, starts: idx.length, pulled: mean(idx.map(pulledOf)), peak: mean(idx.map((i) => big[i].peak)) };
    })
    .filter((m) => m.starts >= 3)
    .sort((x, y) => y.pulled - x.pulled);

  const pairs: Pair[] = [...group(obs, (o) => `${o.a}|${o.b}`)].map(([k, l]) => {
    const [a, b] = k.split("|");
    return { a, b, n: l.length, perStart: mean(l.map((o) => o.exAbs)) };
  });

  // Beispiele: die Starts, die anderen am meisten abgezogen haben, mit den drei größten Verlierern
  const examples: Example[] = big
    .map((s, i) => ({ s, i, pulled: pulledOf(i) }))
    .sort((x, y) => y.pulled - x.pulled)
    .slice(0, 6)
    .map(({ s, i, pulled }) => {
      const losers = (byStart.get(String(i) as `${number}`) ?? []).sort((x, y) => x.exAbs - y.exAbs).slice(0, 3);
      return {
        b: s.b,
        at: s.t0 * 60_000,
        peak: s.peak,
        pulled,
        lines: losers.map((o) => {
          const sa = series.get(o.a)!;
          const points: [number, number][] = [];
          for (let k = lowerBound(sa.t, s.t0 - 30); k < sa.t.length && sa.t[k] <= s.t0 + 60; k++) {
            points.push([Math.round((sa.t[k] - s.t0) * 10) / 10, Math.round((1000 * sa.v[k]) / o.before) / 10]);
          }
          return { a: o.a, before: o.before, points, loss: o.exAbs };
        }),
      };
    });

  const all = obs.map((o) => o.ex);
  return {
    from: Number.isFinite(from) ? from * 60_000 : null,
    to: Number.isFinite(to) ? to * 60_000 : null,
    streamers: series.size,
    bigStarts: big.length,
    observations: obs.length,
    overall: { effect: mean(all), se: stdErr(all) },
    waitingRooms,
    magnets,
    pairs,
    examples,
  };
}

const swr = createSwrCache();

/** Ergebnis der Analyse, eine Stunde zwischengespeichert (neue Zuschauerdaten kommen höchstens minütlich) */
export function getViewerMigration(): Promise<Migration> {
  return swr("viewer-migration", CACHE_MS, compute);
}
