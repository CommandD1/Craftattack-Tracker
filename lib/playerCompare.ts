import "server-only";
import { loadTracker } from "./data";
import { getAllSessions, getTwitchCheerProfile, getTwitchSubscriptionProfile } from "./store";
import { getPlayerEarnings } from "./earnings";
import { getRhythms, type Rhythm } from "./rhythm";
import { TRAITS, type TraitKey } from "./rhythmCore";
import { getNetworkSummary, type NetworkSummary } from "./networkSummary";
import { distancesFrom } from "./network";
import { emptyLink, type LinkCounts } from "./connectionWeights";
import type { Role } from "./groups";
import { overlapsFor } from "./overlap";
import { pairIds } from "./eventPair";
import { playtimeOf, trackedSecondsOf } from "./playtime";
import { getPlayerAfkSpans, spanSeconds } from "./analytics";
import { getFlows, getOnServerViewers, getStreamerSeason } from "./viewerMigration";
import { getRaidAnalysis, type RaidPlayer } from "./raidAnalysis";
import { getAdvancementBoard } from "./playerAdvancements";
import { ADV_BY_ID } from "./advancements";
import { BOARD_ICON, type IconName } from "./iconNames";
import { BOARD_KEYS, type BoardKey, type PlayerState, type TrackerEvent } from "./types";
import { EXTRA_STATS, EXTRA_STAT_KEYS, FORMATTERS, type ExtraStatKey } from "./playerStats";
import { boardValue, duration, eur, num } from "./format";
import type { Metric } from "./graphQuery";

/**
 * Spielervergleich (Vorschau /vorschau/<key>/vergleich): zwei Spieler Kopf an Kopf – Statistiken, Rhythmus, Netz,
 * Zuschauer, Raids, Fortschritte und was sie verbindet; dazu automatisch gefundene Gemeinsamkeiten und Unterschiede.
 * Alles aus vorhandenen Quellen, nichts Neues gespeichert.
 */

export type Side = "a" | "b";

/** Wann ein Wert „gewinnt“: mehr ist besser, weniger ist besser (Tode, Schaden erlitten, Totems, AFK) oder gar nicht */
export type Win = "mehr" | "weniger" | null;

export interface CompareRow {
  key: string;
  label: string;
  icon?: IconName;
  a: number | null;
  b: number | null;
  show: (v: number) => string;
  win: Win;
  rankA?: number | null;
  rankB?: number | null;
  metric?: Metric;
  /** Je Stunde Spielzeit sinnvoll (Zähler, keine Zeiten oder Höchstwerte) */
  perHour?: boolean;
  hint?: string;
}

export interface CompareGroup {
  key: string;
  label: string;
  rows: CompareRow[];
}

export interface PairEvent {
  type: TrackerEvent["type"];
  from: Side;
  count: number;
}

export interface Insight {
  kind: "gleich" | "anders";
  /** Wie auffällig (für die Reihenfolge) */
  score: number;
  text: string;
  /** Thema, damit nicht fünf Statistik-Sätze die Liste füllen */
  topic: string;
}

export interface Friend {
  id: string;
  /** Stärke beider Richtungen zusammen (Punkte wie auf /verbindungen) */
  w: number;
}

export interface NetSide {
  friends: Friend[];
  /** Zahl direkter Verbindungen */
  degree: number;
  /** Summe aller Verbindungsstärken */
  strength: number;
  /** Platz nach Gesamtstärke unter allen im Netz */
  strengthRank: number | null;
  group: { index: number; leader: string; color: string; role: Role; size: number } | null;
  /** Platz des anderen in der eigenen Freundesliste, null = keine direkte Verbindung */
  otherPlace: number | null;
  /** Stärkste Freunde, die mit dem anderen gar nicht verbunden sind */
  ownCircle: Friend[];
}

export interface NetCompare {
  direct: number;
  /** Einordnung der direkten Verbindung */
  verdict: "eng" | "befreundet" | "bekannt" | "fremd";
  a: NetSide;
  b: NetSide;
  /** Gemeinsame direkte Freunde, nach der schwächeren der beiden Verbindungen */
  common: (Friend & { wa: number; wb: number })[];
  commonCount: number;
  /** Überschneidung der Freundeskreise (gewichtet), 0–1 */
  overlap: number;
  hops: number | null;
  path: string[];
  sameGroup: boolean | null;
  /** Spieler im Netz (mit mindestens einer Verbindung) */
  nodes: number;
}

export interface Flow {
  viewers: number;
  raid: number;
  start: number;
  beta: number;
  stay: number | null;
}

export interface ViewerSide {
  days: number;
  hours: number;
  /** Ø Zuschauer (gewichtet nach Stunden) */
  avg: number | null;
  best: { day: string; avg: number } | null;
  /** Ø Anteil am gesamten CraftAttack-Publikum */
  share: number | null;
  ownChange: number | null;
  lessCompetition: number | null;
  raid: RaidPlayer | null;
  /** Wohin seine Zuschauer am häufigsten wandern */
  topTo: { id: string; viewers: number }[];
}

export interface ViewerCompare {
  a: ViewerSide;
  b: ViewerSide;
  marketChange: number | null;
  /** Zuschauer-Wanderung zwischen beiden (Staffel-Muster) */
  ab: Flow | null;
  ba: Flow | null;
  /** Platz des anderen unter den Zielen der eigenen Zuschauer */
  placeAB: number | null;
  placeBA: number | null;
}

