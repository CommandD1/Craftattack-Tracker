import "server-only";
import { connection } from "next/server";
import { getDb } from "./db";
import { getAllSessions, type StoredSession } from "./store";
import { getNetworkSummary } from "./networkSummary";
import { snapshot } from "./snapshots";
import { createSwrCache } from "./swrCache";
import type { LinkCounts } from "./connectionWeights";
import type { PlayerState } from "./types";

/**
 * „Gemeinsame Dritte“ im Spielervergleich: Wer oder was verbindet zwei Spieler über andere?
 *
 * - Kreis: Spieler, die beide raiden, die beide raiden, die bei beiden schreiben usw. Aus dem Netz (CraftAttack-
 *   Umfang wie auf der Seite Verbindungen) und aus „Gemeinsam streamen“ (costream_presence).
 * - Publikum: gemeinsame Abonnenten, Sub-Verschenker, Cheerer und Clipper. Nur Zahlen, Namen nur bei den größten
 *   Verschenkern (stehen bei Twitch ohnehin öffentlich im Chat). Die Überschneidung aller Kanalpaare rechnet der
 *   Tracker stündlich vor (ca. 10 s Datenbank), die Website liest nur das Ergebnis.
 * - Server: Wer ist am häufigsten online, während beide online sind.
 */

export interface ThirdRow {
  id: string;
  a: number;
  b: number;
}

export type CircleKey = "raidsIn" | "raidsOut" | "msgsIn" | "msgsOut" | "shared" | "costream" | "title";
export interface CircleList {
  key: CircleKey;
  /** Werte in Sekunden statt Anzahl */
  seconds: boolean;
  rows: ThirdRow[];
  /** Alle Treffer, `rows` sind die stärksten */
  count: number;
}

export type AudienceKind = "subs" | "gifts" | "cheers" | "clips";
export const AUDIENCE_KINDS: AudienceKind[] = ["subs", "gifts", "cheers", "clips"];

export interface AudienceRow {
  kind: AudienceKind;
  shared: number;
  a: number;
  b: number;
}

export interface Audience {
  rows: AudienceRow[];
  /** Gemeinsame Abonnenten im Verhältnis zur Größe beider (Ochiai, 0–1) */
  similarity: number | null;
  /** Platz des anderen unter den ähnlichsten Publikumen (nach Abonnenten) */
  placeA: number | null;
  placeB: number | null;
  /** Kanäle mit Abonnenten, unter denen der Platz gilt */
  of: number;
  /** Wer beiden die meisten Subs geschenkt hat (Twitch-Login, Anzahl je Seite) */
  gifters: { login: string; player: string | null; a: number; b: number }[];
  /** Stand der Vorberechnung (ms) */
  at: number;
}

export interface ServerThird {
  /** Gemeinsame Online-Zeit von beiden in Sekunden */
  both: number;
  /** Wer in dieser Zeit am längsten dabei war (Sekunden) */
  rows: { id: string; seconds: number }[];
}

export interface ThirdData {
  circle: CircleList[];
  audience: Audience | null;
  server: ServerThird;
}

const TOP = 8;

/* ------------------------------------------------------------------ Kreis */

/** Wert einer Kante in Richtung from → to */
function directed(e: LinkCounts, from: string, kind: "raids" | "msgs" | "title"): number {
  const ab = e.a === from;
  if (kind === "raids") return ab ? e.raidsAB : e.raidsBA;
  if (kind === "msgs") return ab ? e.msgsAB : e.msgsBA;
  return ab ? e.titleAB : e.titleBA;
}

function circleLists(edges: LinkCounts[], costream: Map<string, number>, idA: string, idB: string): CircleList[] {
  // Je Dritter: Werte gegenüber a und b
  const val = new Map<string, Record<CircleKey, [number, number]>>();
  const get = (x: string) => {
    let v = val.get(x);
    if (!v) {
      const z = (): [number, number] => [0, 0];
      v = {
        raidsIn: z(),
        raidsOut: z(),
        msgsIn: z(),
        msgsOut: z(),
        shared: z(),
        costream: z(),
        title: z(),
      };
      val.set(x, v);
    }
    return v;
  };
  for (const e of edges) {
    for (const [me, side] of [
      [idA, 0],
      [idB, 1],
    ] as const) {
      if (e.a !== me && e.b !== me) continue;
      const x = e.a === me ? e.b : e.a;
      if (x === idA || x === idB) continue;
      const v = get(x);
      v.raidsIn[side] += directed(e, x, "raids");
      v.raidsOut[side] += directed(e, me, "raids");
      v.msgsIn[side] += directed(e, x, "msgs");
      v.msgsOut[side] += directed(e, me, "msgs");
      v.title[side] += directed(e, me, "title");
      v.shared[side] += e.chatSeconds;
    }
  }
  for (const [k, s] of costream) {
    const [p, q] = k.split("|");
    for (const [me, side] of [
      [idA, 0],
      [idB, 1],
    ] as const) {
      const x = p === me ? q : q === me ? p : null;
      if (!x || x === idA || x === idB) continue;
      get(x).costream[side] += s;
    }
  }
  const keys: CircleKey[] = ["raidsIn", "raidsOut", "msgsIn", "msgsOut", "shared", "costream", "title"];
  return keys.map((key) => {
    const rows = [...val]
      .map(([id, v]) => ({ id, a: v[key][0], b: v[key][1] }))
      .filter((r) => r.a > 0 && r.b > 0)
      .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || y.a + y.b - (x.a + x.b));
    return {
      key,
      seconds: key === "shared" || key === "costream" || key === "title",
      rows: rows.slice(0, TOP),
      count: rows.length,
    };
  });
}

