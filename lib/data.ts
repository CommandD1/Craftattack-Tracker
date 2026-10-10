import "server-only";
import { connection } from "next/server";
import { getEvents, getState } from "./store";
import { startPolling } from "./tracker";
import type { TrackerEvent, TrackerState } from "./types";

/** Markiert die Seite als dynamisch, stellt sicher, dass der Poller läuft, und liefert die Daten. */
export async function loadTracker(): Promise<{ state: TrackerState; events: TrackerEvent[]; now: number }> {
  await connection();
  startPolling();
  const [state, events] = await Promise.all([getState(), getEvents()]);
  return { state, events, now: Date.now() };
}
