import "server-only";
import { berlinDay } from "./berlin";
import { getConnections } from "./connections";
import { DEFAULT_WEIGHTS } from "./connectionWeights";
import { getDb } from "./db";
import { analyzeGroups } from "./groups";
import { adjacency, distancesFrom } from "./network";
import { snapshot } from "./snapshots";

/**
 * Raid-Auswertung (Vorschau /vorschau/<key>/raids): wer raidet, wer wird geraidet – nach Anzahl und Zuschauern, fair
 * gemessen an den Gelegenheiten. Für jeden Raid gelten die erfassten Spieler als mögliche Ziele, die in diesem
 * Moment live waren (aus Stream-Start/-Ende). Daraus:
 * - Erwartet (Empfänger): Summe über alle Raids, bei denen er live war, von 1 / Zahl der möglichen Ziele; Faktor
 *   = bekommen ÷ erwartet („Raid-Magnet“). Ebenso nach Zuschauern.
 * - Gelegenheiten (Gebender): Stream-Enden, bei denen mindestens ein anderer erfasster Spieler live war.
 * - Gruppe und Abstand aus dem Netz OHNE Raids (geteilte Chats, Titel, Nachrichten), damit Raids sich nicht selbst
 *   „in die Gruppe“ ziehen; verglichen mit einem zufälligen Raid an die gerade Live-Spieler.
 * - Tageszeit (Berlin): Raids je Stunde und Rate = Raids ÷ Stream-Enden mit Gelegenheit.
 */

export interface RaidPlayer {
  id: string;
  given: number;
  givenViewers: number;
  /** Raids an nicht erfasste Kanäle */
  givenExternal: number;
  received: number;
  receivedViewers: number;
  /** Erwartete Raids bzw. Zuschauer bei zufälliger Wahl unter den Live-Spielern */
  expected: number;
  expectedViewers: number;
  /** Stream-Enden mit mindestens einem anderen erfassten Spieler live */
  opportunities: number;
  /** Gegebene Raids an erfasste Spieler: in der eigenen Gruppe, Abstand in Schritten (0 = nicht verbunden) */
  givenInGroup: number;
  givenHops: number[];
  receivedInGroup: number;
  group: number | null;
}

export interface RaidAnalysis {
  at: number;
  total: number;
  tracked: number;
  viewers: number;
  /** Raids an erfasste Spieler in der Gruppe des Gebenden: tatsächlich und erwartet (zufällig unter Live-Spielern) */
  inGroup: { actual: number; expected: number; known: number };
  /** Abstand im Netz ohne Raids: 1 = direkt verbunden, 2, 3+, 0 = nicht verbunden */
  hops: { key: string; label: string; actual: number; expected: number }[];
  /** Je Stunde (Berlin): Raids in die Gruppe, aus der Gruppe heraus, an nicht erfasste, und Stream-Enden mit Gelegenheit */
  hours: { h: number; inGroup: number; outGroup: number; external: number; viewers: number; ends: number }[];
  players: RaidPlayer[];
  /** [Gebender, Bekommender, Anzahl, neuester Raid] */
  pairs: [string, string, number, string][];
  /** Gruppe → [Anführer, Mitglieder] */
  groups: { index: number; leader: string; color: string; size: number }[];
  days: number;
}

const hourFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" });
const hourOf = (ms: number) => Number(hourFmt.formatToParts(ms).find((p) => p.type === "hour")?.value ?? 0);
const HOP_KEYS = [
  { key: "1", label: "direkt verbunden" },
  { key: "2", label: "2 Schritte" },
  { key: "3", label: "3+ Schritte" },
  { key: "0", label: "nicht verbunden" },
];
const hopKey = (hops: number | undefined) => (hops === undefined ? "0" : hops <= 1 ? "1" : hops === 2 ? "2" : "3");

/** Vorberechnet vom Tracker (lib/snapshotJobs.ts), die Website liest nur das Ergebnis */
export const RAID_SNAPSHOT_MS = 10 * 60_000;
export async function getRaidAnalysis(): Promise<RaidAnalysis> {
  return (await snapshot("raid-analysis", computeRaidAnalysis, RAID_SNAPSHOT_MS)).value;
}

