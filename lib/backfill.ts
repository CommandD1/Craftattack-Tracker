import "server-only";
import { getDb } from "./db";
import { assignEventPlayer, deleteBackfilledEvents, ensureLoaded, getAllSessions, getState, insertPastEvents, type StoredSession } from "./store";
import { loadAfkSpans } from "./analytics";
import { UNKNOWN_DEATH_GRACE_MS } from "./tracker";
import { trackedSecondsOf } from "./playtime";
import type { EventType, TrackerEvent } from "./types";

/** Eine Phase, die bis kurz vor „jetzt“ reicht und deren Spieler online ist, läuft noch – die übernimmt der Live-Tracker. */
const RUNNING_SLACK_MS = 90_000;
/** Ein Ende-Ereignis des Live-Trackers darf etwas nach dem aus dem Verlauf berechneten Phasenende liegen (Poll-Takt). */
const END_SLACK_MS = 10 * 60_000;

const FARM_TYPES: EventType[] = ["afk_mobs_start", "afk_mobs_end", "afk_blocks_start", "afk_blocks_end"];

/** Aktuelle Stufe der einmaligen Verlaufs-Korrekturen (tracker_meta.history_fix) */
const HISTORY_FIX_LEVEL = 1;

/** Alle Nachträge beim Prozessstart, in der richtigen Reihenfolge. */
export async function runBackfills(): Promise<void> {
  await fixHistoryOnce();
  const n = await backfillAfkFarmEvents();
  if (n > 0) console.log(`[tracker] ${n} AFK-Farm-Ereignisse rückwirkend nachgetragen`);
  const d = await assignUnknownDeaths();
  if (d > 0) console.log(`[tracker] ${d} unbekannte Tode per Ausschluss nachträglich zugeordnet`);
}

/**
 * Alte „unbekannte“ Tode per Ausschluss zuordnen (wie der Live-Tracker seit der Ausschluss-Logik, nur rückwirkend):
 * War im Zeitfenster vor der Meldung genau ein Spieler online, der keine Einzelstatistik (/api/ext) hat und nicht
 * in der Tode-Top-10 stand, bekommt er die Tode. Online-Zeit kommt aus den Join/Leave-Sessions, die Top-10-
 * Zugehörigkeit aus dem Spielerverlauf (dort steht ein Tode-Wert nur, wenn die API ihn geliefert hat).
 */
export async function assignUnknownDeaths(): Promise<number> {
  await ensureLoaded();
  const db = await getDb();
  const unknowns = (
    await db.query<{ id: string; at: Date }>(
      `SELECT id, at FROM events WHERE type = 'death' AND player IS NULL AND meta->>'unknown' = 'true' ORDER BY at`,
    )
  ).rows;
  if (unknowns.length === 0) return 0;
  const [state, sessions] = await Promise.all([getState(), getAllSessions()]);
  const now = Date.now();
  const noExt = Object.values(state.players).filter((p) => !p.twitchLogin);
  // Wer im Zeitfenster ein eigenes Tod-Ereignis hat, stand in der Tode-Top-10: sein Tod war erklärt, der unbekannte ist nicht seiner
  const explained = (
    await db.query<{ player: string; at: Date }>(`SELECT player, at FROM events WHERE type = 'death' AND player = ANY($1::text[])`, [
      noExt.map((p) => p.id),
    ])
  ).rows.map((r) => ({ player: r.player, at: new Date(r.at).getTime() }));
  // Die Meldung kommt erst nach der Wartezeit; der Tod lag also bis zu Wartezeit + ein Poll davor
  const WINDOW_MS = UNKNOWN_DEATH_GRACE_MS + 60_000;
  let assigned = 0;
  for (const u of unknowns) {
    const t = new Date(u.at).getTime();
    const from = t - WINDOW_MS;
    const candidates = noExt.filter(
      (p) => onlineBetween(sessions, p.id, from, t, now) > 0 && !explained.some((e) => e.player === p.id && e.at >= from && e.at <= t + 60_000),
    );
    if (candidates.length !== 1) continue;
    const only = candidates[0];
    await assignEventPlayer(u.id, { id: only.id, name: only.name, uuid: only.uuid }, { inferred: true, backfilled: true });
    assigned++;
  }
  return assigned;
}

