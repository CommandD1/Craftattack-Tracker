/**
 * „CraftAttack oder alles“ für Ereignis-Listen (Ereignisse, Startseite, Spielerprofil, Live). Standard ist
 * CraftAttack: Server-Ereignisse immer, Twitch-Ereignisse (Live gehen, Titel, Abos, Clips, Raids, Chat, geteilter
 * Chat …) nur, wenn ein beteiligter Streamer in diesem Stream auf dem Server war oder ein Beteiligter genau dann
 * online war. Ohne `server-only`, nur Rechnen.
 *
 * Ein Stream gilt als CraftAttack-Stream, wenn sich eine Server-Session des Streamers mit ihm überschneidet oder der
 * Tracker beim Start „auf dem Server“ vermerkt hat (meta.onServer). In Tracker-Lücken ohne Sessions zählt nur dieser
 * Vermerk. (meta.peakViewersOnServer am Stream-Ende ist der Höchstwert der Staffel, nicht des Streams – taugt nicht.)
 */
import type { TrackerEvent } from "./types";
import { onlineIndex, type SessionLike } from "./onlineSpans";
import { sharedChatPlayers } from "./events";

export type Scope = "ca" | "alles";
/** Adress-Parameter `?wo=alles`; alles andere (auch das frühere `wo=server|twitch`) = CraftAttack */
export const scopeOf = (v: unknown): Scope => (v === "alles" ? "alles" : "ca");
export const SCOPE_LABEL: Record<Scope, string> = { ca: "CraftAttack", alles: "Alles" };
export const SCOPE_HINT: Record<Scope, string> = {
  ca: "Server-Ereignisse und Twitch-Ereignisse aus Streams, in denen der Streamer auf dem Server war",
  alles: "Auch Twitch-Ereignisse aus Streams ohne CraftAttack",
};

/** Ein Raid steht am Ende des Streams, der Start kann kurz vor dem ersten Stand liegen */
const BEFORE_MS = 2 * 60_000;
const AFTER_MS = 10 * 60_000;
/** Stream ohne erfasstes Ende (Tracker-Neustart): höchstens so lang */
const OPEN_MAX_MS = 12 * 3600_000;

interface Stream {
  start: number;
  end: number;
  ca: boolean;
}

export interface LiveLike {
  id: string;
  liveSince: string | null;
  online: boolean;
}

/**
 * Ein einziger Eintrag. Nicht nach der Identität der Ereignis-Liste: loadTracker() liefert, solange jemand live
 * ist, je Aufruf eine neue Kopie (withLiveLinks), dann würde bei jedem Seitenaufruf neu gerechnet. Länge und
 * letztes Ereignis reichen, um neue Ereignisse zu erkennen.
 */
let cache: { at: number; n: number; last: string | undefined; sessions: SessionLike[]; test: (e: TrackerEvent) => boolean } | null = null;

/**
 * Prüfung „gehört zu CraftAttack“ für Ereignisse. `events` aufsteigend nach Zeit (wie aus loadTracker/getState);
 * eine Minute zwischengespeichert.
 */
export function craftScope(events: TrackerEvent[], sessions: SessionLike[], players: LiveLike[], now: number): (e: TrackerEvent) => boolean {
  const n = events.length;
  const last = events[n - 1]?.id;
  if (cache && cache.n === n && cache.last === last && cache.sessions === sessions && now - cache.at < 60_000) return cache.test;
  const test = build(events, sessions, players, now);
  cache = { at: now, n, last, sessions, test };
  return test;
}

function build(events: TrackerEvent[], sessions: SessionLike[], players: LiveLike[], now: number): (e: TrackerEvent) => boolean {
  const online = onlineIndex(sessions, now);
  const played = (id: string, from: number, to: number) => online.either(id, id, from, to).length > 0;
  const streams = new Map<string, Stream[]>();
  const open = new Map<string, { start: number; flag: boolean }>();
  const push = (id: string, start: number, end: number, flag: boolean) => {
    const list = streams.get(id) ?? streams.set(id, []).get(id)!;
    list.push({ start, end, ca: flag || played(id, start, end) });
  };
  for (const e of events) {
    if (!e.player || (e.type !== "stream_start" && e.type !== "stream_end")) continue;
    const t = Date.parse(e.at);
    const prev = open.get(e.player);
    if (e.type === "stream_start") {
      // Start ohne Ende davor: der vorige Stream endete spätestens jetzt
      if (prev) push(e.player, prev.start, Math.min(t, prev.start + OPEN_MAX_MS), prev.flag);
      const started = typeof e.meta?.startedAt === "string" ? Date.parse(e.meta.startedAt) : NaN;
      open.set(e.player, { start: Number.isFinite(started) ? Math.min(started, t) : t, flag: e.meta?.onServer === true });
    } else {
      const started = typeof e.meta?.startedAt === "string" ? Date.parse(e.meta.startedAt) : NaN;
      const start = Number.isFinite(started) ? started : prev?.start ?? t - Number(e.meta?.streamSeconds ?? 0) * 1000;
      push(e.player, start, t, Boolean(prev?.flag));
      open.delete(e.player);
    }
  }
  const live = new Map(players.map((p) => [p.id, p]));
  for (const [id, o] of open) {
    const p = live.get(id);
    if (p?.liveSince) push(id, Math.min(o.start, Date.parse(p.liveSince)), now, o.flag || p.online);
    else push(id, o.start, Math.min(now, o.start + OPEN_MAX_MS), o.flag);
  }
  for (const p of players) {
    // Laufender Stream, dessen Start vor der Erfassung lag
    if (p.liveSince && !open.has(p.id)) push(p.id, Date.parse(p.liveSince), now, p.online);
  }
  for (const list of streams.values()) list.sort((a, b) => a.start - b.start);

  /** War `id` in seinem Stream zum Zeitpunkt `t` auf dem Server? */
  const caStream = (id: string, t: number) => {
    const list = streams.get(id);
    if (!list) return false;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.start - BEFORE_MS > t) continue;
      if (t <= s.end + AFTER_MS) {
        if (s.ca) return true;
      } else if (s.end + AFTER_MS < t - OPEN_MAX_MS) break;
    }
    return false;
  };

  return (e) => {
    if (e.where !== "twitch") return true;
    const t = Date.parse(e.at);
    const streamers =
      e.type === "chat"
        ? [e.meta?.channelId]
        : e.type === "raid"
          ? [e.player, e.meta?.raidTargetPlayerId]
          : e.type === "shared_chat_start" || e.type === "shared_chat_end"
            ? [e.player, ...sharedChatPlayers(e)]
            : [e.player];
    const ids = streamers.filter((x): x is string => typeof x === "string" && x !== "");
    if (ids.some((id) => caStream(id, t))) return true;
    // Beteiligter genau dann auf dem Server (z. B. schreibt beim Spielen im Chat eines anderen)
    return [e.player, ...ids].some((id) => typeof id === "string" && online.at(id, t));
  };
}
