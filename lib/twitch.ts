import "server-only";
import type { TrackerEvent } from "./types";
import { updateEventMeta } from "./store";

/**
 * Twitch-Helix-Anbindung: findet zu einem Zeitpunkt das passende Archiv-VOD eines Kanals,
 * damit Tode mit Timestamp im VOD verlinkt werden können.
 * Braucht `TWITCH_CLIENT_ID` und `TWITCH_CLIENT_SECRET` (App-Zugangsdaten, kein User-Login).
 */

const CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? "";
export const TWITCH_ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET);

/** Vorlauf in Sekunden: der Tod wird erst beim nächsten Poll erkannt, also im VOD etwas früher einsteigen. */
const LEAD_SECONDS = 45;
const VIDEO_CACHE_MS = 10 * 60_000;
const USER_CACHE_MS = 24 * 60 * 60_000;

interface Vod {
  id: string;
  url: string;
  startMs: number;
  durationSec: number;
}

type Globals = typeof globalThis & {
  __acTwitch?: {
    token: { value: string; expires: number } | null;
    users: Map<string, { id: string | null; at: number }>;
    videos: Map<string, { list: Vod[]; at: number }>;
  };
};

function g() {
  const gl = globalThis as Globals;
  if (!gl.__acTwitch) gl.__acTwitch = { token: null, users: new Map(), videos: new Map() };
  return gl.__acTwitch;
}

async function token(): Promise<string> {
  const c = g();
  if (c.token && c.token.expires > Date.now() + 60_000) return c.token.value;
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" });
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Twitch Token HTTP ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  c.token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function helix<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.twitch.tv/helix/${path}?${q}`, {
    headers: { "Client-Id": CLIENT_ID, Authorization: `Bearer ${await token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) g().token = null;
  if (!res.ok) throw new Error(`Twitch ${path} HTTP ${res.status}`);
  return ((await res.json()) as { data: T[] }).data;
}

async function userId(login: string): Promise<string | null> {
  const c = g();
  const key = login.toLowerCase();
  const hit = c.users.get(key);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.id;
  const data = await helix<{ id: string }>("users", { login: key });
  const id = data[0]?.id ?? null;
  c.users.set(key, { id, at: Date.now() });
  return id;
}

/** Twitch-Dauerformat „1h23m45s“ → Sekunden */
function parseDuration(s: string) {
  let total = 0;
  for (const [, n, u] of s.matchAll(/(\d+)([hms])/g)) total += Number(n) * (u === "h" ? 3600 : u === "m" ? 60 : 1);
  return total;
}

const inflight = new Map<string, Promise<Vod[]>>();

