/**
 * Auswertung der erkannten Gruppen (siehe detectGroups in lib/network.ts): Anführer, Kern, Rand und warum jemand
 * dazugehört. Ohne `server-only`, läuft auf Server und im Browser.
 *
 * - Anführer: wer innerhalb der Gruppe die meiste Aufmerksamkeit bekommt (PageRank über die gerichteten
 *   Verbindungen: geraidet werden, Nachrichten im eigenen Chat, geteilter Chat). Aufmerksamkeit von gut vernetzten
 *   Mitgliedern zählt mehr.
 * - Zugehörigkeit: Anteil der eigenen Verbindungsstärke, der innerhalb der Gruppe bleibt.
 * - Kern: hohe Zugehörigkeit und stark verbunden; Rand: geringe Zugehörigkeit oder fast genauso stark mit einer
 *   anderen Gruppe verbunden.
 */
import { DEFAULT_WEIGHTS, type LinkCounts, type Weights } from "./connectionWeights";
import { detectGroups, directed, GROUP_COLORS } from "./network";

export type Role = "anfuehrer" | "kern" | "mitglied" | "rand";

export interface Reason {
  other: string;
  /** Punkte dieser Verbindung (beide Richtungen) */
  weight: number;
  raidsOut: number;
  raidsIn: number;
  msgsOut: number;
  msgsIn: number;
  chats: number;
  chatSeconds: number;
}

export interface Member {
  id: string;
  role: Role;
  /** Stärke innerhalb der Gruppe (beide Richtungen) */
  inner: number;
  /** Gesamte Stärke */
  total: number;
  /** inner / total */
  belonging: number;
  /** Anteile je Gruppe (Gruppen-Nummer → Anteil an total) */
  shares: Map<number, number>;
  /** Stärkste andere Gruppe */
  alt: { group: number; share: number } | null;
  /** PageRank innerhalb der Gruppe (Summe 1) */
  rank: number;
  /** Aufmerksamkeit, die er innerhalb der Gruppe bekommt bzw. gibt */
  received: number;
  given: number;
  /** Direkt verbundene Mitglieder */
  links: number;
  /** Stärkste Verbindungen in der Gruppe */
  reasons: Reason[];
  /** Warum am Rand: kaum verbunden oder fast genauso mit einer anderen Gruppe */
  edge?: "schwach" | "zwischen";
}

export interface Group {
  index: number;
  color: string;
  leader: string;
  members: Member[];
  /** Anteil der Verbindungsstärke aller Mitglieder, der in der Gruppe bleibt */
  cohesion: number;
  /** Anteil der möglichen Paare, die direkt verbunden sind */
  density: number;
  /** Verbindungen zu anderen Gruppen, stärkste zuerst, mit den stärksten Brücken */
  neighbours: { group: number; weight: number; bridges: { a: string; b: string; weight: number }[] }[];
  /** Summen der Arten innerhalb der Gruppe */
  inside: { raids: number; msgs: number; chats: number };
}

export interface GroupAnalysis {
  groups: Group[];
  groupOf: Map<string, number>;
  /** Gerichtete Verbindungen innerhalb von Gruppen (für die Matrix): `${a}|${b}` → Zählwerte aus Sicht a → b */
  pairs: Map<string, Reason>;
}

function reasonFor(e: LinkCounts, self: string, weight: number): Reason {
  const mine = e.a === self;
  return {
    other: mine ? e.b : e.a,
    weight,
    raidsOut: mine ? e.raidsAB : e.raidsBA,
    raidsIn: mine ? e.raidsBA : e.raidsAB,
    msgsOut: mine ? e.msgsAB : e.msgsBA,
    msgsIn: mine ? e.msgsBA : e.msgsAB,
    chats: e.chats,
    chatSeconds: e.chatSeconds,
  };
}