export interface AdvCompare {
  countA: number;
  countB: number;
  shared: number;
  onlyA: { id: string; title: string; rare: number }[];
  onlyB: { id: string; title: string; rare: number }[];
  /** Bei gemeinsamen Fortschritten mit Zeitpunkt: wer war zuerst */
  firstA: number;
  firstB: number;
  players: number;
}

export interface Strength {
  id: string;
  /** Ø Perzentil über alle „mehr ist besser“-Kennzahlen, 0–1 */
  score: number;
  place: number;
  /** Stärkste Kennzahl (höchstes Perzentil) */
  best: { label: string; pct: number };
  stats: number;
}

export interface CompareData {
  a: PlayerState;
  b: PlayerState;
  now: number;
  hoursA: number;
  hoursB: number;
  groups: CompareGroup[];
  strengthA: Strength | null;
  strengthB: Strength | null;
  strengthOf: number;
  rhythmA: Rhythm | null;
  rhythmB: Rhythm | null;
  hourSimilarity: number | null;
  together: {
    seconds: number;
    sessions: number;
    now: boolean;
    placeInA: number | null;
    placeInB: number | null;
    shareA: number;
    shareB: number;
  };
  link: LinkCounts;
  net: NetCompare;
  viewers: ViewerCompare;
  adv: AdvCompare;
  pairEvents: PairEvent[];
  recent: TrackerEvent[];
  insights: Insight[];
}

const ratio = (v: number) => `${Math.round(v * 100)} %`;
const dec = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);

/* ------------------------------------------------------------------ Kennzahlen */

const BOARD_LABEL: Record<BoardKey, string> = {
  playtimeSeconds: "Spielzeit",
  diamonds: "Diamanten",
  deaths: "Tode",
  blocksBroken: "Blöcke abgebaut",
  mobsKilled: "Mobs getötet",
  distance: "Strecke",
  damageDealt: "Schaden",
  totemsUsed: "Totems",
  foodEaten: "Essen",
};

/**
 * Kennzahlen, bei denen weniger besser ist (Pech, Verlust, Untätigkeit). Fallen und fallen gelassene Items wachsen
 * mit der Spielzeit, nicht mit Ungeschick, und zählen deshalb normal (mehr = besser).
 */
const LOWER_WINS = new Set<string>(["deaths", "totemsUsed", "damageTaken", "afkSeconds", "afkShare"]);
const winOf = (k: string): Win => (LOWER_WINS.has(k) ? "weniger" : "mehr");

/** Wer bei einer Kennzahl vorne liegt (null = Gleichstand, fehlender Wert oder zählt nicht) */
export function leadOf(r: Pick<CompareRow, "a" | "b" | "win">): Side | null {
  if (!r.win || r.a === null || r.b === null || r.a === r.b) return null;
  return r.a > r.b === (r.win === "mehr") ? "a" : "b";
}

const extraOf = (p: PlayerState, k: ExtraStatKey) => {
  const v = p.detail?.stats[k];
  return typeof v === "number" ? v : null;
};

function statRows(a: PlayerState, b: PlayerState, now: number): { board: CompareRow[]; extra: CompareRow[] } {
  const playA = playtimeOf(a, now).seconds;
  const playB = playtimeOf(b, now).seconds;
  const board: CompareRow[] = BOARD_KEYS.map((k) => ({
    key: k,
    label: BOARD_LABEL[k],
    icon: BOARD_ICON[k],
    a: k === "playtimeSeconds" ? playA || null : (a.stats[k] ?? null),
    b: k === "playtimeSeconds" ? playB || null : (b.stats[k] ?? null),
    show: (v: number) => boardValue(k, v),
    win: winOf(k),
    rankA: a.ranks?.[k]?.rank ?? null,
    rankB: b.ranks?.[k]?.rank ?? null,
    metric: k as Metric,
    perHour: k !== "playtimeSeconds",
  }));
  const extra: CompareRow[] = EXTRA_STAT_KEYS.filter((k) => extraOf(a, k) !== null || extraOf(b, k) !== null).map((k) => ({
    key: k,
    label: EXTRA_STATS[k].label,
    icon: EXTRA_STATS[k].icon as IconName,
    a: extraOf(a, k),
    b: extraOf(b, k),
    show: FORMATTERS[EXTRA_STATS[k].format],
    win: winOf(k),
    rankA: a.detail?.ranks[k]?.rank ?? null,
    rankB: b.detail?.ranks[k]?.rank ?? null,
    metric: EXTRA_STATS[k].metric as Metric,
    perHour: EXTRA_STATS[k].format !== "duration",
  }));
  return { board, extra };
}

/* ------------------------------------------------------------------ Stärkste Spieler */

/** Mindest-Spielzeit, um in der Stärke-Rangliste zu stehen (sonst führen Spieler mit einer einzigen Session) */
export const STRENGTH_MIN_HOURS = 10;

/**
 * „Stärke“: Für jede Kennzahl das Perzentil des Spielers unter allen mit Wert (1 = bester; bei Tode, Schaden
 * erlitten, Totems und AFK umgedreht: wenig = gut); der Durchschnitt darüber. Absolute Werte.
 */
