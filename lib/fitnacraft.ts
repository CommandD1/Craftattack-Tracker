import "server-only";
import { fitnacraftKeyOk } from "./fitnacraftKey";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "./db";

/**
 * FitnaCraft-Rückblick (einmalig, versteckt unter /fitnacraft/<FITNACRAFT_KEY>). Die Auswertung rechnet
 * `scripts/fitnacraft.mjs` einmal aus den Twitch-Daten und legt sie in `snapshots` (Schlüssel `fitnacraft`) ab; die
 * Seite liest nur diese Zeile. Ohne Schlüssel (FITNACRAFT_KEY oder ~/.config/actracker/fitnacraft.key, mind. 16 Zeichen, nie im Repo) gibt es die
 * Seiten nicht. Rückbau: Branch zurücknehmen und `DELETE FROM snapshots WHERE key = 'fitnacraft'`.
 */

export interface FcPlayer {
  id: string;
  name: string;
  uuid: string;
  login: string;
  /** Stream-Zeit auf FitnaCraft */
  seconds: number;
  sessions: number;
  longest: number;
  days: number;
  first: number;
  last: number;
  avgViewers: number;
  peakViewers: number;
  peakAt: number;
  viewerHours: number;
  /** Ganze Staffel: Stream-Zeit und ⌀ Zuschauer auf CraftAttack bzw. bei anderen Inhalten */
  caSeconds: number;
  caAvgViewers: number | null;
  otherSeconds: number;
  otherAvgViewers: number | null;
  followersStart: number | null;
  followersEnd: number | null;
  /** Summe der Follower-Zuwächse während der FitnaCraft-Sessions */
  followerGain: number;
  paidSubs: number;
  giftSubs: number;
  bits: number;
  clips: number;
  raidsOut: number;
  raidsIn: number;
  /** Berliner Tag → Sekunden */
  daily: Record<string, number>;
  /** Sekunden je Stunde (Berlin) */
  hours: number[];
  titles: { title: string; seconds: number }[];
}

export interface FcSession {
  p: string;
  a: number;
  b: number;
  seconds: number;
  avg: number;
  peak: number;
  peakAt: number;
  followers: number | null;
  paid: number;
  gift: number;
  bits: number;
  clips: number;
  titles: string[];
  vod: string | null;
  vodId: string | null;
  vodOffset: number | null;
  /** Höchste Zuschauerzahl je 5 Minuten ab Beginn */
  v: number[];
}

export interface FcLink {
  a: string;
  b: string;
  raidsAB: number;
  raidsBA: number;
  chats: number;
  chatSeconds: number;
  msgsAB: number;
  msgsBA: number;
  titleAB: number;
  titleBA: number;
  now: boolean;
  /** Sekunden gleichzeitig auf FitnaCraft */
  together: number;
}

export type FcFeedItem =
  | { at: number; t: "start"; p: string; v: string; url: string | null }
  | { at: number; t: "end"; p: string; n: number; peak: number }
  | { at: number; t: "title"; p: string; v: string }
  | { at: number; t: "raid"; p: string; to: string | null; toName: string | null; n: number | null }
  | { at: number; t: "gift"; p: string; n: number; by: string | null }
  | { at: number; t: "cheer"; p: string; n: number; by: string | null }
  | { at: number; t: "follow"; p: string; n: number | null }
  | { at: number; t: "clip"; p: string; v: string; n: number; url: string }
  | { at: number; t: "shared"; p: string; ps: string[] };

