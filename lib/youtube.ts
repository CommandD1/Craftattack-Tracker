import "server-only";
import { getDb } from "./db";
import { getEvents, getState, insertPastEvents, updateEventMeta } from "./store";
import { findVodAt, TWITCH_ENABLED } from "./twitch";
import type { EventType, TrackerEvent } from "./types";
import { youtubeMomentUrl } from "./youtubeLive";
import { YOUTUBE_CHANNELS } from "./youtubeChannels";

/**
 * YouTube-Uploads der Teilnehmer über die offizielle YouTube Data API v3 (nur Kanäle aus lib/youtubeChannels.ts, also
 * vom Teilnehmer selbst verlinkte – keine Fan-Kanäle). Läuft nur im Tracker, alle SYNC_MS.
 *
 * - Speichert alle Uploads seit YOUTUBE_SINCE in `youtube_videos` (ohne Beschreibung), damit die Spielerseite auch den
 *   CraftAttack-Anteil zeigen kann; Kanaldaten (Abos) in `youtube_channels`.
 * - Uploads zu CraftAttack 14 werden zu Ereignissen mit Link: „YouTube-Video“, „YouTube-Short“, bei Livestreams
 *   „YouTube-Live an“ (Start) und „YouTube-Live aus“ (Ende, mit Dauer). Aufrufe werden bei jedem Lauf nachgezogen.
 *
 * CraftAttack-Erkennung: „Craft Attack“/CA1x im Titel, oder in der Beschreibung ausdrücklich Staffel 14
 * („Craft Attack 14“, #craftattack14, CA14). Tags zählen nicht (SEO-Listen wie „craft attack 13“ unter jedem Short),
 * allgemeine Erwähnungen in der Beschreibung auch nicht (Textbausteine). Staffel 14 = ausdrücklich 14 oder ein
 * CraftAttack-Upload ab CA14_FROM ohne ältere Staffelnummer.
 *
 * Kontingent: 10.000 Einheiten/Tag. Erster Lauf (rückwirkend) ≈ 600, danach ≈ 230 je Lauf (1 Einheit je 50 Kanäle,
 * je Playlist-Seite und je 50 Videos). MAX_UNITS begrenzt einen Lauf.
 */

const KEY = process.env.YOUTUBE_API_KEY ?? "";
export const YOUTUBE_ENABLED = Boolean(KEY);
const SINCE = process.env.YOUTUBE_SINCE ?? "2026-09-01T00:00:00Z";
const CA14_FROM = "2026-09-15T00:00:00Z";
const SYNC_MS = 6 * 3600_000;
const MAX_UNITS = 3000;
/** Aufrufe dieser Uploads bei jedem Lauf aktualisieren: CraftAttack-Uploads und alles aus den letzten Tagen */
const REFRESH_RECENT_MS = 7 * 86400_000;

const CA = /craft\s*-?\s*attack|#ca1[0-4]\b|\bca\s?1[0-4]\b/i;
const CA14 = /craft\s*-?\s*attack\s*-?\s*14\b|#craftattack14|#ca14\b|\bca\s?14\b/i;
const OLD_SEASON = /craft\s*-?\s*attack\s*-?\s*(1[0-3]|[1-9])\b|#craftattack(1[0-3]|[1-9])\b|\bca\s?1[0-3]\b/i;

