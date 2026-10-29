import "server-only";
import { getDb } from "./db";
import { createSwrCache } from "./swrCache";

/**
 * Experimentelle Schätzung der Twitch-Einnahmen aus Abos und Bits (interne Seite). Werbung ist nicht sichtbar und fehlt.
 *
 * Grundlage ist die Zeit auf dem Server: Die Abo-Ereignisse zählen nur, während der Streamer auf CraftAttack war, also
 * werden auch die Stunden nur dort gezählt. Ab Beginn der Einzelerfassung (Tabelle twitch_subs) sind Stufe und
 * Community-Geschenke bekannt; ältere Streams werden mit dem dort gemessenen Wert je altem Abo-Eintrag umgerechnet.
 *
 * Was fehlt (die Werte sind eher eine Untergrenze): Verlängerungen, die nicht im Chat geteilt werden, Werbung,
 * Sponsoren, Spenden außerhalb von Twitch.
 */

/** Bruttopreise in Deutschland (Euro, inkl. 19 % USt.) */
export const SUB_PRICE_EUR = { t1: 4.99, t2: 9.99, t3: 24.99 } as const;
export const VAT = 0.19;
/** 1 Bit = 1 US-Cent an den Streamer, umgerechnet */
export const BIT_EUR = 0.009;
export const SHARES = [50, 60, 70] as const;
export type Share = (typeof SHARES)[number];

const SEASON_FROM = "2026-10-01";
/** Unter so vielen alten Einträgen mit genauer Gegenprobe bleibt es bei der Annahme „alles Stufe 1“ */
const MIN_CALIBRATION = 300;
const MIN_STREAM_MIN = 10;
/** Größter Abstand zweier Verlaufspunkte, der noch als durchgehend gilt */
const COVER_GAP = "5 minutes";
const BASE_CACHE_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

const net = (gross: number) => gross / (1 + VAT);

interface Tiers {
  t1: number;
  t2: number;
  t3: number;
  prime: number;
  /** davon verschenkt (in t1–t3 enthalten) */
  gift: number;
}
const noTiers = (): Tiers => ({ t1: 0, t2: 0, t3: 0, prime: 0, gift: 0 });
const tierUnits = (t: Tiers) => t.t1 + t.t2 + t.t3 + t.prime;
/** Netto-Umsatz vor der Aufteilung (Prime wie Stufe 1) */
const tierNet = (t: Tiers) => (t.t1 + t.prime) * net(SUB_PRICE_EUR.t1) + t.t2 * net(SUB_PRICE_EUR.t2) + t.t3 * net(SUB_PRICE_EUR.t3);

interface BaseStream {
  player: string;
  start: number;
  end: number;
  vod: string | null;
  running: boolean;
  serverMin: number;
  /** alte Zählung (Abo-Ereignisse je Minute, nur auf dem Server) */
  legacy: number;
  bitsServer: number;
  bitsAll: number;
  /** genaue Erfassung, falls der Stream danach begann */
  precise: { server: Tiers; all: Tiers } | null;
}

interface Base {
  streams: BaseStream[];
  /** Beginn der Einzelerfassung */
  preciseFrom: number | null;
  /** Netto-Umsatz und Abos je altem Eintrag, aus Streams mit beiden Zählungen */
  calibration: {
    netPerEntry: number;
    unitsPerEntry: number;
    entries: number;
  } | null;
  loadedAt: number;
}

