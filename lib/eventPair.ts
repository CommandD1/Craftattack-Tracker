import "server-only";
import { getDb } from "./db";
import { getFeedFilter } from "./feedThresholds";
import type { TrackerEvent } from "./types";

/**
 * Ereignisse mit zwei Spielern (Vorschau-Detailseite): wer gibt, wer bekommt. Je Art feste SQL-Ausdrücke für beide
 * Seiten (nie aus der Anfrage). Liefert beide Seiten mit Davor/Danach, wie oft jede Seite das je Tag tat bzw. bekam,
 * die Matrix „Wer → wen“ und bei Chat die Unterhaltung rund um die Nachricht.
 */

interface PairDef {
  giver: string;
  receiver: string;
  /** Nur Ereignisse, bei denen beide Seiten gesetzt sind */
  where: string;
  /** „schreibt“, „raidet“, … und das Gegenstück */
  gives: string;
  gets: string;
  /** Mehrzahl für Zähler: „Nachrichten“, „Raids“ */
  noun: string;
}

const PAIRS: Partial<Record<TrackerEvent["type"], PairDef>> = {
  chat: { giver: "player", receiver: "meta->>'channelId'", where: "meta->>'channelId' IS NOT NULL", gives: "schreibt im Chat von", gets: "bekommt Nachrichten von", noun: "Nachrichten" },
  raid: { giver: "player", receiver: "meta->>'raidTargetPlayerId'", where: "meta->>'raidTargetPlayerId' IS NOT NULL", gives: "raidet", gets: "wird geraidet von", noun: "Raids" },
  subscription_gift: { giver: "meta->>'giftGiverPlayerId'", receiver: "player", where: "meta->>'giftGiverPlayerId' IS NOT NULL", gives: "verschenkt Abos an", gets: "bekommt Abos von", noun: "Geschenke" },
  death: { giver: "meta->>'killerId'", receiver: "player", where: "coalesce(meta->>'killerId', '') <> ''", gives: "tötet", gets: "wird getötet von", noun: "Kills" },
};

export function pairIds(e: TrackerEvent): { giver: string; receiver: string } | null {
  const m = e.meta ?? {};
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const g =
    e.type === "chat" || e.type === "raid" ? s(e.player) : e.type === "subscription_gift" ? s(m.giftGiverPlayerId) : e.type === "death" ? s(m.killerId) : null;
  const r =
    e.type === "chat" ? s(m.channelId) : e.type === "raid" ? s(m.raidTargetPlayerId) : e.type === "subscription_gift" || e.type === "death" ? s(e.player) : null;
  return g && r && g !== r ? { giver: g, receiver: r } : null;
}

export interface PairDetail {
  giver: string;
  receiver: string;
  gives: string;
  gets: string;
  noun: string;
  /** Davor/Danach beim jeweils anderen Spieler (der nicht `event.player` ist) */
  other: { id: string; before: TrackerEvent[]; after: TrackerEvent[] };
  /** Je Berliner Tag: wie oft der Gebende gab, wie oft der Bekommende bekam (erstes Ereignis des Tages) */
  giverDays: { day: string; n: number; first: string }[];
  receiverDays: { day: string; n: number; first: string }[];
  /** Wie oft genau dieses Paar (in diese Richtung) und umgekehrt */
  together: number;
  reverse: number;
  /** Wer → wen: [Gebender, Bekommender, Anzahl, neuestes Ereignis] */
  matrix: [string, string, number, string][];
  /** Chat: Nachrichten rund um diese (im Kanal des Bekommenden und zurück), sonst leer */
  talk: TrackerEvent[];
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
const toEvent = (r: Row): TrackerEvent => {
  const e: TrackerEvent = { id: r.id, at: r.at.toISOString(), type: r.type, where: r.where };
  if (r.player) e.player = r.player;
  if (r.player_name) e.playerName = r.player_name;
  if (r.uuid) e.uuid = r.uuid;
  if (r.delta !== null) e.delta = Number(r.delta);
  if (r.value !== null) e.value = Number(r.value);
  if (r.meta) e.meta = r.meta;
  return e;
};
const DAY = `to_char(at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD')`;

export async function getEventPair(e: TrackerEvent): Promise<PairDetail | null> {
  const def = PAIRS[e.type];
  const ids = pairIds(e);
  if (!def || !ids) return null;
  const db = await getDb();
  const isShown = await getFeedFilter();
  const t = new Date(e.at);
  const otherId = e.player === ids.giver ? ids.receiver : ids.giver;
  const daysOf = (expr: string, who: string) =>
    db.query<{ day: string; n: string; first: string }>(
      `SELECT ${DAY} AS day, count(*) AS n, (array_agg(id ORDER BY at))[1] AS first
         FROM events WHERE type = $1 AND ${def.where} AND ${expr} = $2 GROUP BY 1 ORDER BY 1`,
      [e.type, who],
    );
  const [before, after, gDays, rDays, pairs, talk] = await Promise.all([
    db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at <= $2 AND id <> $3 ORDER BY at DESC LIMIT 120`, [otherId, t, e.id]),
    db.query<Row>(`SELECT ${COLS} FROM events WHERE player = $1 AND at >= $2 AND id <> $3 ORDER BY at LIMIT 120`, [otherId, t, e.id]),
    daysOf(def.giver, ids.giver),
    daysOf(def.receiver, ids.receiver),
    db.query<{ g: string; r: string; n: string; last: string }>(
      `SELECT ${def.giver} AS g, ${def.receiver} AS r, count(*) AS n, (array_agg(id ORDER BY at DESC))[1] AS last
         FROM events WHERE type = $1 AND ${def.where} AND ${def.giver} IS NOT NULL GROUP BY 1, 2`,
      [e.type],
    ),
    // Unterhaltung: im Kanal des Bekommenden und die Antworten des Bekommenden im Kanal des Schreibenden, ±45 Min
    e.type === "chat"
      ? db.query<Row>(
          `SELECT ${COLS} FROM events
            WHERE type = 'chat' AND at BETWEEN $1 AND $2
              AND (meta->>'channelId' = $3 OR (player = $3 AND meta->>'channelId' = $4))
            ORDER BY at LIMIT 200`,
          [new Date(t.getTime() - 45 * 60_000), new Date(t.getTime() + 45 * 60_000), ids.receiver, ids.giver],
        )
      : null,
  ]);
  const shown = (rows: Row[]) => rows.map(toEvent).filter((x) => isShown(x));
  const matrix = pairs.rows.map((r) => [r.g, r.r, Number(r.n), r.last] as [string, string, number, string]);
  return {
    ...ids,
    gives: def.gives,
    gets: def.gets,
    noun: def.noun,
    other: { id: otherId, before: shown(before.rows).slice(0, 10).reverse(), after: shown(after.rows).slice(0, 10) },
    giverDays: gDays.rows.map((r) => ({ day: r.day, n: Number(r.n), first: r.first })),
    receiverDays: rDays.rows.map((r) => ({ day: r.day, n: Number(r.n), first: r.first })),
    together: matrix.find(([g, r]) => g === ids.giver && r === ids.receiver)?.[2] ?? 0,
    reverse: matrix.find(([g, r]) => g === ids.receiver && r === ids.giver)?.[2] ?? 0,
    matrix,
    talk: talk ? talk.rows.map(toEvent) : [],
  };
}