async function videos(login: string): Promise<Vod[]> {
  const c = g();
  const key = login.toLowerCase();
  const hit = c.videos.get(key);
  if (hit && Date.now() - hit.at < VIDEO_CACHE_MS) return hit.list;
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchVideos(key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fetchVideos(key: string): Promise<Vod[]> {
  const c = g();
  const id = await userId(key);
  let list: Vod[] = [];
  if (id) {
    const data = await helix<{ id: string; url: string; created_at: string; duration: string }>("videos", {
      user_id: id,
      type: "archive",
      first: "100",
    });
    list = data.map((v) => ({ id: v.id, url: v.url, startMs: Date.parse(v.created_at), durationSec: parseDuration(v.duration) }));
  }
  c.videos.set(key, { list, at: Date.now() });
  return list;
}

export function vodLink(vodId: string, offsetSec: number) {
  const o = Math.max(0, Math.floor(offsetSec));
  const h = Math.floor(o / 3600);
  const m = Math.floor((o % 3600) / 60);
  const s = o % 60;
  return `https://www.twitch.tv/videos/${encodeURIComponent(vodId)}?t=${h}h${m}m${s}s`;
}

/** Sucht das VOD, das den Zeitpunkt abdeckt. Laufende Streams haben noch eine „wachsende“ Dauer, daher Toleranz. */
export async function findVod(login: string, atMs: number): Promise<{ vodId: string; offset: number } | null> {
  if (!TWITCH_ENABLED) return null;
  const list = await videos(login);
  for (const v of list) {
    const end = v.startMs + Math.max(v.durationSec, 1) * 1000 + 6 * 3600_000; // laufende Aufnahme: großzügig
    if (atMs >= v.startMs && atMs <= end) {
      const offset = Math.max(0, (atMs - v.startMs) / 1000 - LEAD_SECONDS);
      return { vodId: v.id, offset };
    }
  }
  return null;
}

const NEG_CACHE_MS = 10 * 60_000;
const negative = new Map<string, number>();

/**
 * Hängt an Tod-Ereignisse live gestreamter Spieler einen VOD-Link (`meta.vodUrl`).
 * Bereits aufgelöste Ereignisse werden nicht erneut abgefragt, Treffer landen dauerhaft in der DB.
 * Rückwirkend: der Stream wird über die Stream-an/aus-Ereignisse des Spielers oder direkt über Twitch bestimmt.
 */
export async function attachVods(
  events: TrackerEvent[],
  loginOf: (player: string) => string | null,
  /** Laufende Streams ohne Stream-an-Ereignis (Spieler war beim Tracker-Start schon live): player → liveSince */
  liveNow: { player: string; since: string; login: string }[] = [],
): Promise<void> {
  if (!TWITCH_ENABLED) return;
  // `noVod` = Twitch hatte zu einem abgeschlossenen Stream kein VOD; das alte Feld `vod:false` wurde zu großzügig gesetzt und wird ignoriert
  const todo = events.filter((e) => e.type === "death" && e.player && !e.meta?.unknown && e.meta?.vodUrl === undefined && e.meta?.noVod !== true);
  if (todo.length === 0) return;

  // Streams pro Spieler aus den Ereignissen rekonstruieren (für alte Tode ohne live-Markierung)
  const streams = new Map<string, { start: number; end: number; login: string | null }[]>();
  for (const e of events) {
    if (!e.player) continue;
    if (e.type === "stream_start") {
      const l = streams.get(e.player) ?? [];
      l.push({ start: Date.parse(e.at), end: Infinity, login: typeof e.meta?.login === "string" ? e.meta.login : null });
      streams.set(e.player, l);
    } else if (e.type === "stream_end") {
      const l = streams.get(e.player);
      const open = l?.find((s) => s.end === Infinity);
      if (open) open.end = Date.parse(e.at);
      else if (e.meta?.streamSeconds) {
        const end = Date.parse(e.at);
        const arr = l ?? [];
        arr.push({ start: end - Number(e.meta.streamSeconds) * 1000, end, login: typeof e.meta?.login === "string" ? e.meta.login : null });
        streams.set(e.player, arr);
      }
    }
  }

  for (const l of liveNow) {
    const arr = streams.get(l.player) ?? [];
    if (!arr.some((s) => s.end === Infinity)) arr.push({ start: Date.parse(l.since), end: Infinity, login: l.login });
    streams.set(l.player, arr);
  }

  const now = Date.now();
  await Promise.all(
    todo.map(async (e) => {
      const at = Date.parse(e.at);
      const wasLive = e.meta?.live === true || (streams.get(e.player!) ?? []).some((s) => at >= s.start - 60_000 && at <= s.end + 60_000);
      // Ohne Stream zu diesem Zeitpunkt gibt es nichts zu verlinken (kein API-Aufruf, keine dauerhafte Markierung)
      if (!wasLive) return;
      const login =
        (typeof e.meta?.twitchLogin === "string" && e.meta.twitchLogin) ||
        (streams.get(e.player!) ?? []).find((s) => at >= s.start - 60_000 && at <= s.end + 60_000)?.login ||
        loginOf(e.player!);
      if (!login) return;
      const negKey = `${login}|${e.id}`;
      const neg = negative.get(negKey);
      if (neg && now - neg < NEG_CACHE_MS) return;
      try {
        const hit = await findVod(login, at);
        if (hit) {
          await updateEventMeta(e, { vodUrl: vodLink(hit.vodId, hit.offset), vodId: hit.vodId, vodOffset: Math.round(hit.offset) });
        } else {
          negative.set(negKey, now);
          // Stream lange vorbei und kein VOD: dauerhaft merken, spart künftige Abfragen.
          if (now - at > 24 * 3600_000) await updateEventMeta(e, { noVod: true });
        }
      } catch (err) {
        console.warn("[twitch] VOD-Abfrage fehlgeschlagen:", err instanceof Error ? err.message : err);
        negative.set(negKey, now);
      }
    }),
  );
}
