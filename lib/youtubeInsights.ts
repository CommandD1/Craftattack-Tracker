import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";

/**
 * YouTube-Auswertungen für /vorschau/<key>/youtube (aus `youtube_videos` von lib/youtube.ts):
 * 1. Tagesverlauf: Uploads zu CraftAttack 14 je Format neben Twitch-Zuschauern und Spielern online (`history`)
 * 2. CraftAttack-Bonus: Median-Aufrufe der CraftAttack-Videos gegen die übrigen Videos desselben Creators
 * 3. Live-Zeit über beide Plattformen: Twitch (Tracker) + YouTube-Livestreams, davon nur auf YouTube
 */
const SEASON_START = process.env.CA_SEASON_START ?? "2026-10-10T10:00:00Z";
/** Ab hier zeigt der Tagesverlauf (Vorlauf vor dem Staffelstart) */
const CHART_FROM = "2026-10-01";
/** Mindestens so viele Videos je Seite, damit der Median etwas aussagt */
const BONUS_MIN = 5;

export interface YtDay {
  day: string;
  video: number;
  short: number;
  livestream: number;
  views: number;
  /** Twitch-Zuschauer aller Spieler-Streams: Tagesdurchschnitt und Spitze; Spieler online: Spitze */
  viewersAvg: number | null;
  viewersMax: number | null;
  onlineMax: number | null;
}

export interface YtBonus {
  player: string;
  ca: number;
  other: number;
  caMedian: number;
  otherMedian: number;
  factor: number;
}

export interface YtLiveTime {
  player: string;
  twitchS: number;
  youtubeS: number;
  /** YouTube-Livestreams ohne gleichzeitigen Twitch-Stream (laut Twitch-VODs) */
  youtubeOnlyS: number;
  youtubeStreams: number;
}

export interface YoutubeInsights {
  days: YtDay[];
  bonus: YtBonus[];
  live: YtLiveTime[];
}

const swr = createSwrCache({ maxEntries: 2 });

export function getYoutubeInsights(): Promise<YoutubeInsights> {
  return swr("insights", 15 * 60_000, async () => {
    const db = await getDb();
    const [uploads, twitch, bonus, live] = await Promise.all([
      db.query<{ day: string; format: string; n: string; views: string }>(
        `SELECT to_char(published_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, format, count(*) AS n, sum(views) AS views
           FROM youtube_videos WHERE ca14 AND published_at >= $1::date GROUP BY 1, 2`,
        [CHART_FROM],
      ),
      db.query<{ day: string; viewers_avg: number; viewers_max: number; online_max: number }>(
        `SELECT to_char(at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, round(avg(viewers))::int AS viewers_avg,
                max(viewers) AS viewers_max, max(online_count) AS online_max
           FROM history WHERE at >= $1::date GROUP BY 1`,
        [CHART_FROM],
      ),
      db.query<{ player: string; ca: string; other: string; ca_median: number; other_median: number }>(
        `SELECT player, count(*) FILTER (WHERE ca) AS ca, count(*) FILTER (WHERE NOT ca) AS other,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE ca) AS ca_median,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE NOT ca) AS other_median
           FROM youtube_videos WHERE format = 'video' AND published_at >= $1 GROUP BY player`,
        [SEASON_START],
      ),
      db.query<{ player: string; twitch_s: string; youtube_s: string; youtube_only_s: string; streams: string }>(
        `WITH yt AS (
           SELECT v.player, extract(epoch FROM coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0))) - v.live_start) AS s,
                  NOT EXISTS (SELECT 1 FROM twitch_vods t WHERE t.player = v.player
                                AND t.created_at < coalesce(v.live_end, v.live_start + make_interval(secs => coalesce(v.duration_s, 0)))
                                AND t.created_at + make_interval(secs => t.duration_s) > v.live_start) AS only_yt
             FROM youtube_videos v WHERE v.format = 'livestream' AND v.live_start >= $1)
         SELECT p.id AS player, coalesce(p.stream_on_server_seconds, 0) + coalesce(p.stream_off_server_seconds, 0) AS twitch_s,
                coalesce(sum(yt.s), 0) AS youtube_s, coalesce(sum(yt.s) FILTER (WHERE yt.only_yt), 0) AS youtube_only_s, count(yt.s) AS streams
           FROM players p LEFT JOIN yt ON yt.player = p.id GROUP BY p.id`,
        [SEASON_START],
      ),
    ]);
    const byDay = new Map<string, YtDay>();
    const day = (d: string) => {
      let x = byDay.get(d);
      if (!x) byDay.set(d, (x = { day: d, video: 0, short: 0, livestream: 0, views: 0, viewersAvg: null, viewersMax: null, onlineMax: null }));
      return x;
    };
    for (const r of uploads.rows) {
      const x = day(r.day);
      if (r.format === "video" || r.format === "short" || r.format === "livestream") x[r.format] += Number(r.n);
      x.views += Number(r.views);
    }
    for (const r of twitch.rows) Object.assign(day(r.day), { viewersAvg: r.viewers_avg, viewersMax: r.viewers_max, onlineMax: r.online_max });
    return {
      days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      bonus: bonus.rows
        .filter((r) => Number(r.ca) >= BONUS_MIN && Number(r.other) >= BONUS_MIN && r.other_median > 0)
        .map((r) => ({ player: r.player, ca: Number(r.ca), other: Number(r.other), caMedian: r.ca_median, otherMedian: r.other_median, factor: r.ca_median / r.other_median }))
        .sort((a, b) => b.factor - a.factor),
      live: live.rows
        .map((r) => ({ player: r.player, twitchS: Number(r.twitch_s), youtubeS: Number(r.youtube_s), youtubeOnlyS: Number(r.youtube_only_s), youtubeStreams: Number(r.streams) }))
        .filter((r) => r.twitchS + r.youtubeOnlyS > 0)
        .sort((a, b) => b.twitchS + b.youtubeOnlyS - (a.twitchS + a.youtubeOnlyS)),
    };
  });
}
