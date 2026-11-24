import type { MetadataRoute } from "next";

/**
 * Crawler: die Hauptseiten gern, aber keine Adressen mit Filtern (?…; unendlich viele Kombinationen, jede wird neu
 * gerendert) und keine einzelnen Ereignisse (über 250.000 Seiten). Am 24.11. legte PerplexityBot damit die Seite lahm.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/*?", "/ereignis/", "/api/", "/vorschau/", "/fitnacraft/", "/x/"], crawlDelay: 10 }],
  };
}
