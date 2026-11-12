import "server-only";
import { getDb } from "./db";
import { COUNTER_EVENT_MIN } from "./events";
import { EXTRA_EVENT_MIN } from "./extraEvents";
import { getFeedFilter, getFeedMin } from "./feedThresholds";
import { EXTRA_HISTORY_KEYS, EXTRA_STATS, extraStatSql, type ExtraStatKey } from "./playerStats";
import { BOARD_KEYS, type BoardKey, type TrackerEvent } from "./types";

/**
 * Alles für die Detailseite eines Ereignisses (Vorschau unter /vorschau/<key>/ereignis/<id>): das Ereignis, was der
 * Spieler davor und danach erlebte, was gleichzeitig sonst passierte, wer gerade da war, Verläufe ±3 Stunden, die
 * Rohdaten dahinter (auch Zuwächse, die kein Ereignis wurden) und wann es dieselbe Art sonst gab – beim Spieler und bei
 * allen. Nur Abfragen über vorhandene Indizes (events (player, at), (type, at), player_history (player, at)).
 */

export type ChartFormat = "num" | "distance" | "duration" | "hearts";
/** [Zeitpunkt ms, Wert oder null = Lücke] */
export type ChartPoint = [number, number | null];

export interface Occurrences {
  /** [Zeitpunkt ms, Stärke, Index in `who` (nur bei allen), Index in `ids`] */
  points: [number, number, number, number][];
  ids: string[];
  /** Spieler: [id, Name, UUID] */
  who: [string, string, string][];
  /** Platz dieses Ereignisses nach Stärke (1 = stärkstes) und Anzahl insgesamt */
  rank: number;
  total: number;
  /** Nur ein Ausschnitt gezeigt (die stärksten bzw. neuesten) */
  partial: boolean;
}

export interface EventDetail {
  event: TrackerEvent;
  /** Stärke des Ereignisses (Zuwachs, sonst Wert, sonst 1) */
  intensity: number;
  before: TrackerEvent[];
  after: TrackerEvent[];
  /** Andere Ereignisse ±15 Minuten (ohne das Ereignis selbst) */
  around: TrackerEvent[];
  /** Gleiche Art beim selben Spieler (ohne Spieler: alle) */
  same: { prev: TrackerEvent | null; next: TrackerEvent | null; nth: number; total: number };
  window: { from: number; to: number };
  /** Betroffener Zähler des Spielers, falls das Ereignis einen hat */
  stat: {
    key: string;
    /** Kennzahl für /graph */
    metric: string;
    label: string;
    format: ChartFormat;
    points: ChartPoint[];
    /** Zuwachs je Messung (auch unter der Schwelle): [Zeitpunkt ms, Zuwachs] */
    steps: [number, number][];
    /** Ab diesem Zuwachs je Messung legt der Tracker ein Ereignis an (null = nie, nur Meilensteine) */
    eventMin: number | null;
    /** Ab diesem Zuwachs erscheint es an diesem Tag im Feed */
    feedMin: number | null;
    /** Mehrere Messungen in Folge über der Ereignis-Schwelle, dieses Ereignis mittendrin */
    streak: { count: number; from: number; to: number; sum: number } | null;
    /** Einheit der Säulen, z. B. „/Min“ */
    per: string | null;
    /** false = nur Verlauf (z. B. online ja/nein), keine Rohdaten-Säulen */
    hasSteps: boolean;
  } | null;
  /** Zuschauer des Spielers (null = nicht live) */
  viewers: ChartPoint[];
  /** Spieler auf dem Server (ganzer Server) */
  online: ChartPoint[];
  /** Wer in diesem Moment da war: id → online/live/Zuschauer */
  present: { id: string; online: boolean; viewers: number | null }[];
  /** Dieselbe Art beim selben Spieler über die ganze Staffel */
  mine: Occurrences | null;
  /** Familie (Zähler/Kennzahl) mit Meilensteinen und Rängen des Spielers und dem, was in denselben Minuten dazugehört */
  related: {
    family: string;
    label: string;
    ladder: TrackerEvent[];
    together: TrackerEvent[];
    /** Meilenstein/Rang ohne eigenes Zähler-Ereignis: der auslösende Zuwachs aus den Rohdaten */
    cause: { at: number; d: number; eventMin: number | null } | null;
  } | null;
  /**
   * Häufigkeit statt Stärke, wenn alle Ereignisse dieser Art gleich stark sind (Chat, Stream-Start, Join, …):
   * `days` = Berliner Tage der Staffel mit Ereignissen; `mine` = je Tag Anzahl und erstes Ereignis des Spielers;
   * `matrix` = die aktivsten Spieler (und dieser) je Tag.
   */
  frequency: {
    days: string[];
    mine: { day: string; n: number; first: string }[];
    players: string[];
    /** [Index in players, Index in days, Anzahl, erstes Ereignis an diesem Tag] */
    cells: [number, number, number, string][];
    total: number;
  } | null;
  /** Dieselbe Art bei allen Spielern (die stärksten) */
  all: Occurrences;
}