async function computeRaidAnalysis(): Promise<RaidAnalysis> {
  const db = await getDb();
  const [raidRows, streamRows, edges] = await Promise.all([
    db.query<{ id: string; at: Date; player: string; target: string | null; viewers: number | null }>(
      `SELECT id, at, player, meta->>'raidTargetPlayerId' AS target, value AS viewers FROM events WHERE type = 'raid' AND player IS NOT NULL ORDER BY at`,
    ),
    db.query<{ player: string; at: Date; type: string }>(
      `SELECT player, at, type FROM events WHERE type IN ('stream_start', 'stream_end') AND player IS NOT NULL ORDER BY player, at`,
    ),
    getConnections(null),
  ]);

  // Live-Abschnitte je Spieler aus Start/Ende (offene: bis jetzt)
  const now = Date.now();
  const live = new Map<string, [number, number][]>();
  const ends: { player: string; at: number }[] = [];
  let open: { player: string; at: number } | null = null;
  for (const r of streamRows.rows) {
    const t = r.at.getTime();
    if (open && open.player !== r.player) {
      live.get(open.player)!.push([open.at, now]);
      open = null;
    }
    if (!live.has(r.player)) live.set(r.player, []);
    if (r.type === "stream_start") {
      if (open) live.get(r.player)!.push([open.at, t]);
      open = { player: r.player, at: t };
    } else {
      if (open) live.get(r.player)!.push([open.at, t]);
      open = null;
      ends.push({ player: r.player, at: t });
    }
  }
  if (open) live.get(open.player)!.push([open.at, now]);
  /** Wer zu `t` live war (ohne `except`); kleine Toleranz, weil der Raid kurz vor dem eigenen Ende kommt */
  const liveAt = (t: number, except: string) => {
    const out: string[] = [];
    for (const [pid, spans] of live) {
      if (pid === except) continue;
      if (spans.some(([a, b]) => a <= t + 60_000 && b >= t - 60_000)) out.push(pid);
    }
    return out;
  };

  // Gruppen und Abstände im Netz ohne Raids
  const noRaid = { ...DEFAULT_WEIGHTS, raid: 0 };
  const analysis = analyzeGroups(edges, noRaid);
  const groupOf = analysis.groupOf;
  const out = adjacency(edges, noRaid);
  const hopsCache = new Map<string, Map<string, number>>();
  const hopsFrom = (a: string) => {
    let m = hopsCache.get(a);
    if (!m) {
      m = new Map([...distancesFrom(a, out, "gegenseitig")].map(([id, r]) => [id, r.hops]));
      hopsCache.set(a, m);
    }
    return m;
  };

  const players = new Map<string, RaidPlayer>();
  const P = (id: string): RaidPlayer => {
    let p = players.get(id);
    if (!p) {
      p = {
        id,
        given: 0,
        givenViewers: 0,
        givenExternal: 0,
        received: 0,
        receivedViewers: 0,
        expected: 0,
        expectedViewers: 0,
        opportunities: 0,
        givenInGroup: 0,
        givenHops: [0, 0, 0, 0],
        receivedInGroup: 0,
        group: groupOf.get(id) ?? null,
      };
      players.set(id, p);
    }
    return p;
  };
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, inGroup: 0, outGroup: 0, external: 0, viewers: 0, ends: 0 }));
  const hopCount = new Map(HOP_KEYS.map((k) => [k.key, { actual: 0, expected: 0 }]));
  const inGroup = { actual: 0, expected: 0, known: 0 };
  const pairs = new Map<string, [string, string, number, string]>();
  let tracked = 0;
  let viewers = 0;
  const days = new Set<string>();

  for (const r of raidRows.rows) {
    const t = r.at.getTime();
    const v = Number(r.viewers ?? 0);
    const g = P(r.player);
    const h = hours[hourOf(t)];
    days.add(berlinDay(t));
    g.given++;
    g.givenViewers += v;
    viewers += v;
    h.viewers += v;
    const cands = liveAt(t, r.player);
    // Erwartung: jeder Live-Spieler hätte das Ziel sein können
    for (const c of cands) {
      const cp = P(c);
      cp.expected += 1 / cands.length;
      cp.expectedViewers += v / cands.length;
    }
    if (!r.target || !live.has(r.target) || r.target === r.player) {
      g.givenExternal++;
      h.external++;
      continue;
    }
    tracked++;
    const rec = P(r.target);
    rec.received++;
    rec.receivedViewers += v;
    const k = `${r.player}|${r.target}`;
    const pair = pairs.get(k) ?? [r.player, r.target, 0, r.id];
    pair[2]++;
    pair[3] = r.id;
    pairs.set(k, pair);
    // Gruppe und Abstand: tatsächlich vs. zufälliges Live-Ziel
    const gg = groupOf.get(r.player);
    const same = gg !== undefined && groupOf.get(r.target) === gg;
    if (same) {
      g.givenInGroup++;
      rec.receivedInGroup++;
      h.inGroup++;
    } else h.outGroup++;
    if (gg !== undefined && cands.length) {
      inGroup.known++;
      if (same) inGroup.actual++;
      inGroup.expected += cands.filter((c) => groupOf.get(c) === gg).length / cands.length;
    }
    const hm = hopsFrom(r.player);
    const hk = hopKey(hm.get(r.target));
    g.givenHops[Number(hk)]++;
    hopCount.get(hk)!.actual++;
    if (cands.length) for (const c of cands) hopCount.get(hopKey(hm.get(c)))!.expected += 1 / cands.length;
  }
  // Gelegenheiten: Stream-Enden, bei denen jemand anderes live war
  for (const e of ends) {
    if (!liveAt(e.at, e.player).length) continue;
    P(e.player).opportunities++;
    hours[hourOf(e.at)].ends++;
  }

  return {
    at: now,
    total: raidRows.rows.length,
    tracked,
    viewers,
    inGroup,
    hops: HOP_KEYS.map((k) => ({ ...k, ...hopCount.get(k.key)! })),
    hours,
    players: [...players.values()].filter((p) => p.given || p.received || p.expected > 0.05),
    pairs: [...pairs.values()],
    groups: analysis.groups.map((x) => ({ index: x.index, leader: x.leader, color: x.color, size: x.members.length })),
    days: days.size,
  };
}
