/**
 * Wann war wer auf dem Server? Aus den Sessions (Join/Leave) ein Index für „online zu diesem Zeitpunkt“ und
 * „Abschnitte, in denen mindestens einer von zweien online war“. Ohne `server-only`, nur Rechnen.
 * In Tracker-Lücken gibt es keine Sessions: dort gilt niemand als online.
 */

export interface SessionLike {
  player: string;
  start: string;
  end: string | null;
}

export interface OnlineIndex {
  /** War `id` zum Zeitpunkt `t` (ms) auf dem Server? */
  at(id: string, t: number): boolean;
  /** Abschnitte in [from, to], in denen `a` oder `b` online war (sortiert, ohne Überlappung) */
  either(a: string, b: string, from: number, to: number): [number, number][];
  /** Abschnitte in [from, to], in denen `a` und `b` gleichzeitig online waren */
  both(a: string, b: string, from: number, to: number): [number, number][];
}

/**
 * Filter „CraftAttack / Alles“ der Community-Seiten: `einer` (Standard, „CraftAttack“) = nur, während mindestens einer
 * der beiden auf dem Server war, `beide` = nur, während beide gleichzeitig online waren, `alle` = alle Twitch-Daten.
 */
export type CaMode = "alle" | "einer" | "beide";
export const CA_MODES: CaMode[] = ["einer", "beide", "alle"];
export const CA_DEFAULT: CaMode = "einer";
/** Adress-Parameter `?ca=alle|beide`; ohne Angabe CraftAttack (`einer`, früher `?ca=einer` bzw. `?server=1`) */
export function caModeOf(sp: Record<string, string | string[] | undefined>): CaMode {
  const v = sp.ca;
  return v === "alle" || v === "beide" ? v : CA_DEFAULT;
}
/** Wert für `?ca=` in Links; leer beim Standard */
export const caParam = (m: CaMode) => (m === CA_DEFAULT ? "" : m);
export const CA_LABEL: Record<CaMode, string> = { einer: "CraftAttack", beide: "Beide auf CraftAttack", alle: "Alles" };
export const CA_HINT: Record<CaMode, string> = {
  einer: "Nur, während mindestens einer der beiden auf CraftAttack online war",
  beide: "Nur, während beide gleichzeitig auf CraftAttack online waren",
  alle: "Alles von Twitch, auch wenn gerade niemand auf CraftAttack war",
};

/** Prüft je Paar und Zeitpunkt (ms), ob es im Modus zählt; `null` bei `alle` */
export function caPairTest(online: OnlineIndex | null, mode: CaMode): ((a: string, b: string, t: number) => boolean) | null {
  if (!online || mode === "alle") return null;
  return mode === "beide" ? (a, b, t) => online.at(a, t) && online.at(b, t) : (a, b, t) => online.at(a, t) || online.at(b, t);
}
/** Abschnitte je Paar im Modus (bei `alle` der ganze Zeitraum) */
export function caSpans(online: OnlineIndex | null, mode: CaMode, a: string, b: string, from: number, to: number): [number, number][] {
  if (!online || mode === "alle") return [[from, to]];
  return mode === "beide" ? online.both(a, b, from, to) : online.either(a, b, from, to);
}

/** Sortierte, zusammengelegte Abschnitte */
function merge(spans: [number, number][]): [number, number][] {
  spans.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    if (b <= a) continue;
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function onlineIndex(sessions: SessionLike[], now: number): OnlineIndex {
  const raw = new Map<string, [number, number][]>();
  for (const s of sessions) {
    const a = Date.parse(s.start);
    const b = s.end ? Date.parse(s.end) : now;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    (raw.get(s.player) ?? raw.set(s.player, []).get(s.player)!).push([a, b]);
  }
  const spans = new Map([...raw].map(([id, list]) => [id, merge(list)]));
  const clip = (id: string, from: number, to: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [a, b] of spans.get(id) ?? []) {
      if (b <= from) continue;
      if (a >= to) break;
      out.push([Math.max(a, from), Math.min(b, to)]);
    }
    return out;
  };
  return {
    at(id, t) {
      const list = spans.get(id);
      if (!list) return false;
      // Binäre Suche: letzter Abschnitt, der vor oder bei t beginnt
      let lo = 0;
      let hi = list.length - 1;
      let hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid][0] <= t) {
          hit = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return hit >= 0 && t < list[hit][1];
    },
    either(a, b, from, to) {
      return merge([...clip(a, from, to), ...clip(b, from, to)]);
    },
    both(a, b, from, to) {
      const x = clip(a, from, to);
      const y = clip(b, from, to);
      const out: [number, number][] = [];
      for (let i = 0, j = 0; i < x.length && j < y.length; ) {
        const lo = Math.max(x[i][0], y[j][0]);
        const hi = Math.min(x[i][1], y[j][1]);
        if (hi > lo) out.push([lo, hi]);
        if (x[i][1] < y[j][1]) i++;
        else j++;
      }
      return out;
    },
  };
}