interface Row {
  id: string;
  at: Date;
  type: TrackerEvent["type"];
  player: string | null;
  player_name: string | null;
  uuid: string | null;
  where: TrackerEvent["where"];
  delta: number | null;
  value: number | null;
  meta: TrackerEvent["meta"] | null;
}
const COLS = `id, at, type, player, player_name, uuid, "where", delta, value, meta`;
function toEvent(r: Row): TrackerEvent {
  const e: TrackerEvent = { id: r.id, at: r.at.toISOString(), type: r.type, where: r.where };
  if (r.player) e.player = r.player;
  if (r.player_name) e.playerName = r.player_name;
  if (r.uuid) e.uuid = r.uuid;
  if (r.delta !== null) e.delta = Number(r.delta);
  if (r.value !== null) e.value = Number(r.value);
  if (r.meta) e.meta = r.meta;
  return e;
}

/** Stärke eines Ereignisses: Abos nach Anzahl, sonst Zuwachs, sonst Wert (Raid-Zuschauer, Meilenstein), sonst 1 */
// Rang: Platz 1 ist der stärkste (4 − Platz, die Top 3 → 3, 2, 1)
// Rekord: die Höhe des Rekords (nicht der Abstand zum alten), so wird sein Verlauf eine Treppe
const INTENSITY = `CASE WHEN type IN ('subscription', 'record') THEN coalesce(value, delta, 1) WHEN type = 'rank' THEN 4 - coalesce(value, 3) ELSE coalesce(delta, value, 1) END`;
const intensityOf = (e: TrackerEvent) =>
  e.type === "subscription" || e.type === "record" ? (e.value ?? e.delta ?? 1) : e.type === "rank" ? 4 - (e.value ?? 3) : (e.delta ?? e.value ?? 1);

/**
 * Familie eines Ereignisses: der Zähler bzw. die Kennzahl, zu der es gehört. Meilensteine und Ränge nennen ihn in
 * meta.board, Rekorde in meta.key; Zähler-Ereignisse heißen wie ihr Zähler (Tode: „death“ ↔ Zähler „deaths“).
 * `field` = Feld in meta, das bei „gleicher Art“ mit übereinstimmen muss.
 */
function familyOf(e: TrackerEvent): { family: string; field: "board" | "key" | null } | null {
  if ((e.type === "milestone" || e.type === "rank") && typeof e.meta?.board === "string") return { family: e.meta.board, field: "board" };
  if (e.type === "record" && typeof e.meta?.key === "string") return { family: e.meta.key, field: "key" };
  if (e.type === "death") return { family: "deaths", field: null };
  if ((BOARD_KEYS as string[]).includes(e.type) || e.type in EXTRA_STATS) return { family: e.type, field: null };
  return null;
}
/** Rekord → Ereignis-Arten, die ihn auslösen können, und umgekehrt */
const RECORD_CAUSES: Record<string, string[]> = { peakOnline: ["join", "first_join"], peakLive: ["stream_start"], peakViewers: ["raid", "stream_start"] };
const RECORD_CAUSED_BY: Partial<Record<TrackerEvent["type"], string[]>> = {
  join: ["peakOnline"],
  first_join: ["peakOnline"],
  stream_start: ["peakLive", "peakViewers"],
  raid: ["peakViewers"],
};
const EVENT_LABEL_FALLBACK = "Rekord";