export function strengthBoard(players: Record<string, PlayerState>, now: number): Strength[] {
  const list = Object.values(players).filter((p) => playtimeOf(p, now).seconds >= STRENGTH_MIN_HOURS * 3600);
  const keys: { label: string; lower: boolean; get: (p: PlayerState) => number | null }[] = [
    ...BOARD_KEYS.map((k) => ({
      label: BOARD_LABEL[k],
      lower: LOWER_WINS.has(k),
      get: (p: PlayerState) => (k === "playtimeSeconds" ? playtimeOf(p, now).seconds || null : (p.stats[k] ?? null)),
    })),
    ...EXTRA_STAT_KEYS.map((k) => ({ label: EXTRA_STATS[k].label as string, lower: LOWER_WINS.has(k), get: (p: PlayerState) => extraOf(p, k) })),
  ];
  const acc = new Map<string, { sum: number; n: number; best: { label: string; pct: number } }>();
  for (const k of keys) {
    const vals = list.map((p) => [p.id, k.get(p)] as const).filter((x): x is readonly [string, number] => x[1] !== null);
    if (vals.length < 5) continue;
    const sorted = vals.map((x) => x[1]).sort((x, y) => x - y);
    for (const [id, v] of vals) {
      // Anteil der Spieler mit kleinerem Wert (Gleichstand halb)
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (sorted[m] < v) lo = m + 1;
        else hi = m;
      }
      let eq = lo;
      while (eq < sorted.length && sorted[eq] === v) eq++;
      const up = (lo + (eq - lo - 1) / 2) / Math.max(1, sorted.length - 1);
      const pct = k.lower ? 1 - up : up;
      const c = acc.get(id) ?? { sum: 0, n: 0, best: { label: k.label, pct: -1 } };
      c.sum += pct;
      c.n++;
      if (pct > c.best.pct) c.best = { label: k.lower ? `${k.label} (wenig)` : k.label, pct };
      acc.set(id, c);
    }
  }
  return [...acc]
    .filter(([, c]) => c.n >= 5)
    .map(([id, c]) => ({ id, score: c.sum / c.n, best: c.best, stats: c.n, place: 0 }))
    .sort((x, y) => y.score - x.score)
    .map((s, i) => ({ ...s, place: i + 1 }));
}

/* ------------------------------------------------------------------ Netz */

/** Verbindungsstärke zu allen Nachbarn, beide Richtungen zusammen */
function neighbours(net: NetworkSummary, id: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [x, w] of net.out.get(id) ?? []) m.set(x, (m.get(x) ?? 0) + w);
  for (const [x, row] of net.out) {
    if (x === id) continue;
    const w = row.get(id);
    if (w) m.set(x, (m.get(x) ?? 0) + w);
  }
  return m;
}

function netCompare(net: NetworkSummary, idA: string, idB: string): NetCompare {
  const nA = neighbours(net, idA);
  const nB = neighbours(net, idB);
  const sortF = (m: Map<string, number>) => [...m].map(([id, w]) => ({ id, w })).sort((x, y) => y.w - x.w);
  const fA = sortF(nA);
  const fB = sortF(nB);
  const totals = new Map<string, number>();
  for (const [x, row] of net.out)
    for (const [y, w] of row) {
      totals.set(x, (totals.get(x) ?? 0) + w);
      totals.set(y, (totals.get(y) ?? 0) + w);
    }
  const order = [...totals].sort((x, y) => y[1] - x[1]).map(([id]) => id);
  const groupInfo = (id: string): NetSide["group"] => {
    const gi = net.analysis.groupOf.get(id);
    if (gi === undefined) return null;
    const g = net.analysis.groups.find((x) => x.index === gi);
    const m = g?.members.find((x) => x.id === id);
    return g && m ? { index: g.index, leader: g.leader, color: g.color, role: m.role, size: g.members.length } : null;
  };
  const side = (id: string, other: string, f: Friend[], otherN: Map<string, number>): NetSide => {
    const place = f.findIndex((x) => x.id === other);
    const rank = order.indexOf(id);
    return {
      friends: f.filter((x) => x.id !== other).slice(0, 6),
      degree: f.length,
      strength: totals.get(id) ?? 0,
      strengthRank: rank >= 0 ? rank + 1 : null,
      group: groupInfo(id),
      otherPlace: place >= 0 ? place + 1 : null,
      ownCircle: f.filter((x) => x.id !== other && !otherN.has(x.id)).slice(0, 5),
    };
  };
  const a = side(idA, idB, fA, nB);
  const b = side(idB, idA, fB, nA);
  const direct = nA.get(idB) ?? 0;
  const common = fA
    .filter((x) => x.id !== idB && nB.has(x.id))
    .map((x) => ({ id: x.id, wa: x.w, wb: nB.get(x.id)!, w: Math.min(x.w, nB.get(x.id)!) }))
    .sort((x, y) => y.w - x.w);
  // Gewichtete Überschneidung: Summe der kleineren Anteile (je auf die eigene Gesamtstärke normiert, ohne den anderen)
  const norm = (m: Map<string, number>, skip: string) => {
    const rest = [...m].filter(([x]) => x !== skip);
    const s = rest.reduce((t, [, w]) => t + w, 0) || 1;
    return new Map(rest.map(([x, w]) => [x, w / s]));
  };
  const pA = norm(nA, idB);
  const pB = norm(nB, idA);
  let overlap = 0;
  for (const [x, v] of pA) overlap += Math.min(v, pB.get(x) ?? 0);
  const best = Math.min(a.otherPlace ?? Infinity, b.otherPlace ?? Infinity);
  const verdict: NetCompare["verdict"] = !direct ? "fremd" : best <= 3 ? "eng" : best <= 10 ? "befreundet" : "bekannt";
  const reach = distancesFrom(idA, net.out, "gegenseitig").get(idB);
  const gA = net.analysis.groupOf.get(idA);
  const gB = net.analysis.groupOf.get(idB);
  return {
    direct,
    verdict,
    a,
    b,
    common: common.slice(0, 10),
    commonCount: common.length,
    overlap,
    // Direkt verbunden = 1 Schritt, auch wenn der „kürzeste“ gewichtete Weg über einen engeren Freund liefe
    hops: direct ? 1 : reach ? reach.hops : null,
    path: direct ? [idA, idB] : (reach?.path ?? []),
    sameGroup: gA === undefined || gB === undefined ? null : gA === gB,
    nodes: totals.size,
  };
}