async function loadBase(): Promise<Base> {
  const db = await getDb();
  // Bei Sperren durch craftattack.one bleibt der letzte Online-Stand stehen, während kein Verlauf geschrieben wird:
  // Abos und Bits zählen nur, wenn kurz davor ein Verlaufspunkt live auf dem Server liegt, Lücken zählen nicht als Zeit
  const covered = (player: string, at: string) =>
    `EXISTS (SELECT 1 FROM player_history h WHERE h.player = ${player} AND h.at > ${at} - interval '${COVER_GAP}'
       AND h.at <= ${at} + interval '1 minute' AND h.online AND h.viewers IS NOT NULL)`;
  const streamRows = await db.query<{
    player: string;
    st: Date;
    en: Date;
    vod: string | null;
    running: boolean;
    server_min: number;
    legacy: number;
    bits_server: number;
    bits_all: number;
  }>(
    `WITH ended AS (
       SELECT DISTINCT ON (player, st) player, st, st + make_interval(secs => secs) AS en, vod, false AS running FROM (
         SELECT player, (meta->>'streamSeconds')::float8 AS secs, meta->>'vodUrl' AS vod,
                coalesce((meta->>'startedAt')::timestamptz, at - make_interval(secs => (meta->>'streamSeconds')::float8)) AS st
           FROM events WHERE type = 'stream_end' AND at >= $1 AND player IS NOT NULL AND meta->>'streamSeconds' IS NOT NULL
       ) x ORDER BY player, st, en DESC
     ), running AS (
       SELECT DISTINCT ON (player) player, coalesce((meta->>'startedAt')::timestamptz, at) AS st, now() AS en, NULL::text AS vod, true AS running
         FROM events s WHERE type = 'stream_start' AND at >= now() - interval '2 days' AND player IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.type = 'stream_end' AND e.player = s.player AND e.at >= s.at)
        ORDER BY player, at DESC
     ), streams AS (
       SELECT * FROM ended UNION ALL SELECT * FROM running r
        WHERE NOT EXISTS (SELECT 1 FROM ended d WHERE d.player = r.player AND d.en > r.st)
     )
     SELECT s.player, s.st, s.en, s.vod, s.running,
       (SELECT coalesce(sum(least(extract(epoch FROM nx - at), 300)) FILTER (WHERE nx - at <= interval '${COVER_GAP}'), 0) / 60
          FROM (SELECT h.at, h.viewers, h.online, lead(h.at) OVER (ORDER BY h.at) AS nx FROM player_history h
                 WHERE h.player = s.player AND h.at >= s.st AND h.at < s.en) x
         WHERE viewers IS NOT NULL AND online)::float8 AS server_min,
       (SELECT coalesce(sum(e.value), 0)::int FROM events e
         WHERE e.player = s.player AND e.at >= s.st AND e.at < s.en AND e.type IN ('subscription', 'subscription_gift')
           AND e.meta->>'serverOnline' = 'true' AND ${covered("e.player", "e.at")}) AS legacy,
       (SELECT coalesce(sum(c.bits) FILTER (WHERE c.on_server AND ${covered("c.channel_id", "c.at")}), 0)::int FROM twitch_cheers c
         WHERE c.channel_id = s.player AND c.at >= s.st AND c.at < s.en) AS bits_server,
       (SELECT coalesce(sum(c.bits), 0)::int FROM twitch_cheers c
         WHERE c.channel_id = s.player AND c.at >= s.st AND c.at < s.en) AS bits_all
     FROM streams s`,
    [SEASON_FROM],
  );

  // Einzelmeldungen: ein Community-Geschenk zählt einmal (größer aus Ankündigung und Einzelmeldungen),
  // Weitergaben zählen nicht (das Geschenk selbst kommt als eigene Meldung)
  const subRows = await db.query<{
    channel_id: string;
    at: Date;
    plan: string | null;
    units: number;
    gift: boolean;
    on_server: boolean;
  }>(
    `WITH grouped AS (
       SELECT channel_id, min(at) AS at, max(plan) AS plan, bool_or(on_server AND ${covered("t.channel_id", "t.at")}) AS on_server,
              greatest(coalesce(max(gift_count) FILTER (WHERE kind LIKE '%submysterygift'), 0),
                       count(*) FILTER (WHERE kind NOT LIKE '%submysterygift'))::int AS units
         FROM twitch_subs t WHERE gift_group IS NOT NULL GROUP BY channel_id, gift_group
     ), single AS (
       SELECT channel_id, at, plan, on_server AND ${covered("t.channel_id", "t.at")} AS on_server, kind,
              CASE WHEN kind LIKE '%submysterygift' THEN coalesce(gift_count, 0)
                   WHEN kind LIKE '%payforward' THEN 0 ELSE 1 END AS units
         FROM twitch_subs t WHERE gift_group IS NULL
     )
     SELECT channel_id, at, plan, units, true AS gift, on_server FROM grouped WHERE units > 0
     UNION ALL
     SELECT channel_id, at, plan, units, kind LIKE '%gift' AND kind NOT LIKE '%upgrade' AS gift, on_server FROM single WHERE units > 0
     ORDER BY at`,
  );
  const first = await db.query<{ at: Date | null }>(`SELECT min(at) AS at FROM twitch_subs`);
  const preciseFrom = first.rows[0]?.at ? first.rows[0].at.getTime() : null;
  // Abos werden erst seit diesem Zeitpunkt gezählt; frühere Streams hätten scheinbar keine Einnahmen
  const counted = await db.query<{ at: Date | null }>(
    `SELECT min(at) AS at FROM events WHERE type = 'subscription' AND meta->>'serverOnline' = 'true'`,
  );
  const countedFrom = counted.rows[0]?.at?.getTime() ?? Infinity;

  const byPlayer = new Map<string, BaseStream[]>();
  const streams: BaseStream[] = streamRows.rows
    .filter((r) => r.st.getTime() >= countedFrom)
    .map((r) => ({
      player: r.player,
      start: r.st.getTime(),
      end: r.en.getTime(),
      vod: r.vod,
      running: r.running,
      serverMin: r.server_min,
      legacy: r.legacy,
      bitsServer: r.bits_server,
      bitsAll: r.bits_all,
      precise: preciseFrom !== null && r.st.getTime() >= preciseFrom ? { server: noTiers(), all: noTiers() } : null,
    }))
    .sort((a, b) => a.start - b.start);
  for (const s of streams) {
    const list = byPlayer.get(s.player) ?? [];
    list.push(s);
    byPlayer.set(s.player, list);
  }
  for (const r of subRows.rows) {
    const t = r.at.getTime();
    const s = byPlayer.get(r.channel_id)?.find((x) => x.start <= t && t < x.end);
    if (!s?.precise) continue;
    const key = r.plan === "Prime" ? "prime" : r.plan === "3000" ? "t3" : r.plan === "2000" ? "t2" : "t1";
    for (const tiers of r.on_server ? [s.precise.server, s.precise.all] : [s.precise.all]) {
      tiers[key] += r.units;
      if (r.gift) tiers.gift += r.units;
    }
  }

  // Gegenprobe: abgeschlossene Streams mit beiden Zählungen
  let entries = 0;
  let netSum = 0;
  let units = 0;
  for (const s of streams) {
    if (!s.precise || s.running) continue;
    entries += s.legacy;
    netSum += tierNet(s.precise.server);
    units += tierUnits(s.precise.server);
  }
  const calibration =
    entries >= MIN_CALIBRATION
      ? {
          netPerEntry: netSum / entries,
          unitsPerEntry: units / entries,
          entries,
        }
      : null;
  return { streams, preciseFrom, calibration, loadedAt: Date.now() };
}