let units = 0;
async function api<T>(endpoint: string, params: Record<string, string>): Promise<T | null> {
  if (units >= MAX_UNITS) throw new Error(`Kontingent für diesen Lauf (${MAX_UNITS}) erreicht`);
  units++;
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: KEY })}`, { signal: AbortSignal.timeout(30_000) });
  if (r.ok) return (await r.json()) as T;
  const j = (await r.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
  const reason = j.error?.errors?.[0]?.reason ?? String(r.status);
  if (reason === "playlistNotFound" || reason === "videoNotFound") return null; // Kanal ohne öffentliche Uploads
  throw new Error(`${endpoint}: ${reason}`);
}

const isoDur = (s: string | undefined) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s ?? "");
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
};

interface ApiVideo {
  id: string;
  snippet: { channelId: string; publishedAt: string; title: string; description: string };
  contentDetails: { duration: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
}

function classify(v: ApiVideo) {
  const { title, description, publishedAt } = v.snippet;
  const dur = isoDur(v.contentDetails.duration);
  const live = v.liveStreamingDetails?.actualStartTime ? v.liveStreamingDetails : null;
  const format = live ? "livestream" : dur !== null && dur <= 180 && (dur <= 60 || /#shorts?\b/i.test(`${title} ${description}`)) ? "short" : "video";
  const ca = CA.test(title) || CA14.test(description);
  const ca14 = ca && (CA14.test(title) || CA14.test(description) || (publishedAt >= CA14_FROM && !OLD_SEASON.test(title)));
  return { dur, live, format, ca, ca14 };
}

export async function syncYoutube(): Promise<{ channels: number; fetched: number; events: number; units: number; linked: number }> {
  units = 0;
  const db = await getDb();
  const owner = new Map(YOUTUBE_CHANNELS.map((c) => [c.id, c.player]));

  // 1. Kanäle: Abos und Uploads-Playlist
  const uploads = new Map<string, string>();
  for (let i = 0; i < YOUTUBE_CHANNELS.length; i += 50) {
    const ids = YOUTUBE_CHANNELS.slice(i, i + 50).map((c) => c.id);
    const j = await api<{ items: { id: string; snippet: { title: string; customUrl?: string }; statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
      "channels", { part: "snippet,statistics,contentDetails", id: ids.join(","), maxResults: "50" },
    );
    for (const c of j?.items ?? []) {
      uploads.set(c.id, c.contentDetails.relatedPlaylists.uploads);
      await db.query(
        `INSERT INTO youtube_channels (id, player, title, handle, subs, views, videos, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (id) DO UPDATE SET player = $2, title = $3, handle = $4, subs = $5, views = $6, videos = $7, fetched_at = now()`,
        [c.id, owner.get(c.id), c.snippet.title, c.snippet.customUrl ?? null, c.statistics.subscriberCount ? Number(c.statistics.subscriberCount) : null,
          Number(c.statistics.viewCount ?? 0), Number(c.statistics.videoCount ?? 0)],
      );
    }
  }

  // 2. Neue Uploads je Kanal: Playlist ist neu → alt; bis zur ersten Seite vor dem letzten bekannten Upload (−2 Tage)
  const known = new Map(
    (await db.query<{ channel_id: string; last: Date }>(`SELECT channel_id, max(published_at) AS last FROM youtube_videos GROUP BY channel_id`)).rows.map((r) => [r.channel_id, r.last.getTime()]),
  );
  const ids = new Set<string>();
  for (const [cid, playlist] of uploads) {
    const stop = new Date(Math.max(Date.parse(SINCE), (known.get(cid) ?? 0) - 2 * 86400_000)).toISOString();
    let token: string | undefined;
    do {
      const j = await api<{ nextPageToken?: string; items: { contentDetails: { videoId: string; videoPublishedAt?: string } }[] }>(
        "playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "50", ...(token ? { pageToken: token } : {}) },
      );
      if (!j) break;
      let fresh = 0;
      for (const it of j.items) if (it.contentDetails.videoPublishedAt && it.contentDetails.videoPublishedAt >= stop) { ids.add(it.contentDetails.videoId); fresh++; }
      token = fresh ? j.nextPageToken : undefined;
    } while (token);
  }
  // Bekannte Uploads, deren Zahlen sich noch ändern
  const refresh = await db.query<{ id: string }>(`SELECT id FROM youtube_videos WHERE ca OR published_at >= $1`, [new Date(Date.now() - REFRESH_RECENT_MS)]);
  for (const r of refresh.rows) ids.add(r.id);

  // 3. Videodetails
  const list = [...ids];
  let fetched = 0;
  for (let i = 0; i < list.length; i += 50) {
    const j = await api<{ items: ApiVideo[] }>("videos", { part: "snippet,contentDetails,statistics,liveStreamingDetails", id: list.slice(i, i + 50).join(","), maxResults: "50" });
    for (const v of j?.items ?? []) {
      const player = owner.get(v.snippet.channelId);
      if (!player) continue;
      const c = classify(v);
      await db.query(
        `INSERT INTO youtube_videos (id, channel_id, player, published_at, title, format, duration_s, views, likes, comments, live_start, live_end, ca, ca14, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
         ON CONFLICT (id) DO UPDATE SET title = $5, format = $6, duration_s = $7, views = $8, likes = $9, comments = $10, live_start = $11, live_end = $12, ca = $13, ca14 = $14, fetched_at = now()`,
        [v.id, v.snippet.channelId, player, v.snippet.publishedAt, v.snippet.title, c.format, c.dur, Number(v.statistics.viewCount ?? 0),
          v.statistics.likeCount != null ? Number(v.statistics.likeCount) : null, v.statistics.commentCount != null ? Number(v.statistics.commentCount) : null,
          c.live?.actualStartTime ?? null, c.live?.actualEndTime ?? null, c.ca, c.ca14],
      );
      fetched++;
    }
  }

  // 4. Ereignisse für CraftAttack 14: Video bzw. Short zum Upload; Livestream als „Live an“ (Start) und „Live aus“ (Ende)
  const rows = (
    await db.query<{ id: string; player: string; published_at: Date; live_start: Date | null; live_end: Date | null; title: string; format: string; duration_s: number | null; views: string; channel: string; name: string; uuid: string; also_twitch: boolean }>(
      `SELECT v.id, v.player, v.published_at, v.live_start, v.live_end, v.title, v.format, v.duration_s, v.views, c.title AS channel, p.name, p.uuid,
              EXISTS (SELECT 1 FROM twitch_vods t WHERE t.player = v.player AND v.live_start IS NOT NULL
                         AND t.created_at < coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0)))
                         AND t.created_at + make_interval(secs => t.duration_s) > v.live_start) AS also_twitch
         FROM youtube_videos v JOIN youtube_channels c ON c.id = v.channel_id JOIN players p ON p.id = v.player
        WHERE v.ca14`,
    )
  ).rows;
  const watch = (id: string, t = 0) => `https://www.youtube.com/watch?v=${id}${t > 0 ? `&t=${Math.floor(t)}s` : ""}`;
  const pending: TrackerEvent[] = [];
  for (const r of rows) {
    const base = { player: r.player, playerName: r.name, uuid: r.uuid, where: "youtube" as const, value: Number(r.views) };
    const meta = { videoId: r.id, title: r.title, channel: r.channel };
    if (r.format === "livestream" && r.live_start) {
      const secs = r.live_end ? Math.round((r.live_end.getTime() - r.live_start.getTime()) / 1000) : r.duration_s;
      pending.push({ ...base, id: `yts-${r.id}`, at: r.live_start.toISOString(), type: "youtube_stream_start", meta: { ...meta, alsoTwitch: r.also_twitch, url: watch(r.id) } });
      if (r.live_end) pending.push({ ...base, id: `yte-${r.id}`, at: r.live_end.toISOString(), type: "youtube_stream_end", meta: { ...meta, streamSeconds: secs, alsoTwitch: r.also_twitch, url: watch(r.id, Math.max(0, (secs ?? 0) - 60)) } });
    } else {
      pending.push({
        ...base,
        id: `yt-${r.id}`,
        at: r.published_at.toISOString(),
        type: r.format === "short" ? "youtube_short" : "youtube_video",
        meta: { ...meta, durationS: r.duration_s, url: r.format === "short" ? `https://www.youtube.com/shorts/${r.id}` : watch(r.id) },
      });
    }
  }
  // Aufrufe bestehender Ereignisse nachziehen
  for (const e of pending) await db.query(`UPDATE events SET value = $2 WHERE id = $1 AND value IS DISTINCT FROM $2`, [e.id, e.value]);
  // Nicht mehr als CraftAttack 14 erkannt (z. B. Titel geändert) → Ereignisse entfernen
  await db.query(
    `DELETE FROM events e USING youtube_videos v
      WHERE e.type LIKE 'youtube\\_%' AND e.id IN ('yt-' || v.id, 'yts-' || v.id, 'yte-' || v.id) AND NOT v.ca14`,
  );
  const events = await insertPastEvents(pending);
  const linked = await linkYoutubeMoments();
  return { channels: uploads.size, fetched, events, units, linked };
}

