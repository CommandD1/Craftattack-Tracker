import { previewKeyOk } from "@/lib/previewKey";
import { readVoiceDayFile } from "@/lib/voiceDays";

/** Tagesdatei des Voicechat-Zeitstrahls: <tag>.json (Listen) oder <tag>-faces.json (Gesichter unbekannter Köpfe) */
export async function GET(_req: Request, ctx: RouteContext<"/vorschau/[key]/voicechat/zeitstrahl/tag/[file]">) {
  const { key, file } = await ctx.params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  const m = /^(\d{4}-\d{2}-\d{2})(-faces)?\.json$/.exec(file);
  const text = ok && m ? await readVoiceDayFile(m[1], Boolean(m[2])) : null;
  if (!text) return new Response("Nicht gefunden.", { status: 404 });
  return new Response(text, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=60" } });
}
