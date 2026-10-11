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
  // VOD-Links für Tode während eines Streams nachziehen. Alle Ereignisse, damit auch ältere Tode und deren
  // Stream-an/aus-Zeiten gefunden werden; Treffer landen in der DB und werden nicht erneut abgefragt.
  const liveNow = Object.values(state.players)
    .filter((p) => p.live && p.liveSince)
    .map((p) => ({ player: p.id, since: p.liveSince!, login: p.live!.login }));
  await attachVods(events, (id) => state.players[id]?.twitchLogin ?? state.players[id]?.live?.login ?? null, liveNow).catch(() => {});
  return { state, events, now: Date.now() };
}