/** Anzeigename einer Familie */
function familyLabel(f: string): string {
  if ((BOARD_KEYS as string[]).includes(f)) return BOARD_LABEL[f as BoardKey];
  if (f in EXTRA_STATS) return EXTRA_STATS[f as ExtraStatKey].label;
  return RECORD_SERIES[f]?.label ?? f;
}
/** Zähler-Ereignistyp einer Familie (Tode heißen als Ereignis „death“) */
const counterType = (family: string) => (family === "deaths" ? "death" : family);

/** Rekord → die Kennzahl des Servers, deren Höchstwert er ist (Spalte in `history`, Kennzahl für /graph) */
const RECORD_SERIES: Record<string, { col: "online_count" | "viewers" | "live_count"; metric: string; label: string }> = {
  peakOnline: { col: "online_count", metric: "onlineCount", label: "Spieler gleichzeitig online" },
  peakViewers: { col: "viewers", metric: "viewers", label: "Zuschauer aller Streams" },
  peakLive: { col: "live_count", metric: "liveCount", label: "Streams gleichzeitig live" },
};

const BOARD_COL: Record<BoardKey, string> = {
  playtimeSeconds: "playtime_seconds",
  diamonds: "diamonds",
  deaths: "deaths",
  blocksBroken: "blocks_broken",
  mobsKilled: "mobs_killed",
  distance: "distance",
  damageDealt: "damage_dealt",
  totemsUsed: "totems_used",
  foodEaten: "food_eaten",
};
const BOARD_LABEL: Record<BoardKey, string> = {
  playtimeSeconds: "Spielzeit",
  diamonds: "Diamanten",
  deaths: "Tode",
  blocksBroken: "Blöcke abgebaut",
  mobsKilled: "Mobs getötet",
  distance: "Strecke",
  damageDealt: "Schaden ausgeteilt",
  totemsUsed: "Totems benutzt",
  foodEaten: "Essen gegessen",
};
const BOARD_FORMAT: Partial<Record<BoardKey, ChartFormat>> = { playtimeSeconds: "duration", distance: "distance", damageDealt: "hearts" };

/** Welcher Zähler zu einem Ereignis gehört (Spalte aus fester Liste, nie aus der Anfrage) */
/**
 * Datenquelle des Verlaufs: `history` = Spalte in player_history (Zuwachs je Messung), `rate` = ebenso, aber die
 * Säulen als Zuwachs je Minute (die Tracker-Schwelle ist eine Rate), `subs`/`cheers` = Twitch-Tabellen,
 * `state` = nur Verlauf ohne Säulen (z. B. online ja/nein).
 */
type StatSource = "history" | "rate" | "subs" | "cheers" | "state" | "server";
interface StatDef {
  key: string;
  metric: string;
  label: string;
  format: ChartFormat;
  source: StatSource;
  /** SQL-Ausdruck auf player_history (nur history/rate/state) */
  sql: string;
  eventMin: number | null;
  /** Ereignis ist ein Zuwachs dieses Werts (dann gilt die Feed-Schwelle) */
  isStep: boolean;
  maxStepMs: number;
  /** Text hinter dem Säulen-Wert, z. B. „/Min“ */
  per?: string;
  /** Feed-Schwelle unter diesem Typ nachsehen (Abo-Geschenke zählen wie Abos) */
  feedType?: TrackerEvent["type"];
}

