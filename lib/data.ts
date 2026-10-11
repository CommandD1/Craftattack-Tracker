import "server-only";
import { connection } from "next/server";
import { getEvents, getState } from "./store";
import { startPolling } from "./tracker";
import { attachVods } from "./twitch";
import type { TrackerEvent, TrackerState } from "./types";

/** Markiert die Seite als dynamisch, stellt sicher, dass der Poller läuft, und liefert die Daten. */
export async function loadTracker(): Promise<{ state: TrackerState; events: TrackerEvent[]; now: number }> {
  await connection();
  startPolling();
  const [state, events] = await Promise.all([getState(), getEvents()]);
  // VOD-Links für Tode während eines Streams nachziehen (nur die letzten paar Hundert, Treffer landen in der DB)
  await attachVods(events.slice(-400), (id) => state.players[id]?.twitchLogin ?? state.players[id]?.live?.login ?? null).catch(() => {});
  return { state, events, now: Date.now() };
}
