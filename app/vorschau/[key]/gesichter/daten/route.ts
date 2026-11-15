import { previewKeyOk } from "@/lib/previewKey";
import { FACE_SPECIAL, loadFaceLabels, loadFaceReview, saveFaceLabel } from "@/lib/faceReview";

/**
 * Zuordnungen der Seite „Gesichter zuordnen“ lesen und speichern. Nur POST: GET-Antworten hält der Cache-Server
 * bis zu einer Minute vor, POST reicht er immer durch.
 *   { op: "get" } → { labels }
 *   { op: "set", id, choice } → { labels }   choice = Spieler-ID, "-", "?", "skip" oder null (zurücksetzen)
 */
export async function POST(req: Request, ctx: RouteContext<"/vorschau/[key]/gesichter/daten">) {
  const { key } = await ctx.params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  if (!ok) return new Response("Nicht gefunden.", { status: 404 });
  const headers = { "cache-control": "private, no-store" };
  let body: { op?: string; id?: unknown; choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Ungültige Anfrage" }, { status: 400, headers });
  }
  if (body.op === "get") return Response.json({ labels: await loadFaceLabels() }, { headers });
  if (body.op !== "set") return Response.json({ error: "Unbekannte Aktion" }, { status: 400, headers });
  const data = await loadFaceReview();
  const id = Number(body.id);
  const choice = body.choice === null ? null : String(body.choice ?? "");
  if (!data || !data.groups.some((g) => g.id === id)) return Response.json({ error: "Unbekannte Gruppe" }, { status: 400, headers });
  if (choice !== null && !(FACE_SPECIAL as readonly string[]).includes(choice) && !data.players[choice])
    return Response.json({ error: "Unbekannter Spieler" }, { status: 400, headers });
  return Response.json({ labels: await saveFaceLabel(id, choice) }, { headers });
}