/* ------------------------------------------------------------------ Zuschauer und Raids */

async function viewerCompare(idA: string, idB: string): Promise<ViewerCompare> {
  const [flows, raids, sA, sB] = await Promise.all([
    // Fokus Server: Wanderung und Raids nur, wenn einer der beiden Beteiligten auf dem Server war; Streamtage nur
    // Tage, an denen der Streamer auf CraftAttack live war (Ø Zuschauer und Stunden setzt getComparison genau)
    getFlows("einer").catch(() => null),
    getRaidAnalysis("einer").catch(() => null),
    getStreamerSeason(idA, true).catch(() => null),
    getStreamerSeason(idB, true).catch(() => null),
  ]);
  const side = (id: string, s: Awaited<ReturnType<typeof getStreamerSeason>>): ViewerSide => {
    const days = s?.days ?? [];
    const hours = days.reduce((t, d) => t + d.hours, 0);
    const avg = hours > 0 ? days.reduce((t, d) => t + d.avg * d.hours, 0) / hours : null;
    const share = hours > 0 ? days.reduce((t, d) => t + d.share * d.hours, 0) / hours : null;
    const best = days.length ? days.reduce((m, d) => (d.avg > m.avg ? d : m), days[0]) : null;
    const topTo = (flows?.pairs ?? [])
      .filter((p) => p.from === id && p.viewers >= 1)
      .sort((x, y) => y.viewers - x.viewers)
      .slice(0, 5)
      .map((p) => ({ id: p.to, viewers: p.viewers }));
    return {
      days: days.length,
      hours,
      avg,
      best: best ? { day: best.day, avg: best.avg } : null,
      share,
      ownChange: s?.ownChange ?? null,
      lessCompetition: s?.lessCompetition ?? null,
      raid: raids?.players.find((p) => p.id === id) ?? null,
      topTo,
    };
  };
  const pick = (from: string, to: string): Flow | null => {
    const p = flows?.pairs.find((x) => x.from === from && x.to === to);
    return p ? { viewers: p.viewers, raid: p.raid, start: p.start, beta: p.beta, stay: p.stay } : null;
  };
  const place = (from: string, to: string) => {
    const list = (flows?.pairs ?? []).filter((p) => p.from === from && p.viewers >= 1).sort((x, y) => y.viewers - x.viewers);
    const i = list.findIndex((p) => p.to === to);
    return i >= 0 ? i + 1 : null;
  };
  return {
    a: side(idA, sA),
    b: side(idB, sB),
    marketChange: sA?.marketChange ?? sB?.marketChange ?? null,
    ab: pick(idA, idB),
    ba: pick(idB, idA),
    placeAB: place(idA, idB),
    placeBA: place(idB, idA),
  };
}

/* ------------------------------------------------------------------ Fortschritte */

async function advCompare(a: PlayerState, b: PlayerState, players: Record<string, PlayerState>): Promise<AdvCompare> {
  const [bA, bB] = await Promise.all([getAdvancementBoard(a.id, players), getAdvancementBoard(b.id, players)]);
  const kA = Object.keys(bA.mine);
  const kB = new Set(Object.keys(bB.mine));
  const item = (id: string) => {
    const o = bA.others[id];
    return { id, title: ADV_BY_ID.get(id)?.title ?? id, rare: o ? o[0] + o[1] : 0 };
  };
  let firstA = 0;
  let firstB = 0;
  for (const id of kA) {
    if (!kB.has(id)) continue;
    const ta = bA.mine[id].at;
    const tb = bB.mine[id].at;
    if (ta && tb && ta !== tb) {
      if (ta < tb) firstA++;
      else firstB++;
    }
  }
  return {
    countA: kA.length,
    countB: kB.size,
    shared: kA.filter((id) => kB.has(id)).length,
    onlyA: kA.filter((id) => !kB.has(id)).map(item).sort((x, y) => x.rare - y.rare),
    onlyB: [...kB].filter((id) => !(id in bA.mine)).map(item).sort((x, y) => x.rare - y.rare),
    firstA,
    firstB,
    players: bA.players,
  };
}

/* ------------------------------------------------------------------ Gemeinsamkeiten und Unterschiede */

