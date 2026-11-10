import { connection } from "next/server";
import { getEvents } from "@/lib/store";
import { getFeedFilter } from "@/lib/feedThresholds";

/** So weit zurück zählt „neu seit deinem letzten Besuch“; ältere Besuche sehen „99+“ bzw. die Zahl dieser Woche */
const WINDOW_MS = 7 * 86_400_000;

/**
 * Zeitpunkte der Feed-Ereignisse (dieselben wie unter „Zuletzt passiert“) der letzten sieben Tage, je Minute (ab `from`)
 * mit Anzahl. Für alle Besucher gleich, damit der Cache-Server die Antwort teilen kann; der Browser zählt selbst, was
 * nach seinem letzten Besuch liegt (lib/visit.ts, components/NewSince.tsx).
 */
export async function GET() {
  await connection();
  const [events, isShown] = await Promise.all([getEvents(), getFeedFilter()]);
  const now = Date.now();
  const from = now - WINDOW_MS;
  const counts = new Map<number, number>();
  // Ganze Liste (gut 30.000, im Speicher): Nachträge aus VODs stehen nicht unbedingt in Zeitreihenfolge
  for (let i = events.length - 1; i >= 0; i--) {
    const at = Date.parse(events[i].at);
    if (at < from || at > now || !isShown(events[i])) continue;
    const m = Math.floor((at - from) / 60_000);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return Response.json(
    { now, from, at: [...counts].sort((a, b) => a[0] - b[0]) },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
