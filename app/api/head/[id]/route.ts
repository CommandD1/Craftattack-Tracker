import { connection } from "next/server";
import { fetchCraftAttack } from "@/lib/craftattackFetch";

/**
 * Kopf-Bild eines Spielers.
 * 1. kuratierter Kopf von craftattack.one (/skins/<id>-head.webp) – passt auch bei Zweitaccounts
 * 2. sonst Mojang-Skin über mc-heads.net anhand der UUID
 * Antworten werden einen Tag gecacht.
 */
const CACHE = "public, max-age=86400, stale-while-revalidate=604800";

export async function GET(req: Request, ctx: RouteContext<"/api/head/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const uuid = url.searchParams.get("u") ?? "";
  const size = Math.min(256, Math.max(8, Number(url.searchParams.get("s") ?? 32) || 32));
  const slug = id.toLowerCase().replace(/[^a-z0-9_-]/g, "");

  if (slug) {
    try {
      const r = await fetchCraftAttack(`https://craftattack.one/skins/${slug}-head.webp`, {
        headers: { "user-agent": "actracker/1.0" },
        next: { revalidate: 86400 },
      });
      if (r.ok) {
        return new Response(await r.arrayBuffer(), {
          headers: { "content-type": r.headers.get("content-type") ?? "image/webp", "cache-control": CACHE },
        });
      }
    } catch {
      /* weiter zum Fallback */
    }
  }

  const target = /^[0-9a-f-]{32,36}$/i.test(uuid) ? uuid : "MHF_Steve";
  try {
    const r = await fetch(`https://mc-heads.net/avatar/${target}/${size}`, {
      headers: { "user-agent": "actracker/1.0" },
      next: { revalidate: 86400 },
    });
    if (r.ok) {
      return new Response(await r.arrayBuffer(), {
        headers: { "content-type": r.headers.get("content-type") ?? "image/png", "cache-control": CACHE },
      });
    }
  } catch {
    /* unten 404 */
  }
  return new Response(null, { status: 404 });
}