function findInsights(d: Omit<CompareData, "insights">, nameOf: (id: string) => string): Insight[] {
  const A = d.a.name;
  const B = d.b.name;
  const out: Insight[] = [];
  const push = (kind: Insight["kind"], score: number, topic: string, text: string) => out.push({ kind, score, topic, text });

  // Kennzahlen: große Unterschiede (je Stunde, damit nicht nur die Spielzeit spricht) und auffällige Gleichstände
  for (const g of d.groups)
    for (const r of g.rows) {
      // Ø Zuschauer hat einen eigenen Satz weiter unten
      if (r.a === null || r.b === null || r.a <= 0 || r.b <= 0 || r.key === "avgViewers") continue;
      const f = Math.max(r.a, r.b) / Math.min(r.a, r.b);
      if (r.perHour && d.hoursA >= 5 && d.hoursB >= 5) {
        const ra = r.a / d.hoursA;
        const rb = r.b / d.hoursB;
        const fh = Math.max(ra, rb) / Math.min(ra, rb);
        if (fh >= 2) push("anders", Math.log2(fh), `stat:${g.key}`, `${ra > rb ? A : B} ${r.win === "weniger" ? "hat" : "schafft"} je Stunde ${dec(fh)}× so viel „${r.label}“ wie ${ra > rb ? B : A}.`);
        else if (fh <= 1.08 && f <= 1.15) push("gleich", 1.2 - (fh - 1) * 5, `stat:${g.key}`, `„${r.label}“ fast gleich: ${r.show(r.a)} und ${r.show(r.b)}.`);
      } else if (f >= 2.5) push("anders", Math.log2(f) * 0.8, `stat:${g.key}`, `${r.a > r.b ? A : B} hat bei „${r.label}“ ${dec(f)}× so viel wie ${r.a > r.b ? B : A}.`);
      else if (f <= 1.05) push("gleich", 1, `stat:${g.key}`, `„${r.label}“ fast gleich: ${r.show(r.a)} und ${r.show(r.b)}.`);
    }

  // Stärke
  if (d.strengthA && d.strengthB) {
    const diff = Math.abs(d.strengthA.place - d.strengthB.place);
    if (diff <= 3) push("gleich", 1.6, "staerke", `In der Gesamtstärke direkt beieinander: Platz ${d.strengthA.place} und ${d.strengthB.place}.`);
    else if (diff >= 20) push("anders", 1.5, "staerke", `${d.strengthA.place < d.strengthB.place ? A : B} steht in der Gesamtstärke ${diff} Plätze weiter vorne.`);
  }

  // Rhythmus
  const ra = d.rhythmA;
  const rb = d.rhythmB;
  if (ra && rb && d.hourSimilarity !== null) {
    if (d.hourSimilarity >= 0.75) push("gleich", 2 + d.hourSimilarity, "rhythmus", `Spielen zu denselben Uhrzeiten: Tagesprofile decken sich zu ${ratio(d.hourSimilarity)}.`);
    else if (d.hourSimilarity <= 0.5) push("anders", 2.5 - d.hourSimilarity, "rhythmus", `Verschiedene Uhrzeiten: Tagesprofile decken sich nur zu ${ratio(d.hourSimilarity)}.`);
    const hd = Math.min(Math.abs(ra.peakHour - rb.peakHour), 24 - Math.abs(ra.peakHour - rb.peakHour));
    if (hd >= 4) push("anders", 1.5 + hd / 6, "rhythmus2", `Stärkste Stunde: ${ra.peakHour} Uhr bei ${A}, ${rb.peakHour} Uhr bei ${B}.`);
    const tA = new Set(ra.traits.map((t) => t.key));
    const tB = new Set(rb.traits.map((t) => t.key));
    const both = [...tA].filter((k) => tB.has(k));
    if (both.length) push("gleich", 2.2, "typ", `Beide sind ${both.map((k) => `„${TRAITS[k as TraitKey].label}“`).join(" und ")}.`);
    const onlyA = [...tA].filter((k) => !tB.has(k));
    const onlyB = [...tB].filter((k) => !tA.has(k));
    if (onlyA.length && onlyB.length) push("anders", 1.8, "typ", `${A} ist „${TRAITS[onlyA[0] as TraitKey].label}“, ${B} „${TRAITS[onlyB[0] as TraitKey].label}“.`);
    const sf = Math.max(ra.medianSession, rb.medianSession) / Math.max(1, Math.min(ra.medianSession, rb.medianSession));
    if (sf >= 2) push("anders", 1 + Math.log2(sf), "session", `${ra.medianSession > rb.medianSession ? A : B} spielt am Stück ${dec(sf)}× so lange (typische Session ${duration(Math.max(ra.medianSession, rb.medianSession) * 60)}).`);
    if (ra.liveShare !== null && rb.liveShare !== null && Math.abs(ra.liveShare - rb.liveShare) >= 0.4)
      push("anders", 1.6, "live", `${ra.liveShare > rb.liveShare ? A : B} streamt fast immer beim Spielen (${ratio(Math.max(ra.liveShare, rb.liveShare))}), ${ra.liveShare > rb.liveShare ? B : A} nur zu ${ratio(Math.min(ra.liveShare, rb.liveShare))}.`);
  }

  // Zusammen online
  const t = d.together;
  if (t.placeInA === 1 || t.placeInB === 1) push("gleich", 3, "zusammen", `${t.placeInA === 1 ? `${B} ist der häufigste Mitspieler von ${A}` : `${A} ist der häufigste Mitspieler von ${B}`} (${duration(t.seconds)} gemeinsam).`);
  else if (Math.max(t.shareA, t.shareB) >= 0.5) push("gleich", 2.2, "zusammen", `Oft gleichzeitig online: ${ratio(Math.max(t.shareA, t.shareB))} der Zeit von ${t.shareA >= t.shareB ? A : B} war der andere dabei.`);
  else if (t.seconds === 0) push("anders", 2, "zusammen", "Waren nie gleichzeitig auf dem Server.");

  // Netz
  const n = d.net;
  if (n.verdict === "eng") {
    const [who, of, place] = (n.a.otherPlace ?? 99) <= (n.b.otherPlace ?? 99) ? [B, A, n.a.otherPlace] : [A, B, n.b.otherPlace];
    push("gleich", 3.2, "netz", place === 1 ? `${who} ist die stärkste Verbindung von ${of} im Netz.` : `Eng verbunden: ${who} ist Nr. ${place} unter den Verbindungen von ${of}.`);
  }
  else if (n.verdict === "fremd")
    push(
      "anders",
      2.6,
      "netz",
      n.commonCount
        ? `Keine direkte Verbindung – aber ${n.commonCount} gemeinsame Bekannte, allen voran ${n.common.slice(0, 2).map((c) => nameOf(c.id)).join(" und ")}.`
        : `Keine direkte Verbindung und keine gemeinsamen Bekannten${n.hops ? ` (${n.hops} Schritte im Netz)` : ""}.`,
    );
  if (n.sameGroup === true) push("gleich", 2.4, "gruppe", `Beide gehören zur selben Gruppe im Netz.`);
  else if (n.sameGroup === false) push("anders", 2, "gruppe", `Verschiedene Gruppen im Netz.`);
  if (n.overlap >= 0.4) push("gleich", 1.5 + n.overlap, "kreis", `Ähnlicher Freundeskreis: ${ratio(n.overlap)} Überschneidung.`);
  else if (n.overlap <= 0.1 && n.a.degree > 3 && n.b.degree > 3) push("anders", 1.8, "kreis", `Fast getrennte Freundeskreise (${ratio(n.overlap)} Überschneidung).`);
  const df = Math.max(n.a.degree, n.b.degree) / Math.max(1, Math.min(n.a.degree, n.b.degree));
  if (df >= 2.5 && Math.max(n.a.degree, n.b.degree) >= 8)
    push("anders", 1.4, "grad", `${n.a.degree > n.b.degree ? A : B} ist mit ${Math.max(n.a.degree, n.b.degree)} Spielern verbunden, ${n.a.degree > n.b.degree ? B : A} nur mit ${Math.min(n.a.degree, n.b.degree)}.`);

  // Zuschauer
  const v = d.viewers;
  if (v.a.avg && v.b.avg) {
    const f = Math.max(v.a.avg, v.b.avg) / Math.min(v.a.avg, v.b.avg);
    if (f >= 2) push("anders", 1.5 + Math.log2(f) / 2, "zuschauer", `${v.a.avg > v.b.avg ? A : B} hat im Schnitt ${dec(f)}× so viele Zuschauer (${num(Math.max(v.a.avg, v.b.avg))} zu ${num(Math.min(v.a.avg, v.b.avg))}).`);
    else if (f <= 1.15) push("gleich", 1.6, "zuschauer", `Ähnlich viele Zuschauer: ${num(v.a.avg)} und ${num(v.b.avg)} im Schnitt.`);
  } else if (v.a.avg || v.b.avg) push("anders", 1.6, "zuschauer", `Nur ${v.a.avg ? A : B} streamt.`);
  if (v.placeAB === 1 || v.placeBA === 1) push("gleich", 2.6, "wanderung", v.placeAB === 1 ? `Zuschauer von ${A} wandern am häufigsten zu ${B}.` : `Zuschauer von ${B} wandern am häufigsten zu ${A}.`);
  const raids = d.link.raidsAB + d.link.raidsBA;
  if (raids >= 3) push("gleich", 1.8 + Math.log2(raids) / 2, "raids", `${raids} Raids untereinander (${d.link.raidsAB} von ${A}, ${d.link.raidsBA} von ${B}).`);
  const rA = v.a.raid;
  const rB = v.b.raid;
  if (rA && rB && rA.given + rB.given >= 6) {
    const qa = rA.opportunities ? rA.given / rA.opportunities : 0;
    const qb = rB.opportunities ? rB.given / rB.opportunities : 0;
    if (Math.abs(qa - qb) >= 0.3) push("anders", 1.5, "raidrate", `${qa > qb ? A : B} raidet nach ${ratio(Math.max(qa, qb))} der Streams, ${qa > qb ? B : A} nur nach ${ratio(Math.min(qa, qb))}.`);
  }

  // Fortschritte
  const ad = d.adv;
  if (ad.countA && ad.countB) {
    const jac = ad.shared / (ad.countA + ad.countB - ad.shared);
    if (jac >= 0.85) push("gleich", 1.4, "fortschritt", `Fast dieselben Fortschritte (${ratio(jac)} gemeinsam).`);
    if (ad.firstA + ad.firstB >= 5) {
      const share = Math.max(ad.firstA, ad.firstB) / (ad.firstA + ad.firstB);
      if (share >= 0.7) push("anders", 1.3 + share, "fortschritt2", `${ad.firstA > ad.firstB ? A : B} war bei ${Math.max(ad.firstA, ad.firstB)} von ${ad.firstA + ad.firstB} gemeinsamen Fortschritten zuerst.`);
    }
  }

  // Je Thema nur der stärkste Satz, Kennzahl-Themen höchstens zwei
  out.sort((x, y) => y.score - x.score);
  const seen = new Map<string, number>();
  return out.filter((i) => {
    const key = `${i.kind}|${i.topic}`;
    const c = seen.get(key) ?? 0;
    seen.set(key, c + 1);
    return c < (i.topic.startsWith("stat:") ? 2 : 1);
  });
}