const swr = createSwrCache({ maxEntries: 32 });

/** „Gemeinsam streamen“: Sekunden je Spielerpaar (`a|b`, alphabetisch), aus den beobachteten Anwesenheiten */
async function costreamPairs(): Promise<Map<string, number>> {
  await connection();
  return swr("costream", 5 * 60_000, async () => {
    const db = await getDb();
    const rows = (
      await db.query<{ session_key: string; player: string; s: Date; e: Date }>(
        `SELECT session_key, player, started_at AS s, coalesce(ended_at, last_seen_at) AS e FROM costream_presence WHERE player IS NOT NULL`,
      )
    ).rows;
    const bySession = new Map<string, { player: string; s: number; e: number }[]>();
    for (const r of rows) {
      const list = bySession.get(r.session_key) ?? bySession.set(r.session_key, []).get(r.session_key)!;
      list.push({ player: r.player, s: r.s.getTime(), e: r.e.getTime() });
    }
    const out = new Map<string, number>();
    for (const list of bySession.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const p = list[i];
          const q = list[j];
          if (p.player === q.player) continue;
          const sec = (Math.min(p.e, q.e) - Math.max(p.s, q.s)) / 1000;
          if (sec <= 0) continue;
          const k = p.player < q.player ? `${p.player}|${q.player}` : `${q.player}|${p.player}`;
          out.set(k, (out.get(k) ?? 0) + sec);
        }
    return out;
  });
}

/* ------------------------------------------------------------------ Publikum */

interface AudienceSnapshot {
  /** Art → Kanal → Anzahl verschiedener Leute */
  totals: Record<AudienceKind, Record<string, number>>;
  /** Art → „a|b“ (alphabetisch) → gemeinsame Leute */
  pairs: Record<AudienceKind, Record<string, number>>;
}

/** Nur, solange der Streamer auf dem Server war (Spalte on_server) */
export const AUDIENCE_SNAPSHOT = "audience-overlap:server";
export const AUDIENCE_SNAPSHOT_MS = 60 * 60_000;

/** Eigene Abos (auch Weiterführen eines geschenkten); Geschenke zählen bei den Verschenkern */
const OWN_SUB = `('sub', 'resub', 'primepaidupgrade', 'giftpaidupgrade')`;
const GIFT = `('subgift', 'submysterygift')`;
const ANON = "ananonymousgifter";