function statOf(e: TrackerEvent): StatDef | null {
  // Twitch und Anwesenheit: eigene Quellen
  switch (e.type) {
    case "record": {
      // Rekord: Verlauf der Server-Kennzahl, deren Höchstwert er ist
      const r = RECORD_SERIES[String(e.meta?.key ?? "")];
      return r ? { key: String(e.meta?.key), metric: r.metric, label: r.label, format: "num", source: "server", sql: r.col, eventMin: null, isStep: false, maxStepMs: 0 } : null;
    }
    case "follower_burst":
      // Tracker: mehr als 20 neue Follower je Minute, während der Streamer auf dem Server ist
      return { key: "followers", metric: "followers", label: "Neue Follower auf dem Server", format: "num", source: "rate", sql: "followers_on_server", eventMin: 20, isStep: false, maxStepMs: 10 * 60_000, per: "/Min" };
    case "subscription":
    case "subscription_gift":
      return { key: "twitchSubs", metric: "twitchSubs", label: "Abos im Kanal", format: "num", source: "subs", sql: "", eventMin: 1, isStep: true, maxStepMs: 0, per: "/Min", feedType: "subscription" };
    case "cheer":
      // Tracker: einzelner Cheer ab 1.000 Bits, während der Streamer auf dem Server ist (CA_CHEER_EVENT_MIN)
      return { key: "twitchBits", metric: "twitchBits", label: "Bits im Kanal", format: "num", source: "cheers", sql: "", eventMin: Number(process.env.CA_CHEER_EVENT_MIN ?? 1000), isStep: false, maxStepMs: 0 };
    case "join":
    case "leave":
    case "first_join":
      return { key: "online", metric: "online", label: "Auf dem Server (1 = ja)", format: "num", source: "state", sql: "(CASE WHEN online THEN 1 ELSE 0 END)", eventMin: null, isStep: false, maxStepMs: 0 };
  }
  const k =
    e.type === "milestone" || e.type === "rank"
      ? String(e.meta?.board ?? "")
      : e.type === "death"
        ? "deaths"
        : e.type.startsWith("afk_")
          ? "afkSeconds"
          : e.type;
  // Zuwachs-Ereignis dieses Zählers (bei Meilensteinen gibt es keine Feed-Schwelle für den Meilenstein selbst)
  const isStep = e.type === k || (e.type === "death" && k === "deaths");
  if ((BOARD_KEYS as string[]).includes(k)) {
    const b = k as BoardKey;
    return { key: b, metric: b, label: BOARD_LABEL[b], format: BOARD_FORMAT[b] ?? "num", source: "history", sql: BOARD_COL[b], eventMin: COUNTER_EVENT_MIN[b] ?? 1, isStep, maxStepMs: 5 * 60_000 };
  }
  if (k in EXTRA_STATS && (EXTRA_HISTORY_KEYS as readonly string[]).includes(k)) {
    const x = EXTRA_STATS[k as ExtraStatKey];
    return { key: k, metric: x.metric as string, label: x.label as string, format: x.format as ChartFormat, source: "history", sql: extraStatSql(k as ExtraStatKey), eventMin: EXTRA_EVENT_MIN[k as ExtraStatKey] ?? null, isStep, maxStepMs: 30 * 60_000 };
  }
  return null;
}

