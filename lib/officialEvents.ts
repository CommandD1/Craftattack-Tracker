import "server-only";
import { cacheLife } from "next/cache";
import { fetchCraftAttack } from "./craftattackFetch";

export interface OfficialEvent {
  title: string;
  text: string;
  href: string;
  date: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  season: string;
  seasonHref: string | null;
}

const BASE = "https://craftattack.one";

function strip(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Liest die Event-Karten von craftattack.one/events/ (gecacht, 1 Stunde). */
export async function getOfficialEvents(): Promise<{ events: OfficialEvent[]; error: string | null }> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetchCraftAttack(`${BASE}/events/`, { headers: { "user-agent": "actracker/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = (await res.text()).replace(/ data-astro-cid-[a-z0-9]+(="[^"]*")?/g, "");
    const events: OfficialEvent[] = [];

    // Abschnitte pro Staffel: <section ... aria-labelledby="..."> ... <h2 ...>Name</h2> ... <a class="btn" href="/staffeln/...">
    const sections = html.split(/<section\b/).slice(1);
    for (const sec of sections) {
      const season = strip(sec.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
      const seasonHref = sec.match(/href="(\/staffeln\/[^"]+)"/)?.[1] ?? null;
      const cards = sec.matchAll(
        /<a class="box event-card" href="([^"]+)"[^>]*data-event-date="([^"]+)" data-event-end="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      );
      for (const m of cards) {
        const [, href, date, end, inner] = m;
        const title = strip(inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "");
        const text = strip(inner.match(/<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
        if (!title) continue;
        events.push({
          title,
          text,
          href: href.startsWith("http") ? href : BASE + href,
          date,
          end,
          season,
          seasonHref: seasonHref ? BASE + seasonHref : null,
        });
      }
    }
    events.sort((a, b) => b.date.localeCompare(a.date));
    return { events, error: null };
  } catch (err) {
    return { events: [], error: err instanceof Error ? err.message : String(err) };
  }
}
