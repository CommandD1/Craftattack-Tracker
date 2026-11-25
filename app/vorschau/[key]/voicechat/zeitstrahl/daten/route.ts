import { previewKeyOk } from "@/lib/previewKey";
import { addVoiceFix, isDay, loadVoiceFixes, loadVoiceIndex, removeVoiceFix, type VoiceFix } from "@/lib/voiceDays";

/**
 * Korrekturen des Voicechat-Zeitstrahls lesen und speichern. Nur POST (der Cache-Server reicht POST immer durch).
 *   { op: "get", day } → { fixes }            Korrekturen dieses Tages
 *   { op: "add", fix } → { fixes }            fix ohne id/at
 *   { op: "del", id, day } → { fixes }
 */
export async function POST(req: Request, ctx: RouteContext<"/vorschau/[key]/voicechat/zeitstrahl/daten">) {
  const { key } = await ctx.params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  if (!ok) return new Response("Nicht gefunden.", { status: 404 });
  const headers = { "cache-control": "private, no-store" };
  const bad = (error: string) => Response.json({ error }, { status: 400, headers });
  let body: { op?: string; day?: unknown; id?: unknown; fix?: Partial<VoiceFix> };
  try {
    body = await req.json();
  } catch {
    return bad("Ungültige Anfrage");
  }
  const ofDay = (all: VoiceFix[], day: string) => ({ fixes: all.filter((f) => f.day === day) });
  if (body.op === "get" && isDay(body.day)) return Response.json(ofDay(await loadVoiceFixes(), body.day), { headers });
  if (body.op === "del" && isDay(body.day) && typeof body.id === "string") return Response.json(ofDay(await removeVoiceFix(body.id), body.day), { headers });
  if (body.op !== "add" || !body.fix) return bad("Unbekannte Aktion");
  const f = body.fix;
  const index = await loadVoiceIndex();
  const known = (id: unknown) => typeof id === "string" && Boolean(index?.players[id]);
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!isDay(f.day) || !known(f.streamer) || !num(f.from) || !num(f.until) || !num(f.slot) || (f.scope !== "run" && f.scope !== "day")) return bad("Unvollständige Korrektur");
  if (!f.was || (f.was.i !== null && !known(f.was.i)) || (f.was.u !== null && !num(f.was.u)) || (f.was.i === null && f.was.u === null)) return bad("Unbekannter Kopf");
  if (f.to !== "-" && f.to !== "?" && !known(f.to)) return bad("Unbekannter Spieler");
  const all = await addVoiceFix({ day: f.day, streamer: f.streamer!, from: f.from!, until: f.until!, to: f.to!, scope: f.scope, slot: f.slot!, was: { i: f.was.i, u: f.was.u } } as Omit<VoiceFix, "id" | "at">);
  return Response.json(ofDay(all, f.day), { headers });
}