const HOUR = 3600_000;
const AROUND = 15 * 60_000;
const MINE_LIMIT = 2500;
const ALL_LIMIT = 300;
/** Häufigkeits-Matrix: so viele der aktivsten Spieler als Zeilen */
const FREQ_PLAYERS = 25;

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const db = await getDb();
  const row = (await db.query<Row>(`SELECT ${COLS} FROM events WHERE id = $1`, [id])).rows[0];
  if (!row) return null;
  const event = toEvent(row);
  const t = row.at;
  const at = t.getTime();
  const intensity = intensityOf(event);
  const [isShown, feedMin] = await Promise.all([getFeedFilter(), getFeedMin()]);
  const shown = (rows: Row[]) => rows.map(toEvent).filter((e) => e.id !== id && isShown(e));
  const from = at - 3 * HOUR;
  const to = at + 3 * HOUR;
  const stat = statOf(event);
  const p = event.player ?? null;
  // Meilensteine und Ränge nur desselben Zählers, Rekorde derselben Kennzahl gelten als „gleiche Art“
  const fam = familyOf(event);
  const board = fam?.field ? fam.family : null;
  const sameSql = (n: number) => `type = $1${board ? ` AND meta->>'${fam!.field}' = $${n}` : ""}`;
  const sameArgs = board ? [board] : [];

  const [beforeRows, afterRows, aroundRows, prevRow, nextRow, counts, hist, srv, present, mineRows, mineRank, allRows, allRank] = await Promise.all([
    p ? db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at <= $2 AND id <> $3 ORDER BY at DESC LIMIT 120`, [p, t, id]) : null,
    p ? db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at >= $2 AND id <> $3 ORDER BY at LIMIT 120`, [p, t, id]) : null,
    db.query<Row>(`SELECT ${COLS} FROM events WHERE at BETWEEN $1 AND $2 ORDER BY at LIMIT 600`, [new Date(at - AROUND), new Date(at + AROUND)]),
    db.query<Row>(`SELECT ${COLS} FROM events WHERE ${sameSql(3)} AND at < $2 ${p ? `AND player = $${board ? 4 : 3}` : ""} ORDER BY at DESC LIMIT 1`, [event.type, t, ...sameArgs, ...(p ? [p] : [])]),
    db.query<Row>(`SELECT ${COLS} FROM events WHERE ${sameSql(3)} AND at > $2 ${p ? `AND player = $${board ? 4 : 3}` : ""} ORDER BY at LIMIT 1`, [event.type, t, ...sameArgs, ...(p ? [p] : [])]),
    db.query<{ nth: string; total: string }>(
      `SELECT count(*) FILTER (WHERE at <= $2) AS nth, count(*) AS total FROM events WHERE ${sameSql(3)} ${p ? `AND player = $${board ? 4 : 3}` : ""}`,
      [event.type, t, ...sameArgs, ...(p ? [p] : [])],
    ),
    p
      ? db.query<{ at: Date; online: boolean; viewers: number | null; v: number | null }>(
          `SELECT at, online, viewers, ${stat?.sql && stat.source !== "server" ? stat.sql : "NULL"} AS v FROM player_history WHERE player = $1 AND at BETWEEN $2 AND $3 ORDER BY at`,
          [p, new Date(from), new Date(to)],
        )
      : null,
    db.query<{ at: Date; online_count: number; viewers: number; live_count: number }>(`SELECT at, online_count, viewers, live_count FROM history WHERE at BETWEEN $1 AND $2 ORDER BY at`, [new Date(from), new Date(to)]),
    db.query<{ player: string; online: boolean; viewers: number | null }>(
      `SELECT DISTINCT ON (player) player, online, viewers FROM player_history
        WHERE at BETWEEN $1 AND $2 AND (online OR viewers IS NOT NULL)
        ORDER BY player, abs(extract(epoch FROM at - $3::timestamptz))`,
      [new Date(at - 2 * 60_000), new Date(at + 60_000), t],
    ),
    // Dieselbe Art beim Spieler: die neuesten MINE_LIMIT (fast immer alle)
    p
      ? db.query<{ id: string; at: Date; i: number }>(
          `SELECT id, at, ${INTENSITY} AS i FROM events WHERE player = $2 AND ${sameSql(3)} AND coalesce(meta->>'catchUp', '') <> 'true' ORDER BY at DESC LIMIT ${MINE_LIMIT}`,
          [event.type, p, ...sameArgs],
        )
      : null,
    p
      ? db.query<{ rank: string; total: string }>(
          `SELECT count(*) FILTER (WHERE ${INTENSITY} > $3) + 1 AS rank, count(*) AS total FROM events WHERE player = $2 AND ${sameSql(4)} AND coalesce(meta->>'catchUp', '') <> 'true'`,
          [event.type, p, intensity, ...sameArgs],
        )
      : null,
    // Dieselbe Art bei allen: die stärksten ALL_LIMIT
    db.query<{ id: string; at: Date; i: number; player: string | null }>(
      `SELECT id, at, ${INTENSITY} AS i, player FROM events WHERE ${sameSql(2)} AND coalesce(meta->>'catchUp', '') <> 'true' ORDER BY ${INTENSITY} DESC, at LIMIT ${ALL_LIMIT}`,
      [event.type, ...sameArgs],
    ),
    db.query<{ rank: string; total: string }>(
      `SELECT count(*) FILTER (WHERE ${INTENSITY} > $2) + 1 AS rank, count(*) AS total FROM events WHERE ${sameSql(3)} AND coalesce(meta->>'catchUp', '') <> 'true'`,
      [event.type, intensity, ...sameArgs],
    ),
  ]);

  // Verläufe: Zähler nur aus Zeilen mit Wert (Zusatzwerte stehen nur alle 5 Min drin), Lücke nur bei echten Pausen
  const statPoints: ChartPoint[] = [];
  const steps: [number, number][] = [];
  const viewers: ChartPoint[] = [];
  let lastAt = 0;
  let lastStat: [number, number] | null = null;
  for (const r of hist?.rows ?? []) {
    const ms = r.at.getTime();
    if (lastAt && ms - lastAt > 10 * 60_000) viewers.push([lastAt + 60_000, null]);
    lastAt = ms;
    viewers.push([ms, r.viewers]);
    if (!stat || r.v === null) continue;
    const v = Number(r.v);
    if (lastStat && ms - lastStat[0] > 15 * 60_000) statPoints.push([lastStat[0] + 60_000, null]);
    statPoints.push([ms, v]);
    // Zuwachs je Messung (wie der Tracker ihn sieht; nach langen Pausen keiner, das wäre ein Sammel-Sprung)
    // „rate“: als Zuwachs je Minute (die Schwelle des Trackers ist eine Rate); „state“: keine Säulen
    if (stat.source !== "state" && lastStat && ms - lastStat[0] <= stat.maxStepMs) {
      const d = Math.max(0, v - lastStat[1]);
      steps.push([ms, stat.source === "rate" ? d / Math.max(1, (ms - lastStat[0]) / 60_000) : d]);
    }
    lastStat = [ms, v];
  }

  // Twitch: Summe im Ausschnitt als Linie, Abos je Minute bzw. jeder Cheer als Säule. Abos aus den Minuten-Ereignissen
  // („subscription“, Anzahl je Minute im Kanal, auch unter der Feed-Schwelle) – twitch_subs ist nicht für die ganze
  // Staffel gefüllt.
  if (p && (stat?.source === "subs" || stat?.source === "cheers")) {
    const rows = (
      stat.source === "subs"
        ? await db.query<{ at: Date; n: string }>(
            `SELECT at, coalesce(value, delta, 0) AS n FROM events WHERE player = $1 AND type = 'subscription' AND at BETWEEN $2 AND $3 ORDER BY at`,
            [p, new Date(from), new Date(to)],
          )
        : await db.query<{ at: Date; n: string }>(`SELECT at, bits AS n FROM twitch_cheers WHERE channel_id = $1 AND at BETWEEN $2 AND $3 ORDER BY at`, [p, new Date(from), new Date(to)])
    ).rows;
    let sum = 0;
    statPoints.push([from, 0]);
    for (const r of rows) {
      const n = Number(r.n);
      if (n <= 0) continue;
      statPoints.push([r.at.getTime(), sum]);
      sum += n;
      statPoints.push([r.at.getTime(), sum]);
      steps.push([r.at.getTime(), n]);
    }
    statPoints.push([Math.min(to, Date.now()), sum]);
  }

  // Rekord: Verlauf der Server-Kennzahl aus `history`
  if (stat?.source === "server") {
    const col = stat.sql as "online_count" | "viewers" | "live_count";
    for (const r of srv.rows) statPoints.push([r.at.getTime(), Number(r[col])]);
  }

  // Der Zuwachs des Ereignisses selbst fehlt, wenn die Messungen davor eine Pause hatten: aus dem Ereignis ergänzen
  if (stat?.isStep && stat.source === "history" && event.delta !== undefined && !steps.some(([ms, dd]) => Math.abs(ms - at) < 30_000 && dd > 0)) {
    const dup = steps.findIndex(([ms]) => Math.abs(ms - at) < 30_000);
    if (dup >= 0) steps.splice(dup, 1);
    steps.push([at, event.delta]);
    steps.sort((a, b) => a[0] - b[0]);
  }

  // Serie: Messungen in Folge über der Ereignis-Schwelle rund um dieses Ereignis
  let streak: NonNullable<EventDetail["stat"]>["streak"] = null;
  if (stat && stat.eventMin !== null && steps.length) {
    let k = 0;
    for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i][0] - at) < Math.abs(steps[k][0] - at)) k = i;
    if (Math.abs(steps[k][0] - at) < 3 * 60_000 && steps[k][1] >= stat.eventMin) {
      let a = k;
      let b = k;
      while (a > 0 && steps[a - 1][1] >= stat.eventMin) a--;
      while (b < steps.length - 1 && steps[b + 1][1] >= stat.eventMin) b++;
      if (b > a) streak = { count: b - a + 1, from: steps[a][0], to: steps[b][0], sum: steps.slice(a, b + 1).reduce((s, x) => s + x[1], 0) };
    }
  }

  // Zusammenhänge in derselben Familie: Meilensteine und Ränge des Spielers über die Staffel, und was in denselben
  // Minuten dazugehört (der Zuwachs, der einen Meilenstein brachte; der Rang, den er kostete; …)
  let related: EventDetail["related"] = null;
  if (fam && fam.field !== "key") {
    const [ladderRows, togetherRows] = await Promise.all([
      p
        ? db.query<Row>(
            `SELECT ${COLS} FROM events WHERE player = $1 AND type IN ('milestone', 'rank') AND meta->>'board' = $2 ORDER BY at LIMIT 400`,
            [p, fam.family],
          )
        : null,
      db.query<Row>(
        `SELECT ${COLS} FROM events
          WHERE at BETWEEN $1 AND $2 AND id <> $3 ${p ? "AND player = $6" : ""}
            AND ((type IN ('milestone', 'rank') AND meta->>'board' = $4) OR type = $5)
          ORDER BY at LIMIT 20`,
        [new Date(at - 2 * 60_000), new Date(at + 2 * 60_000), id, fam.family, counterType(fam.family), ...(p ? [p] : [])],
      ),
    ]);
    const together = togetherRows.rows.map(toEvent).filter((x) => x.meta?.catchUp !== true);
    // Meilenstein/Rang ohne eigenes Zähler-Ereignis: der Zuwachs unter der Schwelle, der ihn ausgelöst hat (Rohdaten)
    let cause: { at: number; d: number; eventMin: number | null } | null = null;
    if ((event.type === "milestone" || event.type === "rank") && !together.some((x) => x.type === counterType(fam.family)) && steps.length) {
      let k = -1;
      for (let i = 0; i < steps.length; i++) {
        if (steps[i][1] <= 0 || Math.abs(steps[i][0] - at) > 3 * 60_000) continue;
        if (k < 0 || Math.abs(steps[i][0] - at) < Math.abs(steps[k][0] - at)) k = i;
      }
      if (k >= 0) cause = { at: steps[k][0], d: steps[k][1], eventMin: stat?.eventMin ?? null };
    }
    related = { family: fam.family, label: familyLabel(fam.family), ladder: ladderRows ? ladderRows.rows.map(toEvent) : [], together, cause };
  } else if (fam?.field === "key" || RECORD_CAUSED_BY[event.type]) {
    // Rekord ↔ was ihn auslöste: neuer Höchstwert an Spielern online ← Join, Streams live ← Stream-Start,
    // Zuschauer ← Raid/Stream-Start. Rekord: Auslöser bis 2 Min davor; Auslöser: Rekord bis 2 Min danach.
    const isRecord = fam?.field === "key";
    const rows = (
      isRecord
        ? await db.query<Row>(
            `SELECT ${COLS} FROM events WHERE at BETWEEN $1 AND $2 AND type = ANY($3) ORDER BY at DESC LIMIT 12`,
            [new Date(at - 2 * 60_000), new Date(at + 30_000), RECORD_CAUSES[fam!.family] ?? []],
          )
        : await db.query<Row>(
            `SELECT ${COLS} FROM events WHERE at BETWEEN $1 AND $2 AND type = 'record' AND meta->>'key' = ANY($3) ORDER BY at LIMIT 6`,
            [new Date(at - 30_000), new Date(at + 2 * 60_000), RECORD_CAUSED_BY[event.type] ?? []],
          )
    ).rows;
    related = {
      family: isRecord ? fam!.family : event.type,
      label: isRecord ? familyLabel(fam!.family) : EVENT_LABEL_FALLBACK,
      ladder: [],
      together: rows.map(toEvent).filter((x) => x.id !== id),
      cause: null,
    };
  }

  // Alle gleich stark (z. B. Chat: immer 1)? Dann zählt, wie oft – je Tag und Spieler
  let frequency: EventDetail["frequency"] = null;
  const spread = (
    await db.query<{ lo: number | null; hi: number | null }>(
      `SELECT min(${INTENSITY}) AS lo, max(${INTENSITY}) AS hi FROM events WHERE ${sameSql(2)}`,
      [event.type, ...sameArgs],
    )
  ).rows[0];
  if (spread && spread.lo !== null && Number(spread.lo) === Number(spread.hi)) {
    const rows = (
      await db.query<{ player: string; day: string; n: string; first: string }>(
        `WITH d AS (
           SELECT player, to_char(at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day, count(*) AS n,
                  (array_agg(id ORDER BY at))[1] AS first
             FROM events WHERE ${sameSql(2)} AND player IS NOT NULL GROUP BY 1, 2
         ), top AS (
           SELECT player FROM d GROUP BY 1 ORDER BY sum(n) DESC LIMIT ${FREQ_PLAYERS}
         )
         SELECT d.player, d.day, d.n, d.first FROM d
          WHERE d.player IN (SELECT player FROM top) OR d.player = $${board ? 3 : 2}
          ORDER BY d.day`,
        [event.type, ...sameArgs, p ?? ""],
      )
    ).rows;
    const days = [...new Set(rows.map((r) => r.day))].sort();
    // Zeilen: nach Anzahl insgesamt, dieser Spieler immer dabei
    const sums = new Map<string, number>();
    for (const r of rows) sums.set(r.player, (sums.get(r.player) ?? 0) + Number(r.n));
    const players = [...sums.keys()].sort((a, b) => sums.get(b)! - sums.get(a)!);
    const pi = new Map(players.map((x, i) => [x, i]));
    const di = new Map(days.map((x, i) => [x, i]));
    frequency = {
      days,
      mine: rows.filter((r) => r.player === p).map((r) => ({ day: r.day, n: Number(r.n), first: r.first })),
      players,
      cells: rows.map((r) => [pi.get(r.player)!, di.get(r.day)!, Number(r.n), r.first] as [number, number, number, string]),
      total: Number(counts.rows[0]?.total ?? 0),
    };
  }

  const occ = (rows: { id: string; at: Date; i: number; player?: string | null }[], rank: { rank: string; total: string } | undefined, withWho: boolean, limit: number): Occurrences => {
    const list = rows.some((r) => r.id === id) ? rows : [...rows, { id, at: t, i: intensity, player: p }];
    const whoIdx = new Map<string, number>();
    const who: [string, string, string][] = [];
    const points = list.map((r, k) => {
      let w = -1;
      if (withWho && r.player) {
        if (!whoIdx.has(r.player)) {
          whoIdx.set(r.player, who.length);
          who.push([r.player, "", ""]);
        }
        w = whoIdx.get(r.player)!;
      }
      return [r.at.getTime(), Number(r.i), w, k] as [number, number, number, number];
    });
    return { points, ids: list.map((r) => r.id), who, rank: Number(rank?.rank ?? 1), total: Number(rank?.total ?? list.length), partial: rows.length >= limit };
  };

  const statFull = stat && statPoints.some(([, v]) => v !== null)
    ? {
        key: stat.key,
        metric: stat.metric,
        label: stat.label,
        format: stat.format,
        points: statPoints,
        steps,
        eventMin: stat.eventMin,
        feedMin: stat.isStep ? (feedMin(stat.feedType ?? event.type, event.at) ?? null) : null,
        per: stat.per ?? null,
        hasSteps: stat.source !== "state",
        streak,
      }
    : null;

  return {
    event,
    intensity,
    before: beforeRows ? shown(beforeRows.rows).slice(0, 10).reverse() : [],
    after: afterRows ? shown(afterRows.rows).slice(0, 10) : [],
    around: shown(aroundRows.rows).filter((e) => e.player !== p),
    same: {
      prev: prevRow.rows[0] ? toEvent(prevRow.rows[0]) : null,
      next: nextRow.rows[0] ? toEvent(nextRow.rows[0]) : null,
      nth: Number(counts.rows[0]?.nth ?? 0),
      total: Number(counts.rows[0]?.total ?? 0),
    },
    window: { from, to },
    stat: statFull,
    viewers: viewers.some(([, v]) => v !== null) ? viewers : [],
    online: srv.rows.map((r) => [r.at.getTime(), r.online_count] as ChartPoint),
    present: present.rows.map((r) => ({ id: r.player, online: r.online, viewers: r.viewers })),
    mine: mineRows ? occ(mineRows.rows, mineRank?.rows[0], false, MINE_LIMIT) : null,
    all: occ(allRows.rows, allRank.rows[0], true, ALL_LIMIT),
    related,
    frequency,
  };
}
