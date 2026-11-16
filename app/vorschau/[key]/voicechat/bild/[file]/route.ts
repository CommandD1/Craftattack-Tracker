import { previewKeyOk } from "@/lib/previewKey";
import { readOverlayImage } from "@/lib/voiceSummary";

/** Overlay-Karte eines Streamers (Mittelbild + feste Bereiche) für die Voicechat-Vorschau */
export async function GET(_req: Request, ctx: RouteContext<"/vorschau/[key]/voicechat/bild/[file]">) {
  const { key, file } = await ctx.params;
  let ok = false;
  try {
    ok = previewKeyOk(decodeURIComponent(key));
  } catch {
    ok = false;
  }
  const png = ok ? await readOverlayImage(file) : null;
  if (!png) return new Response("Nicht gefunden.", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=600" } });
}