export async function computeAudience(): Promise<AudienceSnapshot> {
  const db = await getDb();
  const rows = (
    await db.query<{ k: AudienceKind; a: string; b: string | null; n: number }>(
      `WITH s AS (SELECT DISTINCT channel_id c, lower(from_login) u FROM twitch_subs WHERE on_server AND kind IN ${OWN_SUB} AND from_login <> ''),
            g AS (SELECT DISTINCT channel_id c, lower(from_login) u FROM twitch_subs WHERE on_server AND kind IN ${GIFT} AND from_login <> '' AND lower(from_login) <> '${ANON}'),
            ch AS (SELECT DISTINCT channel_id c, lower(from_login) u FROM twitch_cheers WHERE on_server AND from_login <> ''),
            cl AS (SELECT DISTINCT player c, lower(creator_name) u FROM twitch_clips WHERE on_server AND creator_name <> ''),
            al AS (SELECT 'subs' k, * FROM s UNION ALL SELECT 'gifts', * FROM g UNION ALL SELECT 'cheers', * FROM ch UNION ALL SELECT 'clips', * FROM cl)
       SELECT x.k, x.c a, y.c b, count(*)::int n FROM al x JOIN al y ON x.k = y.k AND x.u = y.u AND x.c < y.c GROUP BY 1, 2, 3
       UNION ALL SELECT k, c, NULL, count(*)::int FROM al GROUP BY 1, 2`,
    )
  ).rows;
  const totals = {
    subs: {},
    gifts: {},
    cheers: {},
    clips: {},
  } as AudienceSnapshot["totals"];
  const pairs = {
    subs: {},
    gifts: {},
    cheers: {},
    clips: {},
  } as AudienceSnapshot["pairs"];
  for (const r of rows) {
    if (r.b === null) totals[r.k][r.a] = r.n;
    else pairs[r.k][`${r.a}|${r.b}`] = r.n;
  }
  return { totals, pairs };
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Ochiai-Ähnlichkeit der Abonnenten zweier Kanäle */
function subSimilarity(s: AudienceSnapshot, x: string, y: string): number | null {
  const tx = s.totals.subs[x];
  const ty = s.totals.subs[y];
  if (!tx || !ty) return null;
  return (s.pairs.subs[pairKey(x, y)] ?? 0) / Math.sqrt(tx * ty);
}

/** Platz von `other` unter den Kanälen mit dem ähnlichsten Publikum von `me` */
function similarityPlace(s: AudienceSnapshot, me: string, other: string): number | null {
  const mine = subSimilarity(s, me, other);
  if (mine === null || mine === 0) return null;
  let place = 1;
  for (const c of Object.keys(s.totals.subs)) if (c !== me && c !== other && (subSimilarity(s, me, c) ?? 0) > mine) place++;
  return place;
}

async function topGifters(idA: string, idB: string, players: Record<string, PlayerState>): Promise<Audience["gifters"]> {
  const rows = await swr(`gifters:${pairKey(idA, idB)}`, 10 * 60_000, async () => {
    const db = await getDb();
    // Einzelne Geschenke (subgift); ein „x Subs an die Community“ kommt zusätzlich als einzelne subgift-Zeilen
    return (
      await db.query<{ login: string; a: number; b: number }>(
        `SELECT lower(from_login) login, count(*) FILTER (WHERE channel_id = $1)::int a, count(*) FILTER (WHERE channel_id = $2)::int b
           FROM twitch_subs WHERE channel_id IN ($1, $2) AND on_server AND kind = 'subgift' AND from_login <> '' AND lower(from_login) <> '${ANON}'
          GROUP BY 1 HAVING count(*) FILTER (WHERE channel_id = $1) > 0 AND count(*) FILTER (WHERE channel_id = $2) > 0
          ORDER BY least(count(*) FILTER (WHERE channel_id = $1), count(*) FILTER (WHERE channel_id = $2)) DESC, count(*) DESC LIMIT 5`,
        [idA, idB],
      )
    ).rows;
  });
  const byLogin = new Map(Object.values(players).flatMap((p) => (p.twitchLogin ? [[p.twitchLogin.toLowerCase(), p.id] as const] : [])));
  return rows.map((r) => ({ ...r, player: byLogin.get(r.login) ?? null }));
}

async function audience(idA: string, idB: string, players: Record<string, PlayerState>): Promise<Audience | null> {
  const [{ value: s, at }, gifters] = await Promise.all([snapshot(AUDIENCE_SNAPSHOT, computeAudience, AUDIENCE_SNAPSHOT_MS), topGifters(idA, idB, players)]);
  const rows = AUDIENCE_KINDS.map((kind) => ({
    kind,
    shared: s.pairs[kind][pairKey(idA, idB)] ?? 0,
    a: s.totals[kind][idA] ?? 0,
    b: s.totals[kind][idB] ?? 0,
  }));
  if (rows.every((r) => !r.a && !r.b)) return null;
  return {
    rows,
    similarity: subSimilarity(s, idA, idB),
    placeA: similarityPlace(s, idA, idB),
    placeB: similarityPlace(s, idB, idA),
    of: Object.keys(s.totals.subs).length - 1,
    gifters,
    at,
  };
}

/* ------------------------------------------------------------------ Server */

type Span = [number, number];

function spansOf(sessions: StoredSession[], id: string, now: number): Span[] {
  return sessions
    .filter((x) => x.player === id)
    .map((x): Span => [Date.parse(x.start), x.end ? Date.parse(x.end) : now])
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
}

/** Schnitt zweier sortierter Listen von Zeitspannen */
function intersect(x: Span[], y: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i][0], y[j][0]);
    const e = Math.min(x[i][1], y[j][1]);
    if (e > s) out.push([s, e]);
    if (x[i][1] < y[j][1]) i++;
    else j++;
  }
  return out;
}

function serverThird(sessions: StoredSession[], idA: string, idB: string, now: number): ServerThird {
  const both = intersect(spansOf(sessions, idA, now), spansOf(sessions, idB, now));
  const bothMs = both.reduce((t, [s, e]) => t + e - s, 0);
  if (!both.length) return { both: 0, rows: [] };
  const ids = new Set(sessions.map((x) => x.player));
  const rows: ServerThird["rows"] = [];
  for (const id of ids) {
    if (id === idA || id === idB) continue;
    const ms = intersect(both, spansOf(sessions, id, now)).reduce((t, [s, e]) => t + e - s, 0);
    if (ms >= 60_000) rows.push({ id, seconds: ms / 1000 });
  }
  rows.sort((x, y) => y.seconds - x.seconds);
  return { both: bothMs / 1000, rows: rows.slice(0, TOP) };
}

/* ------------------------------------------------------------------ Zusammen */

export async function getThirdParties(idA: string, idB: string, players: Record<string, PlayerState>, now: number): Promise<ThirdData> {
  const [net, costream, sessions, aud] = await Promise.all([
    getNetworkSummary(),
    costreamPairs().catch(() => new Map<string, number>()),
    getAllSessions(),
    audience(idA, idB, players).catch((e) => {
      console.error("[vergleich] Publikum:", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  return {
    circle: circleLists(net.edges, costream, idA, idB),
    audience: aud,
    server: serverThird(sessions, idA, idB, now),
  };
}