/** Online-Sekunden eines Spielers laut Sessions innerhalb [from, to] */
function onlineBetween(sessions: StoredSession[], player: string, from: number, to: number, now: number): number {
  let sum = 0;
  for (const s of sessions) {
    if (s.player !== player) continue;
    const a = Math.max(from, Date.parse(s.start));
    const b = Math.min(to, s.end ? Date.parse(s.end) : now);
    if (b > a) sum += (b - a) / 1000;
  }
  return sum;
}

/**
 * Einmalige Korrektur alter Verlaufsdaten (vor den entsprechenden Tracker-Fixes aufgezeichnet):
 * 1. Spieler ohne /api/ext (kein Twitch-Login bekannt) bekommen Strecke, Mobs und Blöcke nur aus den Top 10.
 *    Außerhalb davon stand der alte Wert einfach weiter da und sah wie Stillstand (AFK) aus. Ein gegenüber dem
 *    vorigen Punkt unveränderter Wert gilt für diese Spieler deshalb rückwirkend als unbekannt (NULL).
 * 2. Spielzeit gibt es nur für die Top 10. Stehende Spielzeitwerte werden durch „letzter frischer Wert plus
 *    seitdem laut Join/Leave gemessene Online-Zeit“ ersetzt und der Bezugspunkt je Spieler gesetzt.
 * Danach werden bereits nachgetragene AFK-Farm-Ereignisse verworfen (sie beruhten auf den alten Daten).
 */
export async function fixHistoryOnce(): Promise<void> {
  await ensureLoaded();
  const db = await getDb();
  const meta = (await db.query<{ history_fix: number }>(`SELECT history_fix FROM tracker_meta WHERE id = 1`)).rows[0];
  if ((meta?.history_fix ?? 0) >= HISTORY_FIX_LEVEL) return;

  // 1) Zähler von Spielern ohne ext
  const nulled = (
    await db.query<{ player: string }>(
      `UPDATE player_history h
          SET distance      = CASE WHEN h.distance      = s.pd THEN NULL ELSE h.distance      END,
              mobs_killed   = CASE WHEN h.mobs_killed   = s.pm THEN NULL ELSE h.mobs_killed   END,
              blocks_broken = CASE WHEN h.blocks_broken = s.pb THEN NULL ELSE h.blocks_broken END
         FROM (SELECT player, at,
                      lag(distance)      OVER w AS pd,
                      lag(mobs_killed)   OVER w AS pm,
                      lag(blocks_broken) OVER w AS pb
                 FROM player_history
                WHERE player IN (SELECT id FROM players WHERE twitch_login IS NULL)
               WINDOW w AS (PARTITION BY player ORDER BY at)) s
        WHERE h.player = s.player AND h.at = s.at
          AND (h.distance = s.pd OR h.mobs_killed = s.pm OR h.blocks_broken = s.pb)
        RETURNING h.player`,
    )
  ).rows.length;

  // 2) Spielzeit
  const [state, sessions] = await Promise.all([getState(), getAllSessions()]);
  const now = Date.now();
  const rows = (
    await db.query<{ player: string; at: Date; playtime_seconds: number | string }>(
      `SELECT player, at, playtime_seconds FROM player_history WHERE playtime_seconds IS NOT NULL ORDER BY player, at`,
    )
  ).rows;
  let fixed = 0;
  let cur: string | null = null;
  let lastFresh: { value: number; at: number } | null = null;
  let prevValue: number | null = null;
  const finishPlayer = (id: string) => {
    const p = state.players[id];
    if (!p || p.playtimeTracked !== null || p.stats.playtimeSeconds === undefined || !lastFresh) return;
    // Bezugspunkt: gemessene Online-Zeit zum Zeitpunkt des letzten frischen API-Werts
    const since = lastFresh.value === p.stats.playtimeSeconds ? onlineBetween(sessions, id, lastFresh.at, now, now) : 0;
    p.playtimeTracked = Math.max(0, trackedSecondsOf(p, now) - since);
  };
  for (const r of rows) {
    const t = new Date(r.at).getTime();
    const value = Number(r.playtime_seconds);
    if (r.player !== cur) {
      if (cur) finishPlayer(cur);
      cur = r.player;
      lastFresh = { value, at: t };
      prevValue = value;
      continue;
    }
    if (value !== prevValue || !lastFresh) {
      // Wert hat sich geändert: frisch aus der API
      lastFresh = { value, at: t };
      prevValue = value;
      continue;
    }
    // Stehender Wert: schätzen
    const est = Math.round(lastFresh.value + onlineBetween(sessions, cur, lastFresh.at, t, now));
    if (est !== value) {
      await db.query(`UPDATE player_history SET playtime_seconds = $3 WHERE player = $1 AND at = $2`, [cur, new Date(t), est]);
      fixed++;
    }
  }
  if (cur) finishPlayer(cur);
  for (const p of Object.values(state.players)) {
    // Spieler mit API-Wert, aber ohne Verlaufspunkt: Bezugspunkt ist jetzt
    if (p.playtimeTracked === null && p.stats.playtimeSeconds !== undefined) p.playtimeTracked = trackedSecondsOf(p, now);
  }

  const gone = await deleteBackfilledEvents();
  await db.query(`UPDATE tracker_meta SET history_fix = $1 WHERE id = 1`, [HISTORY_FIX_LEVEL]);
  console.log(`[tracker] Verlauf korrigiert: ${nulled} Punkte ohne ext-Daten bereinigt, ${fixed} Spielzeitwerte geschätzt, ${gone} alte Nachträge verworfen`);
}

