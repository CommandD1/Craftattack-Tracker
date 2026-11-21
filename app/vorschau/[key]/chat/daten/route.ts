import { previewKeyOk } from "@/lib/previewKey";
import { CHAT_SPECIAL, loadChatLabels, loadChatReview, saveChatLabel } from "@/lib/chatReview";

/**
 * Daten der Seite „Ingame-Chat aufräumen“. Nur POST: GET-Antworten hält der Cache-Server bis zu einer Minute vor, POST
 * reicht er immer durch.
 *   { op: "get" } → { labels }
 *   { op: "bundle", key } → { events, hidden }                    Ereignisse eines Namensbündels
 *   { op: "sample" } → { events }                                 Stichprobe automatisch zugeordneter Ereignisse
 *   { op: "set", scope: "names"|"events", id, choice, name?, text? } → { labels }
 *        choice = Spieler-ID, "?" (fremd, name = Name), "x" (Unsinn), "skip" oder null (zurücksetzen)
 */
export async function POST(req: Request, ctx: RouteContext<"/vorschau/[key]/chat/daten">) {
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
  let body: { op?: string; key?: unknown; scope?: unknown; id?: unknown; choice?: unknown; name?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Ungültige Anfrage");
  }
  if (body.op === "get") return Response.json({ labels: await loadChatLabels() }, { headers });
  const data = await loadChatReview();
  if (!data) return bad("Noch keine Daten vom Scan");
  if (body.op === "bundle") {
    const b = data.bundles.find((x) => x.key === body.key);
    if (!b) return bad("Unbekanntes Bündel");
    return Response.json({ events: b.events, hidden: b.hidden ?? 0 }, { headers });
  }
  if (body.op === "sample") return Response.json({ events: data.sample }, { headers });
  if (body.op !== "set") return bad("Unbekannte Aktion");

  const scope = body.scope === "names" || body.scope === "events" ? body.scope : null;
  const id = typeof body.id === "string" ? body.id : "";
  if (!scope || !id || id.length > 80) return bad("Unbekanntes Ziel");
  const known =
    scope === "names"
      ? data.bundles.some((b) => b.key === id)
      : data.bundles.some((b) => b.events.some((e) => e.id === id)) || data.sample.some((e) => e.id === id);
  if (!known) return bad("Unbekanntes Ziel");
  if (body.choice === null) return Response.json({ labels: await saveChatLabel(scope, id, null) }, { headers });
  const choice = String(body.choice ?? "");
  if (!(CHAT_SPECIAL as readonly string[]).includes(choice) && !data.players[choice]) return bad("Unbekannter Spieler");
  const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const name = choice === "?" ? clean(body.name, 32) : undefined;
  const text = scope === "events" ? clean(body.text, 300) : undefined;
  return Response.json({ labels: await saveChatLabel(scope, id, { choice, name, text }) }, { headers });
}
