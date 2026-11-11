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
  } | null;
  /** Zuschauer des Spielers (null = nicht live) */
  viewers: ChartPoint[];
  /** Spieler auf dem Server (ganzer Server) */
  online: ChartPoint[];
  /** Wer in diesem Moment da war: id → online/live/Zuschauer */
  present: { id: string; online: boolean; viewers: number | null }[];
  /** Dieselbe Art beim selben Spieler über die ganze Staffel */
  mine: Occurrences | null;
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
const INTENSITY = `CASE WHEN type = 'subscription' THEN coalesce(value, delta, 1) ELSE coalesce(delta, value, 1) END`;
const intensityOf = (e: TrackerEvent) => (e.type === "subscription" ? (e.value ?? e.delta ?? 1) : (e.delta ?? e.value ?? 1));

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
function statOf(e: TrackerEvent) {
  const k = e.type === "milestone" || e.type === "record" ? String(e.meta?.board ?? "") : e.type === "death" ? "deaths" : e.type;
  // Zuwachs-Ereignis dieses Zählers (bei Meilensteinen gibt es keine Feed-Schwelle für den Meilenstein selbst)
  const isStep = e.type === k || (e.type === "death" && k === "deaths");
  if ((BOARD_KEYS as string[]).includes(k)) {
    const b = k as BoardKey;
    return { key: b, metric: b, label: BOARD_LABEL[b], format: BOARD_FORMAT[b] ?? "num", sql: BOARD_COL[b], eventMin: COUNTER_EVENT_MIN[b] ?? 1, isStep, maxStepMs: 5 * 60_000 };
  }
  if (k in EXTRA_STATS && (EXTRA_HISTORY_KEYS as readonly string[]).includes(k)) {
    const x = EXTRA_STATS[k as ExtraStatKey];
    return { key: k, metric: x.metric as string, label: x.label as string, format: x.format as ChartFormat, sql: extraStatSql(k as ExtraStatKey), eventMin: EXTRA_EVENT_MIN[k as ExtraStatKey] ?? null, isStep, maxStepMs: 30 * 60_000 };
  }
  return null;
}

const HOUR = 3600_000;
const AROUND = 15 * 60_000;
const MINE_LIMIT = 2500;
const ALL_LIMIT = 300;

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
  // Meilensteine: nur die desselben Zählers gelten als „gleiche Art“
  const board = event.type === "milestone" && typeof event.meta?.board === "string" ? event.meta.board : null;
  const sameSql = (n: number) => `type = $1${board ? ` AND meta->>'board' = $${n}` : ""}`;
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
          `SELECT at, online, viewers, ${stat ? stat.sql : "NULL"} AS v FROM player_history WHERE player = $1 AND at BETWEEN $2 AND $3 ORDER BY at`,
          [p, new Date(from), new Date(to)],
        )
      : null,
    db.query<{ at: Date; online_count: number }>(`SELECT at, online_count FROM history WHERE at BETWEEN $1 AND $2 ORDER BY at`, [new Date(from), new Date(to)]),
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
    if (lastStat && ms - lastStat[0] <= stat.maxStepMs) steps.push([ms, Math.max(0, v - lastStat[1])]);
    lastStat = [ms, v];
  }

  // Der Zuwachs des Ereignisses selbst fehlt, wenn die Messungen davor eine Pause hatten: aus dem Ereignis ergänzen
  if (stat?.isStep && event.delta !== undefined && !steps.some(([ms, dd]) => Math.abs(ms - at) < 30_000 && dd > 0)) {
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
        feedMin: stat.isStep ? (feedMin(event.type, event.at) ?? null) : null,
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
  };
}