/* ------------------------------------------------------------------ Zusammenbau */

export async function getComparison(idA: string, idB: string): Promise<CompareData | null> {
  const { state, events, now } = await loadTracker();
  const a = state.players[idA];
  const b = state.players[idB];
  if (!a || !b || idA === idB) return null;

  const [sessions, rhythms, net, subsA, subsB, bitsA, bitsB, earnA, earnB, afkA, afkB, viewers, adv] = await Promise.all([
    getAllSessions(),
    getRhythms(),
    getNetworkSummary(),
    getTwitchSubscriptionProfile(idA, null),
    getTwitchSubscriptionProfile(idB, null),
    getTwitchCheerProfile(idA, null),
    getTwitchCheerProfile(idB, null),
    getPlayerEarnings(idA),
    getPlayerEarnings(idB),
    getPlayerAfkSpans(idA),
    getPlayerAfkSpans(idB),
    viewerCompare(idA, idB),
    advCompare(a, b, state.players),
  ]);

  const playA = playtimeOf(a, now).seconds;
  const playB = playtimeOf(b, now).seconds;
  const onlineA = trackedSecondsOf(a, now);
  const onlineB = trackedSecondsOf(b, now);
  const { board, extra } = statRows(a, b, now);

  // Twitch nur, solange der Streamer auf dem Server war (Abos, Bits und Einnahmen zählen ohnehin so)
  const spans = (id: string) =>
    sessions
      .filter((x) => x.player === id)
      .map((x): [number, number] => [Date.parse(x.start), x.end ? Date.parse(x.end) : now])
      .sort((x, y) => x[0] - y[0]);
  const [avgA, avgB] = await Promise.all([getOnServerViewers(idA, spans(idA)).catch(() => null), getOnServerViewers(idB, spans(idB)).catch(() => null)]);
  // Zuschauer-Abschnitt: Ø und Stunden ebenfalls nur auf dem Server
  viewers.a = { ...viewers.a, avg: avgA, hours: (a.streamOnServerSeconds ?? 0) / 3600 };
  viewers.b = { ...viewers.b, avg: avgB, hours: (b.streamOnServerSeconds ?? 0) / 3600 };
  const twitchRows: CompareRow[] = [
    { key: "followers", label: "Follower", icon: "users", a: a.followersAt ? a.followersOnServer : null, b: b.followersAt ? b.followersOnServer : null, show: num, win: "mehr", metric: "followers" as Metric, hint: "Follower-Zuwachs" },
    { key: "twitchSubs", label: "Twitch Subs", icon: "gift", a: subsA.total, b: subsB.total, show: num, win: "mehr", metric: "twitchSubs" as Metric },
    { key: "twitchBits", label: "Twitch Bits", icon: "bits", a: bitsA.onServer, b: bitsB.onServer, show: num, win: "mehr", metric: "twitchBits" as Metric, hint: "Bits aus Cheers" },
    { key: "twitchEarnings", label: "Twitch-Einnahmen", icon: "coin", a: earnA.total, b: earnB.total, show: eur, win: "mehr", metric: "twitchEarnings" as Metric, hint: "Geschätzt aus Abos und Bits, ohne Werbung" },
    { key: "avgViewers", label: "Ø Zuschauer", icon: "eye", a: avgA, b: avgB, show: num, win: "mehr", hint: "Ohne die erste halbe Stunde des Streams" },
    { key: "peakViewers", label: "Peak-Zuschauer", icon: "trophy", a: a.peakViewersOnServer || null, b: b.peakViewersOnServer || null, show: num, win: "mehr" },
    { key: "streamOnServer", label: "Stream-Zeit", icon: "video", a: a.streamOnServerSeconds || null, b: b.streamOnServerSeconds || null, show: duration, win: "mehr" },
  ];


  const trackerRows: CompareRow[] = [
    { key: "sessions", label: "Sessions", icon: "login", a: a.sessions, b: b.sessions, show: num, win: "mehr" },
    { key: "online", label: "Online-Zeit (Tracker)", icon: "clock", a: onlineA, b: onlineB, show: duration, win: "mehr" },
    { key: "longest", label: "Längste Session", icon: "hourglass", a: a.longestSession || null, b: b.longestSession || null, show: duration, win: "mehr" },
    { key: "afkShare", label: "AFK-Anteil", icon: "moon", a: onlineA > 0 ? spanSeconds(afkA) / onlineA : null, b: onlineB > 0 ? spanSeconds(afkB) / onlineB : null, show: ratio, win: "weniger", hint: "Anteil der Online-Zeit, in der der Spieler als AFK galt" },
    { key: "advancements", label: "Fortschritte", icon: "star", a: adv.countA || null, b: adv.countB || null, show: num, win: "mehr" },
  ];

  const groups: CompareGroup[] = [
    { key: "server", label: "Server-Statistik", rows: board },
    { key: "mehr", label: "Mehr Statistik", rows: extra },
    { key: "twitch", label: "Twitch", rows: twitchRows },
    { key: "tracker", label: "Vom Tracker gemessen", rows: trackerRows },
  ].filter((g) => g.rows.length > 0);

  const strength = strengthBoard(state.players, now);
  const rhythmA = rhythms.get(idA) ?? null;
  const rhythmB = rhythms.get(idB) ?? null;
  let hourSimilarity: number | null = null;
  if (rhythmA && rhythmB && rhythmA.minutes > 0 && rhythmB.minutes > 0) {
    const sa = rhythmA.hours.reduce((s, v) => s + v, 0);
    const sb = rhythmB.hours.reduce((s, v) => s + v, 0);
    hourSimilarity = rhythmA.hours.reduce((s, v, h) => s + Math.min(v / sa, rhythmB.hours[h] / sb), 0);
  }

  const overA = overlapsFor(idA, sessions, now);
  const overB = overlapsFor(idB, sessions, now);
  const iA = overA.findIndex((o) => o.player === idB);
  const iB = overB.findIndex((o) => o.player === idA);
  const both = iA >= 0 ? overA[iA] : null;
  const together = {
    seconds: both?.seconds ?? 0,
    sessions: both?.sessions ?? 0,
    now: both?.now ?? false,
    placeInA: iA >= 0 ? iA + 1 : null,
    placeInB: iB >= 0 ? iB + 1 : null,
    shareA: onlineA > 0 && both ? both.seconds / onlineA : 0,
    shareB: onlineB > 0 && both ? both.seconds / onlineB : 0,
  };

  // Zählwerte des Paares aus Sicht a → b (Kanten sind alphabetisch sortiert)
  const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
  const edge = net.edges.find((e) => e.a === lo && e.b === hi);
  let link = edge ? { ...edge } : emptyLink(lo, hi);
  if (link.a !== idA)
    link = { ...link, a: idA, b: idB, raidsAB: link.raidsBA, raidsBA: link.raidsAB, msgsAB: link.msgsBA, msgsBA: link.msgsAB, titleAB: link.titleBA, titleBA: link.titleAB };

  const between: TrackerEvent[] = [];
  const counts = new Map<string, PairEvent>();
  for (const e of events) {
    const p = pairIds(e);
    if (!p) continue;
    const from: Side | null = p.giver === idA && p.receiver === idB ? "a" : p.giver === idB && p.receiver === idA ? "b" : null;
    if (!from) continue;
    between.push(e);
    const k = `${e.type}|${from}`;
    const c = counts.get(k) ?? { type: e.type, from, count: 0 };
    c.count += e.type === "subscription_gift" ? Math.max(1, Number(e.delta ?? 1) || 1) : 1;
    counts.set(k, c);
  }

  const base: Omit<CompareData, "insights"> = {
    a,
    b,
    now,
    hoursA: playA / 3600,
    hoursB: playB / 3600,
    groups,
    strengthA: strength.find((s) => s.id === idA) ?? null,
    strengthB: strength.find((s) => s.id === idB) ?? null,
    strengthOf: strength.length,
    rhythmA,
    rhythmB,
    hourSimilarity,
    together,
    link,
    net: netCompare(net, idA, idB),
    viewers,
    adv,
    pairEvents: [...counts.values()],
    recent: newestFirst(between, 20),
  };
  return { ...base, insights: findInsights(base, (id) => state.players[id]?.name ?? id) };
}

