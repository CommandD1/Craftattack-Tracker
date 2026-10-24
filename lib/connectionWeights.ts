/**
 * Gewichtung der Verbindungen auf /verbindungen. Ohne `server-only`: Die Seite liefert nur die Zählwerte,
 * Punkte und Farbe rechnet der Browser mit den Faktoren, die der Besucher einstellt.
 */

export type LinkKind = "raid" | "shared" | "msgs";
export type Weights = Record<LinkKind, number>;

/** Zählwerte einer Verbindung zweier Spieler, ohne Gewicht */
export interface LinkCounts {
  /** IDs, alphabetisch sortiert (a < b) */
  a: string;
  b: string;
  /** Raids von a nach b */
  raidsAB: number;
  /** Raids von b nach a */
  raidsBA: number;
  /** Geteilte Chats (Stream Together), an denen beide beteiligt waren */
  chats: number;
  /** Gemeinsame Zeit im geteilten Chat in Sekunden */
  chatSeconds: number;
  /** Nachrichten von a im Chat von b */
  msgsAB: number;
  /** Nachrichten von b im Chat von a */
  msgsBA: number;
  /** Gerade im geteilten Chat verbunden */
  now: boolean;
}

/** Punkte je Raid, je geteiltem Chat und je Chat-Nachricht bei Faktor 1 (10 Nachrichten = 1 Punkt) */
export const BASE_POINTS: Weights = { raid: 1, shared: 1, msgs: 0.1 };
export const DEFAULT_WEIGHTS: Weights = { raid: 1, shared: 1, msgs: 1 };
export const LINK_KINDS: LinkKind[] = ["raid", "shared", "msgs"];

/** Punkte einer Verbindung je Art, mit den Faktoren `w` */
export function linkPoints(e: LinkCounts, w: Weights): Weights {
  return {
    raid: (e.raidsAB + e.raidsBA) * BASE_POINTS.raid * w.raid,
    shared: e.chats * BASE_POINTS.shared * w.shared,
    msgs: (e.msgsAB + e.msgsBA) * BASE_POINTS.msgs * w.msgs,
  };
}

/** Gesamtgewicht und die Art, die am meisten beiträgt (bestimmt die Linienfarbe) */
export function weigh(e: LinkCounts, w: Weights): { weight: number; kind: LinkKind } {
  const p = linkPoints(e, w);
  const kind = LINK_KINDS.reduce((best, k) => (p[k] > p[best] ? k : best), "raid" as LinkKind);
  return { weight: p.raid + p.shared + p.msgs, kind };
}
