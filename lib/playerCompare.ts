import "server-only";
import { loadTracker } from "./data";
import { getAllSessions, getTwitchCheerProfile, getTwitchSubscriptionProfile } from "./store";
import { getPlayerEarnings } from "./earnings";
import { getRhythms, type Rhythm } from "./rhythm";
import { getNetworkSummary } from "./networkSummary";
import { distancesFrom } from "./network";
import { emptyLink, type LinkCounts } from "./connectionWeights";
import { overlapsFor } from "./overlap";
import { pairIds } from "./eventPair";
import { playtimeOf, trackedSecondsOf } from "./playtime";
import { getPlayerAfkSpans, spanSeconds } from "./analytics";
import { BOARD_KEYS, type BoardKey, type PlayerState, type TrackerEvent } from "./types";
import { EXTRA_STATS, EXTRA_STAT_KEYS, FORMATTERS, type ExtraStatKey } from "./playerStats";
import { boardValue, duration, eur, num } from "./format";
import type { Metric } from "./graphQuery";

/**
 * Spielervergleich (Vorschau /vorschau/<key>/vergleich): zwei Spieler Kopf an Kopf – Statistiken, Rhythmus und was
 * sie miteinander verbindet. Alles aus vorhandenen Quellen (Tracker-Stand, Sessions, Rhythmus, Netz, Ereignisse),
 * nichts Neues gespeichert.
 */

export type Side = "a" | "b";

export interface CompareRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  /** Anzeige eines Werts */
  show: (v: number) => string;
  /** Platz in der Bestenliste, falls bekannt */
  rankA?: number | null;
  rankB?: number | null;
  /** Kennzahl im Graphen (beide Spieler) */
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

export interface CompareData {
  a: PlayerState;
  b: PlayerState;
  now: number;
  /** Spielzeit in Stunden (für „je Stunde“) */
  hoursA: number;
  hoursB: number;
  groups: CompareGroup[];
  rhythmA: Rhythm | null;
  rhythmB: Rhythm | null;
  /** Ähnlichkeit der Tagesprofile 0–1 (Überlappung der normierten Stunden-Verteilungen) */
  hourSimilarity: number | null;
  together: {
    seconds: number;
    sessions: number;
    now: boolean;
    /** Platz des anderen unter den Mitspielern (nach gemeinsamer Zeit) */
    placeInA: number | null;
    placeInB: number | null;
    /** Anteil der eigenen Online-Zeit, die der andere dabei war */
    shareA: number;
    shareB: number;
  };
  link: LinkCounts;
  /** Gleiche Gruppe im Netz? null = einer von beiden in keiner Gruppe */
  sameGroup: boolean | null;
  /** Schritte im Netz von a nach b (beide Richtungen), null = nicht verbunden */
  hops: number | null;
  path: string[];
  pairEvents: PairEvent[];
  /** Ereignisse zwischen beiden (neueste zuerst) */
  recent: TrackerEvent[];
}

const ratio = (v: number) => `${Math.round(v * 100)} %`;

