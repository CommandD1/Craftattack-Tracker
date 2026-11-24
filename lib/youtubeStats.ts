import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";

/** Staffelbeginn für den CraftAttack-Anteil an allen Uploads */
const SEASON_START = process.env.CA_SEASON_START ?? "2026-10-10T10:00:00Z";

export type YoutubeFormat = "video" | "short" | "livestream";

export interface YoutubeStats {
  channels: { id: string; title: string; handle: string | null; subs: number | null }[];
  /** Uploads zu CraftAttack 14 je Format */
  formats: Record<YoutubeFormat, { n: number; views: number }>;
  uploads: number;
  views: number;
  likes: number;
  comments: number;
  /** Alle Uploads der Kanäle seit Staffelbeginn (für den Anteil) */
  uploadsSeason: number;
  ca14Season: number;
  first: string | null;
  last: string | null;
  /** CraftAttack-Livestreams auf YouTube, während kein Twitch-Stream lief (laut Twitch-VODs) */
  youtubeOnlyStreams: number;
  /** Live-Zeit der CraftAttack-Livestreams auf YouTube (Sekunden), davon ohne gleichzeitigen Twitch-Stream */
  liveSeconds: number;
  liveOnlySeconds: number;
  top: { id: string; title: string; format: YoutubeFormat; views: number; at: string; channel: string }[];
}

const swr = createSwrCache();

/** YouTube-Zahlen eines Spielers (lib/youtube.ts füllt die Tabellen); null = keine CraftAttack-14-Uploads */
export function getYoutubeStats(player: string): Promise<YoutubeStats | null> {
  return swr(`yt:${player}`, 10 * 60_000, async () => {
    const db = await getDb();
    const [agg, channels, top, share] = await Promise.all([
      db.query<{ format: YoutubeFormat; n: string; views: string; likes: string; comments: string; first: Date; last: Date; yt_only: string; live_s: string; live_only_s: string }>(
        `SELECT v.format, count(*) AS n, coalesce(sum(v.views), 0) AS views, coalesce(sum(v.likes), 0) AS likes,
                coalesce(sum(v.comments), 0) AS comments, min(v.published_at) AS first, max(v.published_at) AS last,
                count(*) FILTER (WHERE v.format = 'livestream' AND v.live_start IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM twitch_vods t WHERE t.player = v.player
                     AND t.created_at < coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0)))
                     AND t.created_at + make_interval(secs => t.duration_s) > v.live_start)) AS yt_only,
                coalesce(sum(extract(epoch FROM coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0))) - v.live_start)) FILTER (WHERE v.format = 'livestream'), 0) AS live_s,
                coalesce(sum(extract(epoch FROM coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0))) - v.live_start)) FILTER (WHERE v.format = 'livestream' AND NOT EXISTS (
                  SELECT 1 FROM twitch_vods t WHERE t.player = v.player
                     AND t.created_at < coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0)))
                     AND t.created_at + make_interval(secs => t.duration_s) > v.live_start)), 0) AS live_only_s
           FROM youtube_videos v WHERE v.player = $1 AND v.ca14 GROUP BY v.format`,
        [player],
      ),
      db.query<{ id: string; title: string; handle: string | null; subs: number | null }>(
        `SELECT c.id, c.title, c.handle, c.subs FROM youtube_channels c
          WHERE c.player = $1 AND EXISTS (SELECT 1 FROM youtube_videos v WHERE v.channel_id = c.id AND v.ca14)
          ORDER BY c.subs DESC NULLS LAST`,
        [player],
      ),
      db.query<{ id: string; title: string; format: YoutubeFormat; views: string; published_at: Date; channel: string }>(
        `SELECT v.id, v.title, v.format, v.views, v.published_at, c.title AS channel
           FROM youtube_videos v JOIN youtube_channels c ON c.id = v.channel_id
          WHERE v.player = $1 AND v.ca14 ORDER BY v.views DESC LIMIT 5`,
        [player],
      ),
      db.query<{ all: string; ca14: string }>(
        `SELECT count(*) AS all, count(*) FILTER (WHERE ca14) AS ca14 FROM youtube_videos WHERE player = $1 AND published_at >= $2`,
        [player, SEASON_START],
      ),
    ]);
    if (!agg.rows.length) return null;
    const formats: YoutubeStats["formats"] = { video: { n: 0, views: 0 }, short: { n: 0, views: 0 }, livestream: { n: 0, views: 0 } };
    let likes = 0, comments = 0, youtubeOnlyStreams = 0, liveSeconds = 0, liveOnlySeconds = 0;
    let first: Date | null = null, last: Date | null = null;
    for (const r of agg.rows) {
      formats[r.format] = { n: Number(r.n), views: Number(r.views) };
      likes += Number(r.likes);
      comments += Number(r.comments);
      youtubeOnlyStreams += Number(r.yt_only);
      liveSeconds += Number(r.live_s);
      liveOnlySeconds += Number(r.live_only_s);
      if (!first || r.first < first) first = r.first;
      if (!last || r.last > last) last = r.last;
    }
    return {
      channels: channels.rows,
      formats,
      uploads: formats.video.n + formats.short.n + formats.livestream.n,
      views: formats.video.views + formats.short.views + formats.livestream.views,
      likes,
      comments,
      uploadsSeason: Number(share.rows[0]?.all ?? 0),
      ca14Season: Number(share.rows[0]?.ca14 ?? 0),
      first: first?.toISOString() ?? null,
      last: last?.toISOString() ?? null,
      youtubeOnlyStreams,
      liveSeconds,
      liveOnlySeconds,
      top: top.rows.map((r) => ({ id: r.id, title: r.title, format: r.format, views: Number(r.views), at: r.published_at.toISOString(), channel: r.channel })),
    };
  });
}