/** Ereignisse, die einen Link auf den Moment in der Aufzeichnung bekommen (wie bei Twitch-VODs) */
const MOMENT_TYPES = new Set<EventType>(["death", "achievement", "chat", "stream_start", "stream_end", "milestone", "rank", "first_join", "raid"]);

/**
 * YouTube-Livestreams als Ersatz-Aufzeichnung: Ereignisse während eines YouTube-Livestreams des Spielers (Chat: des
 * Kanals, in dem geschrieben wurde) bekommen `meta.ytUrl` an genau dieser Stelle, wenn es kein Twitch-VOD gibt. Hat
 * das Ereignis ein Twitch-VOD, das bei Twitch nicht mehr existiert (gelöscht), wird es mit `vodGone` markiert und
 * ebenfalls auf YouTube verlinkt. Twitch bleibt sonst immer vorn (lib/events.ts momentLink).
 */
async function linkYoutubeMoments(): Promise<number> {
  const db = await getDb();
  const lives = (
    await db.query<{ player: string; id: string; live_start: Date; live_end: Date | null; duration_s: number | null }>(
      `SELECT player, id, live_start, live_end, duration_s FROM youtube_videos WHERE format = 'livestream' AND live_start IS NOT NULL`,
    )
  ).rows.map((r) => ({ player: r.player, id: r.id, start: r.live_start.getTime(), end: r.live_end?.getTime() ?? r.live_start.getTime() + (r.duration_s ?? 0) * 1000 }));
  if (!lives.length) return 0;
  const byPlayer = Map.groupBy(lives, (l) => l.player);
  const state = await getState();
  // Je YouTube-Livestream einmal: gibt es bei Twitch (noch) ein VOD zur selben Zeit?
  const twitchAlive = new Map<string, boolean>();
  const aliveFor = async (player: string, l: { id: string; start: number; end: number }) => {
    if (twitchAlive.has(l.id)) return twitchAlive.get(l.id)!;
    const login = state.players[player]?.twitchLogin ?? null;
    // Im Zweifel (keine Twitch-Zugangsdaten, kein Login, Fehler) behält Twitch den Vorrang
    let alive = true;
    if (TWITCH_ENABLED && login) alive = Boolean(await findVodAt(login, (l.start + l.end) / 2).catch(() => true));
    twitchAlive.set(l.id, alive);
    return alive;
  };
  let n = 0;
  for (const e of await getEvents()) {
    if (!MOMENT_TYPES.has(e.type) || e.meta?.estimated === true) continue;
    const who = e.type === "chat" && typeof e.meta?.channelId === "string" ? e.meta.channelId : e.player;
    if (!who) continue;
    const at = Date.parse(e.at);
    const l = byPlayer.get(who)?.find((x) => at >= x.start - 60_000 && at <= x.end + 60_000);
    if (!l) continue;
    const hasTwitch = typeof e.meta?.vodUrl === "string";
    const gone = hasTwitch && !(await aliveFor(who, l));
    if (hasTwitch && !gone) continue;
    const url = youtubeMomentUrl(l.id, (at - l.start) / 1000, e.type === "stream_start" ? 0 : undefined);
    if (e.meta?.ytUrl === url && (!gone || e.meta?.vodGone === true)) continue;
    await updateEventMeta(e, gone ? { ytUrl: url, vodGone: true } : { ytUrl: url });
    n++;
  }
  return n;
}

export function startYoutubeSync() {
  const gl = globalThis as typeof globalThis & { __acYoutube?: boolean };
  if (gl.__acYoutube || !YOUTUBE_ENABLED) return;
  gl.__acYoutube = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try {
      const r = await syncYoutube();
      console.log(`[youtube] ${r.channels} Kanäle · ${r.fetched} Uploads abgeglichen · ${r.events} neue Ereignisse · ${r.linked} Momente mit YouTube-Livestream verlinkt · ${r.units} API-Einheiten (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (err) {
      console.warn("[youtube] Abgleich fehlgeschlagen:", err instanceof Error ? err.message : err, `(${units} API-Einheiten)`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 4 * 60_000).unref();
  setInterval(run, SYNC_MS).unref();
}
