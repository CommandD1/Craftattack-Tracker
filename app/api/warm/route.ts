import { connection } from "next/server";
import { getAllSessions, getFullBoard, getTwitchSubscriptionBoard } from "@/lib/store";
import { getPlayerRates, getRankHistory } from "@/lib/analytics";

/**
 * Füllt die teuren Zwischenspeicher der Spielerseiten (Rang-Verlauf, Raten, Sessions, Bestenlisten).
 * Wird kurz nach dem Serverstart einmal aufgerufen, damit nicht der erste Besucher darauf wartet.
 * Alle Abfragen sind zwischengespeichert und laufen höchstens einmal gleichzeitig: wiederholte Aufrufe kosten nichts.
 */
export async function GET() {
  await connection();
  const started = Date.now();
  await Promise.all([getRankHistory(), getPlayerRates(), getAllSessions(), getFullBoard("followers"), getTwitchSubscriptionBoard()]);
  return Response.json({ ok: true, ms: Date.now() - started }, { headers: { "cache-control": "no-store" } });
}