/** Neueste zuerst; Raids, Kills und Geschenke vollständig, Chat-Nachrichten nur die neuesten `chats` */
function newestFirst(events: TrackerEvent[], chats: number): TrackerEvent[] {
  const out: TrackerEvent[] = [];
  let n = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "chat" && ++n > chats) continue;
    out.push(events[i]);
  }
  return out;
}

/** Einstieg: stärkste Spieler und die engsten Paare im Netz */
export async function startData(limit = 8): Promise<{ pairs: { a: string; b: string; points: number }[]; strongest: Strength[]; of: number }> {
  const [{ state, now }, net] = await Promise.all([loadTracker(), getNetworkSummary()]);
  // Beide Richtungen eines Paares zusammen
  const sum = new Map<string, number>();
  for (const [x, m] of net.out) for (const [y, w] of m) sum.set(x < y ? `${x}|${y}` : `${y}|${x}`, (sum.get(x < y ? `${x}|${y}` : `${y}|${x}`) ?? 0) + w);
  const pairs = [...sum].map(([k, points]) => {
    const [a, b] = k.split("|");
    return { a, b, points };
  });
  const strongest = strengthBoard(state.players, now);
  return { pairs: pairs.sort((p, q) => q.points - p.points).slice(0, limit), strongest: strongest.slice(0, 10), of: strongest.length };
}