export interface FcData {
  version: number;
  generatedAt: number;
  rule: string;
  exclude: string;
  end: number;
  from: number;
  to: number;
  players: FcPlayer[];
  sessions: FcSession[];
  /** Zustand je 5 Minuten der FitnaCraft-Spieler: "0" nicht live, "1" FitnaCraft, "2" CraftAttack, "3" anderes */
  track: { start: number; step: number; states: Record<string, string> };
  /** Zuschauer aller erfassten Spieler je 5 Minuten nach Ort (ab 26.10.) */
  bins: { start: number; step: number; fc: number[]; ca: number[]; other: number[]; fcN: number[]; caN: number[]; otherN: number[] };
  days: { day: string; fcVh: number; caVh: number; otherVh: number; fcPeakN: number; fcPeakV: number; caPeakV: number; fcPlayers: number; caPlayers: number }[];
  links: FcLink[];
  raids: { at: number; from: string; to: string | null; toName: string | null; viewers: number | null; fc: boolean }[];
  shared: { a: number; b: number; ps: string[]; others: number }[];
  chats: { at: number; from: string; to: string; text: string; url: string | null }[];
  clips: { id: string; player: string; at: number; title: string; views: number; seconds: number; url: string; thumbnail: string | null; creator: string | null }[];
  feed: FcFeedItem[];
  names: Record<string, [string, string]>;
}

const CHECK_MS = 10 * 60_000;
let mem: { at: number; checked: number; data: FcData | null } | null = null;
let pending: Promise<FcData | null> | null = null;

/** Prüft den Schlüssel aus der Adresse; falsch oder nicht eingerichtet → 404 */
export async function fcGate(params: Promise<{ key: string }>): Promise<string> {
  await connection();
  const { key } = await params;
  let ok = false;
  try {
    ok = fitnacraftKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  if (!ok) notFound();
  return key;
}

/** Die fertige Auswertung (alle 10 Minuten nachgesehen, ob sie neu berechnet wurde) */
export async function loadFitnacraft(): Promise<FcData | null> {
  const now = Date.now();
  if (mem && now - mem.checked < CHECK_MS) return mem.data;
  pending ??= (async () => {
    const db = await getDb();
    const at = (await db.query<{ at: Date }>(`SELECT at FROM snapshots WHERE key = 'fitnacraft'`)).rows[0]?.at.getTime() ?? null;
    if (at === null) {
      mem = { at: 0, checked: Date.now(), data: null };
      return null;
    }
    if (mem?.data && mem.at === at) {
      mem.checked = Date.now();
      return mem.data;
    }
    const row = (await db.query<{ data: string }>(`SELECT data FROM snapshots WHERE key = 'fitnacraft'`)).rows[0];
    const data = row ? (JSON.parse(row.data) as FcData) : null;
    mem = { at, checked: Date.now(), data };
    return data;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** Laden oder 404, wenn noch nicht berechnet */
export async function fcData(): Promise<FcData> {
  const d = await loadFitnacraft();
  if (!d) notFound();
  return d;
}

/** Vorschaubild über den eigenen Server (app/api/clip-thumb), nie direkt von Twitch (siehe cookie.md) */
export const fcThumb = (c: { id: string; thumbnail: string | null }) => (c.thumbnail ? `/api/clip-thumb/${encodeURIComponent(c.id)}` : null);

export const fcBase = (key: string) => `/fitnacraft/${encodeURIComponent(key)}`;

/** Name und UUID eines Spielers (auch außerhalb von FitnaCraft, z. B. Raid-Ziele) */
export function who(d: FcData, id: string | null | undefined): { id: string; name: string; uuid: string } | null {
  if (!id) return null;
  const n = d.names[id];
  return { id, name: n?.[0] ?? id, uuid: n?.[1] ?? "" };
}

/** Wer an Berliner Tag `day` (YYYY-MM-DD) auf FitnaCraft war, mit Abschnitten [von, bis] in ms */
export function daySegments(d: FcData, from: number, to: number) {
  const rows: { id: string; name: string; uuid: string; seconds: number; segs: FcSession[] }[] = [];
  for (const p of d.players) {
    const segs = d.sessions.filter((s) => s.p === p.id && s.a < to && s.b > from);
    if (!segs.length) continue;
    const seconds = segs.reduce((x, s) => x + (Math.min(s.b, to) - Math.max(s.a, from)) / 1000, 0);
    rows.push({ id: p.id, name: p.name, uuid: p.uuid, seconds, segs });
  }
  return rows.sort((a, b) => b.seconds - a.seconds);
}
