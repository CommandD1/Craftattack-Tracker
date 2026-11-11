import { connection } from "next/server";
import { getClipThumbnailUrl } from "@/lib/clips";
import { serveImage, webImage } from "@/lib/imageCache";

/**
 * Vorschaubild eines Twitch-Clips. Der Server holt es von Twitchs CDN und legt es im Bild-Zwischenspeicher ab
 * (lib/imageCache.ts); der Browser des Besuchers verbindet sich dadurch nicht selbst mit Twitch. Abgerufen wird nur
 * die in twitch_clips gespeicherte Adresse des Clips, keine beliebige URL.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/clip-thumb/[id]">) {
  await connection();
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return new Response(null, { status: 404 });
  const url = await getClipThumbnailUrl(id).catch(() => null);
  if (!url) return new Response(null, { status: 404 });
  return serveImage([webImage(`clip-thumb:${id}`, url)]);
}