export async function getComparison(idA: string, idB: string): Promise<CompareData | null> {
  const { state, events, now } = await loadTracker();
  const a = state.players[idA];
  const b = state.players[idB];
  if (!a || !b || idA === idB) return null;

  const [sessions, rhythms, net, subsA, subsB, bitsA, bitsB, earnA, earnB, afkA, afkB] = await Promise.all([
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
  ]);

  const playA = playtimeOf(a, now).seconds;
  const playB = playtimeOf(b, now).seconds;
  const onlineA = trackedSecondsOf(a, now);
  const onlineB = trackedSecondsOf(b, now);
  const afkShareA = onlineA > 0 ? spanSeconds(afkA) / onlineA : null;
  const afkShareB = onlineB > 0 ? spanSeconds(afkB) / onlineB : null;

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
  const boardRows: CompareRow[] = BOARD_KEYS.map((k) => ({
    key: k,
    label: BOARD_LABEL[k],
    a: k === "playtimeSeconds" ? playA || null : (a.stats[k] ?? null),
    b: k === "playtimeSeconds" ? playB || null : (b.stats[k] ?? null),
    show: (v: number) => boardValue(k, v),
    rankA: a.ranks?.[k]?.rank ?? null,
    rankB: b.ranks?.[k]?.rank ?? null,
    metric: k as Metric,
    perHour: k !== "playtimeSeconds",
  }));

  const extraOf = (p: PlayerState, k: ExtraStatKey) => {
    const v = p.detail?.stats[k];
    return typeof v === "number" ? v : null;
  };
  const extraRows: CompareRow[] = EXTRA_STAT_KEYS.filter((k) => extraOf(a, k) !== null || extraOf(b, k) !== null).map((k) => ({
    key: k,
    label: EXTRA_STATS[k].label,
    a: extraOf(a, k),
    b: extraOf(b, k),
    show: FORMATTERS[EXTRA_STATS[k].format],
    rankA: a.detail?.ranks[k]?.rank ?? null,
    rankB: b.detail?.ranks[k]?.rank ?? null,
    metric: EXTRA_STATS[k].metric as Metric,
    perHour: EXTRA_STATS[k].format !== "duration",
  }));

  const twitchRows: CompareRow[] = [
    { key: "followers", label: "Follower auf dem Server", a: a.followersAt ? a.followersOnServer : null, b: b.followersAt ? b.followersOnServer : null, show: num, metric: "followers" as Metric, hint: "Follower-Zuwachs, während der Streamer auf dem Server war" },
    { key: "twitchSubs", label: "Twitch Subs", a: subsA.total, b: subsB.total, show: num, metric: "twitchSubs" as Metric },
    { key: "twitchBits", label: "Twitch Bits", a: bitsA.onServer, b: bitsB.onServer, show: num, metric: "twitchBits" as Metric, hint: "Bits aus Cheers, während der Streamer auf dem Server war" },
    { key: "twitchEarnings", label: "Twitch-Einnahmen", a: earnA.total, b: earnB.total, show: eur, metric: "twitchEarnings" as Metric, hint: "Geschätzt aus Abos und Bits auf dem Server, ohne Werbung" },
    { key: "peakViewers", label: "Peak-Zuschauer", a: a.peakViewers || null, b: b.peakViewers || null, show: num },
    { key: "streamOnServer", label: "Stream auf dem Server", a: a.streamOnServerSeconds || null, b: b.streamOnServerSeconds || null, show: duration },
  ];

  const trackerRows: CompareRow[] = [
    { key: "sessions", label: "Sessions", a: a.sessions, b: b.sessions, show: num },
    { key: "online", label: "Online-Zeit (Tracker)", a: onlineA, b: onlineB, show: duration },
    { key: "longest", label: "Längste Session", a: a.longestSession || null, b: b.longestSession || null, show: duration },
    { key: "afkShare", label: "AFK-Anteil", a: afkShareA, b: afkShareB, show: ratio, hint: "Anteil der Online-Zeit, in der der Spieler als AFK galt" },
  ];

  const groups: CompareGroup[] = [
    { key: "server", label: "Server-Statistik", rows: boardRows },
    { key: "mehr", label: "Mehr Statistik", rows: extraRows },
    { key: "twitch", label: "Twitch", rows: twitchRows },
    { key: "tracker", label: "Vom Tracker gemessen", rows: trackerRows },
  ].filter((g) => g.rows.length > 0);

  // Rhythmus: Überlappung der normierten Tagesprofile
  const rhythmA = rhythms.get(idA) ?? null;
  const rhythmB = rhythms.get(idB) ?? null;
  let hourSimilarity: number | null = null;
  if (rhythmA && rhythmB && rhythmA.minutes > 0 && rhythmB.minutes > 0) {
    const sa = rhythmA.hours.reduce((s, v) => s + v, 0);
    const sb = rhythmB.hours.reduce((s, v) => s + v, 0);
    hourSimilarity = rhythmA.hours.reduce((s, v, h) => s + Math.min(v / sa, rhythmB.hours[h] / sb), 0);
  }

  // Gemeinsam online
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

  // Netz: Zählwerte des Paares aus Sicht a → b (Kanten sind alphabetisch sortiert)
  const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
  const edge = net.edges.find((e) => e.a === lo && e.b === hi);
  let link = edge ? { ...edge } : emptyLink(lo, hi);
  if (link.a !== idA) {
    link = {
      ...link,
      a: idA,
      b: idB,
      raidsAB: link.raidsBA,
      raidsBA: link.raidsAB,
      msgsAB: link.msgsBA,
      msgsBA: link.msgsAB,
      titleAB: link.titleBA,
      titleBA: link.titleAB,
    };
  }
  const gA = net.analysis.groupOf.get(idA);
  const gB = net.analysis.groupOf.get(idB);
  const sameGroup = gA === undefined || gB === undefined ? null : gA === gB;
  const reach = distancesFrom(idA, net.out, "gegenseitig").get(idB);

  // Ereignisse zwischen beiden (Raids, Tode durch den anderen, Abo-Geschenke, Chat-Nachrichten im Speicher)
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

  return {
    a,
    b,
    now,
    hoursA: playA / 3600,
    hoursB: playB / 3600,
    groups,
    rhythmA,
    rhythmB,
    hourSimilarity,
    together,
    link,
    sameGroup,
    hops: reach ? reach.hops : null,
    path: reach?.path ?? [],
    pairEvents: [...counts.values()],
    // Raids, Kills und Geschenke vollständig, Chat-Nachrichten nur die neuesten 20
    recent: newestFirst(between, 20),
  };
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

/** Paare für den Einstieg: stärkste Verbindungen im Netz */
export async function suggestedPairs(limit = 8): Promise<{ a: string; b: string; points: number }[]> {
  const net = await getNetworkSummary();
  const out: { a: string; b: string; points: number }[] = [];
  for (const [x, m] of net.out) for (const [y, w] of m) if (x < y) out.push({ a: x, b: y, points: w + (net.out.get(y)?.get(x) ?? 0) });
  return out.sort((p, q) => q.points - p.points).slice(0, limit);
}