/* ------------------------------------------------------------------ Bewertung */

export interface EarningStream {
  player: string;
  start: number;
  end: number;
  vod: string | null;
  running: boolean;
  serverMin: number;
  streamMin: number;
  /** Abos auf dem Server (alte Streams: umgerechnet) */
  subs: number;
  bits: number;
  /** geschätzte Einnahmen auf dem Server, Euro */
  eur: number;
  /** genaue Erfassung: Stufen auf dem Server und Einnahmen im ganzen Stream */
  tiers: Tiers | null;
  eurAll: number | null;
}

export interface EarningPlayer {
  id: string;
  streams: number;
  hours: number;
  subs: number;
  gifted: number | null;
  bits: number;
  eur: number;
  perStream: number;
  perHour: number;
  /** €/h der letzten 7 Tage gegenüber den 7 Tagen davor (null: zu wenig Stunden) */
  trend: number | null;
  tiers: Tiers;
  /** Anteil der Stunden mit genauer Erfassung */
  preciseShare: number;
}

export interface Earnings {
  share: Share;
  preciseFrom: number | null;
  calibration: Base["calibration"];
  /** Wert je altem Eintrag, Euro nach Aufteilung */
  legacyEur: number;
  legacyUnits: number;
  players: EarningPlayer[];
  /** Tage (Berlin) nach Streamstart, aufsteigend */
  days: string[];
  /** Euro je Spieler und Tag, Index wie `days` */
  daily: Record<string, number[]>;
  /** Stunden auf dem Server je Spieler und Tag */
  dailyHours: Record<string, number[]>;
  totals: {
    eur: number;
    hours: number;
    subs: number;
    bits: number;
    streams: number;
  };
  from: number | null;
  to: number | null;
}

const berlinDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function value(b: Base, s: BaseStream, share: number): EarningStream {
  const legacyNet = b.calibration?.netPerEntry ?? net(SUB_PRICE_EUR.t1);
  const legacyUnits = b.calibration?.unitsPerEntry ?? 1;
  const bitsEur = s.bitsServer * BIT_EUR;
  const p = s.precise;
  return {
    player: s.player,
    start: s.start,
    end: s.end,
    vod: s.vod,
    running: s.running,
    serverMin: s.serverMin,
    streamMin: Math.round((s.end - s.start) / 60_000),
    subs: p ? tierUnits(p.server) : s.legacy * legacyUnits,
    bits: s.bitsServer,
    eur: (p ? tierNet(p.server) : s.legacy * legacyNet) * share + bitsEur,
    tiers: p ? p.server : null,
    eurAll: p ? tierNet(p.all) * share + s.bitsAll * BIT_EUR : null,
  };
}

const swr = createSwrCache();
const getBase = () => swr("earnings-base", BASE_CACHE_MS, loadBase);

export const parseShare = (v: unknown): Share => (SHARES.includes(Number(v) as Share) ? (Number(v) as Share) : 50);

export async function getEarnings(share: Share): Promise<Earnings> {
  const b = await getBase();
  const f = share / 100;
  const streams = b.streams.filter((s) => s.serverMin >= MIN_STREAM_MIN).map((s) => value(b, s, f));
  const days = [...new Set(streams.map((s) => berlinDay.format(s.start)))].sort();
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const daily: Record<string, number[]> = {};
  const dailyHours: Record<string, number[]> = {};
  const now = b.loadedAt;
  const agg = new Map<
    string,
    {
      list: EarningStream[];
      recent: [number, number];
      before: [number, number];
    }
  >();
  for (const s of streams) {
    const di = dayIndex.get(berlinDay.format(s.start))!;
    (daily[s.player] ??= days.map(() => 0))[di] += s.eur;
    (dailyHours[s.player] ??= days.map(() => 0))[di] += s.serverMin / 60;
    const a = agg.get(s.player) ?? { list: [], recent: [0, 0], before: [0, 0] };
    a.list.push(s);
    const age = now - s.start;
    const slot = age < 7 * DAY_MS ? a.recent : age < 14 * DAY_MS ? a.before : null;
    if (slot) {
      slot[0] += s.eur;
      slot[1] += s.serverMin / 60;
    }
    agg.set(s.player, a);
  }
  const players: EarningPlayer[] = [...agg].map(([id, a]) => {
    const hours = a.list.reduce((x, s) => x + s.serverMin, 0) / 60;
    const eur = a.list.reduce((x, s) => x + s.eur, 0);
    const tiers = noTiers();
    let preciseHours = 0;
    for (const s of a.list) {
      if (!s.tiers) continue;
      preciseHours += s.serverMin / 60;
      for (const k of ["t1", "t2", "t3", "prime", "gift"] as const) tiers[k] += s.tiers[k];
    }
    const enough = a.recent[1] >= 3 && a.before[1] >= 3;
    return {
      id,
      streams: a.list.length,
      hours,
      subs: a.list.reduce((x, s) => x + s.subs, 0),
      gifted: preciseHours > 0 ? tiers.gift : null,
      bits: a.list.reduce((x, s) => x + s.bits, 0),
      eur,
      perStream: eur / a.list.length,
      perHour: hours > 0 ? eur / hours : 0,
      trend: enough && a.before[0] > 0 ? a.recent[0] / a.recent[1] / (a.before[0] / a.before[1]) - 1 : null,
      tiers,
      preciseShare: hours > 0 ? preciseHours / hours : 0,
    };
  });
  players.sort((x, y) => y.eur - x.eur);
  const totals = {
    eur: players.reduce((x, p) => x + p.eur, 0),
    hours: players.reduce((x, p) => x + p.hours, 0),
    subs: players.reduce((x, p) => x + p.subs, 0),
    bits: players.reduce((x, p) => x + p.bits, 0),
    streams: streams.length,
  };
  return {
    share,
    preciseFrom: b.preciseFrom,
    calibration: b.calibration,
    legacyEur: (b.calibration?.netPerEntry ?? net(SUB_PRICE_EUR.t1)) * f,
    legacyUnits: b.calibration?.unitsPerEntry ?? 1,
    players,
    days,
    daily,
    dailyHours,
    totals,
    from: streams.length ? streams[0].start : null,
    to: streams.length ? Math.max(...streams.map((s) => s.end)) : null,
  };
}

/** Streams eines Spielers, neueste zuerst */
export async function getEarningStreams(id: string, share: Share): Promise<EarningStream[]> {
  const b = await getBase();
  return b.streams
    .filter((s) => s.player === id && s.serverMin >= MIN_STREAM_MIN)
    .map((s) => value(b, s, share / 100))
    .reverse();
}