/**
 * Trägt für abgeschlossene AFK-Farm-Phasen aus dem Spielerverlauf die Ereignisse Start/Ende (Mob- bzw. Block-Farm)
 * nach, wo der Live-Tracker noch keine erzeugt hat – z. B. für die Zeit vor Einführung der Farm-Erkennung oder für
 * alte „afk_farm“-Ereignisse ohne Ende. Idempotent über feste IDs; läuft einmal beim Prozessstart.
 */
export async function backfillAfkFarmEvents(): Promise<number> {
  await ensureLoaded();
  const state = await getState();
  const db = await getDb();
  const now = Date.now();
  const spans = await loadAfkSpans(0, now, now);

  const existing = (
    await db.query<{ player: string; type: string; at: Date }>(
      `SELECT player, type, at FROM events WHERE type = ANY($1::text[]) AND player IS NOT NULL`,
      [FARM_TYPES],
    )
  ).rows.map((r) => ({ player: r.player, type: r.type, at: new Date(r.at).getTime() }));
  const has = (player: string, type: EventType, from: number, to: number) =>
    existing.some((e) => e.player === player && e.type === type && e.at >= from && e.at <= to);

  const events: TrackerEvent[] = [];
  for (const [id, list] of spans) {
    const p = state.players[id];
    for (const [a, b, kind, farm] of list) {
      if (!kind || !farm) continue;
      // Läuft noch: Start/Ende meldet der Live-Tracker
      if (p?.online && b >= now - RUNNING_SLACK_MS) continue;
      const startType: EventType = kind === "mobs" ? "afk_mobs_start" : "afk_blocks_start";
      const endType: EventType = kind === "mobs" ? "afk_mobs_end" : "afk_blocks_end";
      const base = { player: id, playerName: p?.name ?? id, uuid: p?.uuid ?? "", where: "server" as const };
      const since = new Date(a).toISOString();
      const key = `${id}-${a.toString(36)}`;
      if (!has(id, startType, a, b)) {
        events.push({
          id: `bf-${kind}-start-${key}`,
          at: new Date(farm.at).toISOString(),
          type: startType,
          ...base,
          value: farm.atValue,
          meta: { kind, since, [kind]: farm.atValue, backfilled: true },
        });
      }
      if (!has(id, endType, a, b + END_SLACK_MS)) {
        events.push({
          id: `bf-${kind}-end-${key}`,
          at: new Date(b).toISOString(),
          type: endType,
          ...base,
          value: farm.value,
          meta: { kind, afkSeconds: Math.round((b - a) / 1000), since, byLeave: farm.byLeave, mobs: farm.mobs, blocks: farm.blocks, backfilled: true },
        });
      }
    }
  }
  return insertPastEvents(events);
}
