import { NextResponse, connection } from "next/server";
import { getSeries, SERIES_METRICS, type SeriesMetric } from "@/lib/store";
import { getAfkSeries } from "@/lib/analytics";

const BUCKETS = new Set([1, 5, 15, 30, 60, 180, 360, 720, 1440]);

/** Zeitreihen für den Graph-Baukasten: ?metric=&spieler=a,b&von=<ms>&bis=<ms>&raster=<min>&modus=wert|zuwachs */
export async function GET(req: Request) {
  await connection();
  const sp = new URL(req.url).searchParams;
  const metric = sp.get("metric") as SeriesMetric;
  if (!SERIES_METRICS.includes(metric)) return NextResponse.json({ error: "unbekannte Kennzahl" }, { status: 400 });
  const players = [...new Set((sp.get("spieler") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  const n = (k: string) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const raster = n("raster");
  const base = { players, from: n("von"), to: n("bis"), bucketMinutes: raster !== null && BUCKETS.has(raster) ? raster : null, mode: sp.get("modus") === "zuwachs" ? ("zuwachs" as const) : ("wert" as const) };
  // AFK-Zeit kommt nicht aus einer Spalte, sondern aus den rückwirkend berechneten AFK-Phasen
  if (metric === "afkSeconds") return NextResponse.json(await getAfkSeries(base), { headers: { "cache-control": "private, max-age=30" } });
  const data = await getSeries({
    metric,
    players,
    from: n("von"),
    to: n("bis"),
    bucketMinutes: raster !== null && BUCKETS.has(raster) ? raster : null,
    mode: sp.get("modus") === "zuwachs" ? "zuwachs" : "wert",
  });
  return NextResponse.json(data, { headers: { "cache-control": "private, max-age=30" } });
}
