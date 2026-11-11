import "server-only";
import { getDb } from "./db";
import { getFeedFilter } from "./feedThresholds";
import { EXTRA_HISTORY_KEYS, EXTRA_STATS, extraStatSql, type ExtraStatKey } from "./playerStats";
import { BOARD_KEYS, type BoardKey, type TrackerEvent } from "./types";

/**
 * Alles für die Detailseite eines Ereignisses (Vorschau unter /vorschau/<key>/ereignis/<id>): das Ereignis, was der
 * Spieler davor und danach erlebte, was gleichzeitig sonst passierte, wer gerade da war und Verläufe ±3 Stunden.
 * Nur Zeitfenster-Abfragen über vorhandene Indizes (events (player, at), (type, at), player_history (player, at)).
 */

export type ChartFormat = "num" | "distance" | "duration" | "hearts";
/** [Zeitpunkt ms, Wert oder null = Lücke] */
export type ChartPoint = [number, number | null];

export interface EventDetail {
  event: TrackerEvent;
  before: TrackerEvent[];
  after: TrackerEvent[];
  /** Andere Ereignisse ±15 Minuten (ohne das Ereignis selbst) */
  around: TrackerEvent[];
  /** Gleiche Art beim selben Spieler (ohne Spieler: alle) */
  same: { prev: TrackerEvent | null; next: TrackerEvent | null; nth: number; total: number };
  window: { from: number; to: number };
  /** Betroffener Wert des Spielers (Zähler), falls das Ereignis einen hat */
  stat: { key: string; label: string; format: ChartFormat; points: ChartPoint[] } | null;
  /** Zuschauer des Spielers (null = nicht live) */
  viewers: ChartPoint[];
  /** Spieler auf dem Server (ganzer Server) */
  online: ChartPoint[];
  /** Wer in diesem Moment da war: id → online/live/Zuschauer */
  present: { id: string; online: boolean; viewers: number | null }[];
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
function statOf(e: TrackerEvent): { key: string; label: string; format: ChartFormat; sql: string } | null {
  const k = e.type === "milestone" || e.type === "record" ? String(e.meta?.board ?? "") : e.type === "death" ? "deaths" : e.type;
  if ((BOARD_KEYS as string[]).includes(k)) {
    const b = k as BoardKey;
    return { key: b, label: BOARD_LABEL[b], format: BOARD_FORMAT[b] ?? "num", sql: BOARD_COL[b] };
  }
  if (k in EXTRA_STATS && (EXTRA_HISTORY_KEYS as readonly string[]).includes(k)) {
    const x = EXTRA_STATS[k as ExtraStatKey];
    return { key: k, label: x.label, format: x.format as ChartFormat, sql: extraStatSql(k as ExtraStatKey) };
  }
  return null;
}

const HOUR = 3600_000;
const AROUND = 15 * 60_000;

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const db = await getDb();
  const row = (await db.query<Row>(`SELECT ${COLS} FROM events WHERE id = $1`, [id])).rows[0];
  if (!row) return null;
  const event = toEvent(row);
  const t = row.at;
  const at = t.getTime();
  const isShown = await getFeedFilter();
  const shown = (rows: Row[]) => rows.map(toEvent).filter((e) => e.id !== id && isShown(e));
  const from = at - 3 * HOUR;
  const to = at + 3 * HOUR;
  const stat = statOf(event);
  const p = event.player ?? null;

  const [beforeRows, afterRows, aroundRows, prevRow, nextRow, counts, hist, srv, present] = await Promise.all([
    p ? db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at <= $2 AND id <> $3 ORDER BY at DESC LIMIT 120`, [p, t, id]) : null,
    p ? db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at >= $2 AND id <> $3 ORDER BY at LIMIT 120`, [p, t, id]) : null,
    db.query<Row>(`SELECT ${COLS} FROM events WHERE at BETWEEN $1 AND $2 ORDER BY at LIMIT 600`, [new Date(at - AROUND), new Date(at + AROUND)]),
    db.query<Row>(
      `SELECT ${COLS} FROM events WHERE type = $1 AND at < $2 ${p ? "AND player = $3" : ""} ORDER BY at DESC LIMIT 1`,
      p ? [event.type, t, p] : [event.type, t],
    ),
    db.query<Row>(
      `SELECT ${COLS} FROM events WHERE type = $1 AND at > $2 ${p ? "AND player = $3" : ""} ORDER BY at LIMIT 1`,
      p ? [event.type, t, p] : [event.type, t],
    ),
    db.query<{ nth: string; total: string }>(
      `SELECT count(*) FILTER (WHERE at <= $2) AS nth, count(*) AS total FROM events WHERE type = $1 ${p ? "AND player = $3" : ""}`,
      p ? [event.type, t, p] : [event.type, t],
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
  ]);

  // Zähler: Werte nur, solange sie bekannt sind (null zwischendurch = Lücke)
  const statPoints: ChartPoint[] = [];
  const viewers: ChartPoint[] = [];
  let lastAt = 0;
  for (const r of hist?.rows ?? []) {
    const ms = r.at.getTime();
    // Längere Pause in den Daten (nicht online, nicht live): Lücke statt einer Linie quer darüber
    if (lastAt && ms - lastAt > 10 * 60_000) {
      viewers.push([lastAt + 60_000, null]);
      statPoints.push([lastAt + 60_000, null]);
    }
    lastAt = ms;
    viewers.push([ms, r.viewers]);
    if (stat) statPoints.push([ms, r.v === null ? null : Number(r.v)]);
  }
  // Zähler nur aus Zeilen mit Wert (die Zusatzwerte stehen nur alle 5 Min drin)
  const statClean = statPoints.filter(([, v], i, a) => v !== null || (i > 0 && a[i - 1][1] !== null));

  return {
    event,
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
    stat: stat && statClean.some(([, v]) => v !== null) ? { key: stat.key, label: stat.label, format: stat.format, points: statClean } : null,
    viewers: viewers.some(([, v]) => v !== null) ? viewers : [],
    online: srv.rows.map((r) => [r.at.getTime(), r.online_count] as ChartPoint),
    present: present.rows.map((r) => ({ id: r.player, online: r.online, viewers: r.viewers })),
  };
}
