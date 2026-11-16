import { readFaceThumb } from "@/lib/faceReview";
import { previewKeyOk } from "@/lib/previewKey";

/** Bildausschnitt einer Sichtung (Kopfliste mit markierter Kachel) für „Gesichter zuordnen“ */
export async function GET(_req: Request, ctx: RouteContext<"/vorschau/[key]/gesichter/bild/[file]">) {
  const { key, file } = await ctx.params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  const png = ok ? await readFaceThumb(file) : null;
  if (!png) return new Response("Nicht gefunden.", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
}