/** PageRank über gerichtete, gewichtete Kanten (u → v = u schenkt v Aufmerksamkeit) */
function pageRank(ids: string[], out: Map<string, Map<string, number>>, damping = 0.85): Map<string, number> {
  const n = ids.length;
  let pr = new Map(ids.map((id) => [id, 1 / n]));
  for (let it = 0; it < 60; it++) {
    const next = new Map(ids.map((id) => [id, (1 - damping) / n]));
    let sink = 0;
    for (const u of ids) {
      const m = out.get(u);
      const sum = m ? [...m.values()].reduce((s, v) => s + v, 0) : 0;
      if (!sum) {
        sink += pr.get(u)!;
        continue;
      }
      for (const [v, w] of m!) next.set(v, next.get(v)! + (damping * pr.get(u)! * w) / sum);
    }
    for (const id of ids) next.set(id, next.get(id)! + (damping * sink) / n);
    pr = next;
  }
  return pr;
}

export function analyzeGroups(edges: LinkCounts[], w: Weights = DEFAULT_WEIGHTS, resolution = 1): GroupAnalysis {
  const groupOf = detectGroups(edges, w, resolution);
  const total = new Map<string, number>();
  const sharesOf = new Map<string, Map<number, number>>();
  const reasons = new Map<string, Reason[]>();
  const innerOut = new Map<number, Map<string, Map<string, number>>>();
  const pairs = new Map<string, Reason>();
  const between = new Map<string, { weight: number; bridges: { a: string; b: string; weight: number }[] }>();
  const inside = new Map<number, { raids: number; msgs: number; chats: number }>();

  for (const e of edges) {
    const { ab, ba } = directed(e, w);
    const s = ab + ba;
    if (s <= 0) continue;
    const ga = groupOf.get(e.a)!;
    const gb = groupOf.get(e.b)!;
    for (const [id, g] of [
      [e.a, gb],
      [e.b, ga],
    ] as const) {
      total.set(id, (total.get(id) ?? 0) + s);
      const m = sharesOf.get(id) ?? sharesOf.set(id, new Map()).get(id)!;
      m.set(g, (m.get(g) ?? 0) + s);
    }
    if (ga === gb) {
      for (const id of [e.a, e.b]) (reasons.get(id) ?? reasons.set(id, []).get(id)!).push(reasonFor(e, id, s));
      const g = innerOut.get(ga) ?? innerOut.set(ga, new Map()).get(ga)!;
      const put = (x: string, y: string, v: number) => v > 0 && (g.get(x) ?? g.set(x, new Map()).get(x)!).set(y, v);
      put(e.a, e.b, ab);
      put(e.b, e.a, ba);
      pairs.set(`${e.a}|${e.b}`, reasonFor(e, e.a, ab));
      pairs.set(`${e.b}|${e.a}`, reasonFor(e, e.b, ba));
      const t = inside.get(ga) ?? inside.set(ga, { raids: 0, msgs: 0, chats: 0 }).get(ga)!;
      t.raids += e.raidsAB + e.raidsBA;
      t.msgs += e.msgsAB + e.msgsBA;
      t.chats += e.chats;
    } else {
      for (const [x, y, a, b] of [
        [ga, gb, e.a, e.b],
        [gb, ga, e.b, e.a],
      ] as const) {
        const k = `${x}|${y}`;
        const v = between.get(k) ?? between.set(k, { weight: 0, bridges: [] }).get(k)!;
        v.weight += s;
        v.bridges.push({ a, b, weight: s });
      }
    }
  }

  const byGroup = new Map<number, string[]>();
  for (const [id, g] of groupOf) (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(id);

  const groups: Group[] = [];
  for (const [index, ids] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
    const out = innerOut.get(index) ?? new Map();
    const pr = pageRank(ids, out);
    const received = new Map<string, number>();
    const given = new Map<string, number>();
    for (const [u, m] of out) for (const [v, x] of m) {
      given.set(u, (given.get(u) ?? 0) + x);
      received.set(v, (received.get(v) ?? 0) + x);
    }
    const members: Member[] = ids.map((id) => {
      const shares = new Map([...(sharesOf.get(id) ?? new Map())].map(([g, v]) => [g, v / (total.get(id) || 1)]));
      const inner = (sharesOf.get(id)?.get(index) ?? 0);
      const alt = [...shares].filter(([g]) => g !== index).sort((a, b) => b[1] - a[1])[0];
      const rs = (reasons.get(id) ?? []).sort((a, b) => b.weight - a.weight);
      return {
        id,
        role: "mitglied",
        inner,
        total: total.get(id) ?? 0,
        belonging: shares.get(index) ?? 0,
        shares,
        alt: alt ? { group: alt[0], share: alt[1] } : null,
        rank: pr.get(id) ?? 0,
        received: received.get(id) ?? 0,
        given: given.get(id) ?? 0,
        links: rs.length,
        reasons: rs.slice(0, 5),
      };
    });
    members.sort((a, b) => b.rank - a.rank);
    const leader = members[0].id;
    members[0].role = "anfuehrer";
    // Kern: hohe Zugehörigkeit und überdurchschnittlich stark in der Gruppe verbunden
    const innerSorted = members.map((m) => m.inner).sort((a, b) => a - b);
    const medianInner = innerSorted[Math.floor(innerSorted.length / 2)] ?? 0;
    const coreMax = Math.max(2, Math.ceil(members.length * 0.3));
    let cores = 0;
    for (const m of [...members].sort((a, b) => b.inner * b.belonging - a.inner * a.belonging)) {
      if (m.role === "anfuehrer") continue;
      const between = m.belonging < 0.45 || Boolean(m.alt && m.alt.share >= m.belonging * 0.7);
      const weak = m.inner < medianInner * 0.15;
      if (between || weak) {
        m.role = "rand";
        m.edge = between ? "zwischen" : "schwach";
      }
      else if (cores < coreMax && m.belonging >= 0.6 && m.inner >= medianInner) {
        m.role = "kern";
        cores++;
      }
    }
    const sumTotal = members.reduce((s, m) => s + m.total, 0);
    const sumInner = members.reduce((s, m) => s + m.inner, 0);
    const neighbours = [...between.entries()]
      .filter(([k]) => Number(k.split("|")[0]) === index)
      .map(([k, v]) => ({ group: Number(k.split("|")[1]), weight: v.weight, bridges: v.bridges.sort((a, b) => b.weight - a.weight).slice(0, 4) }))
      .sort((a, b) => b.weight - a.weight);
    const possible = (members.length * (members.length - 1)) / 2;
    groups.push({
      index,
      color: GROUP_COLORS[index % GROUP_COLORS.length],
      leader,
      members,
      cohesion: sumTotal ? sumInner / sumTotal : 0,
      density: possible ? members.reduce((s, m) => s + m.links, 0) / 2 / possible : 0,
      neighbours,
      inside: inside.get(index) ?? { raids: 0, msgs: 0, chats: 0 },
    });
  }
  return { groups, groupOf, pairs };
}

export const ROLE_LABEL: Record<Role, string> = { anfuehrer: "Anführer", kern: "Kern", mitglied: "Mitglied", rand: "Rand" };
export const ROLE_TONE: Record<Role, string> = { anfuehrer: "gold", kern: "grass", mitglied: "white", rand: "paper" };

/** Kurzer Satz zu einer Verbindung, z. B. „raidet ihn 3× · 120 Nachr. bei ihm · 2× geteilter Chat“ */
export function reasonText(r: Reason): string {
  const n = (v: number) => v.toLocaleString("de-DE");
  const parts: string[] = [];
  if (r.raidsOut) parts.push(`raidet ${n(r.raidsOut)}×`);
  if (r.raidsIn) parts.push(`wird ${n(r.raidsIn)}× geraidet`);
  if (r.msgsOut) parts.push(`${n(r.msgsOut)} Nachr. bei ihm`);
  if (r.msgsIn) parts.push(`${n(r.msgsIn)} Nachr. von ihm`);
  if (r.chats) parts.push(`${n(r.chats)}× geteilter Chat`);
  return parts.join(" · ");
}
