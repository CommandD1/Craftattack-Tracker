import "server-only";
import { cacheLife } from "next/cache";
import { fetchCraftAttack } from "./craftattackFetch";

export interface OfficialEvent {
  title: string;
  text: string;
  href: string;
  date: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, bei eintägigen Events gleich `date`
  /** Beginn und Ende als HH:MM (Europe/Berlin); null, wenn die Seite keine Uhrzeit nennt */
  time: string | null;
  endTime: string | null;
  season: string;
  seasonHref: string | null;
  /** Anzahl Teilnehmer laut Karte, 0 ohne Angabe */
  participantCount: number;
  /** Spieler-IDs der Teilnehmer ("Mit dabei" auf der Event-Seite, sonst die Köpfe auf der Karte) */
  participants: string[];
}

export type EventState = "upcoming" | "today" | "live" | "past";

const BASE = "https://craftattack.one";
const HEADERS = { "user-agent": "actracker/1.0" };

function decode(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function strip(html: string) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Attribute eines Start-Tags, unabhängig von der Reihenfolge */
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], decode(m[2] ?? "")]));
}

const absolute = (href: string) => (href.startsWith("http") ? href : BASE + href);

/**
 * Zustand eines Events nach denselben Regeln wie craftattack.one.
 * `now` ist die aktuelle Zeit als "YYYY-MM-DDTHH:MM" in Europe/Berlin.
 */
export function eventState(e: Pick<OfficialEvent, "date" | "end" | "time" | "endTime">, now: string): EventState {
  const today = now.slice(0, 10);
  if (e.end < today || (e.endTime && `${e.end}T${e.endTime}` <= now)) return "past";
  if (e.date > today) return "upcoming";
  if (!e.time || `${e.date}T${e.time}` > now) return "today";
  return "live";
}

/** Teilnehmer aus dem Abschnitt "Mit dabei" einer Event-Seite (`<article class="player" data-player="…">`) */
async function fetchParticipants(href: string): Promise<string[] | null> {
  try {
    const res = await fetchCraftAttack(href, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const start = html.search(/aria-labelledby="dabei"/);
    if (start < 0) return null;
    const section = html.slice(start, html.indexOf("</section>", start));
    return [...new Set([...section.matchAll(/data-player="([^"]+)"/g)].map((m) => m[1]))];
  } catch {
    return null;
  }
}

/** Liest die Event-Karten von craftattack.one/events/ samt Teilnehmern (gecacht, 1 Stunde). */
export async function getOfficialEvents(): Promise<{ events: OfficialEvent[]; error: string | null }> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetchCraftAttack(`${BASE}/events/`, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = (await res.text()).replace(/ data-astro-cid-[a-z0-9]+(="[^"]*")?/g, "");
    const events: OfficialEvent[] = [];

    // Abschnitte pro Staffel: <section ...> <h2>Name</h2> <a class="btn" href="/staffeln/..."> und die Karten
    for (const sec of html.split(/<section\b/).slice(1)) {
      const season = strip(sec.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
      const seasonHref = sec.match(/href="(\/staffeln\/[^"]+)"/)?.[1] ?? null;
      for (const m of sec.matchAll(/<a\b([^>]*\bevent-card\b[^>]*)>([\s\S]*?)<\/a>/g)) {
        const a = attrs(m[1]);
        const inner = m[2];
        const title = strip(inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "");
        const date = a["data-event-date"];
        if (!title || !a.href || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue;
        events.push({
          title,
          text: strip(inner.match(/<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ""),
          href: absolute(a.href),
          date,
          end: a["data-event-end"] || date,
          time: a["data-event-time"] || null,
          endTime: a["data-event-end-time"] || null,
          season,
          seasonHref: seasonHref ? absolute(seasonHref) : null,
          participantCount: Number(inner.match(/aria-label="(\d+) dabei"/)?.[1] ?? 0),
          participants: [...inner.matchAll(/\/skins\/([\w-]+)-head\./g)].map((h) => h[1]),
        });
      }
    }

    // Ändert die Seite ihr Format, lieber laut melden als still "Nichts angekündigt" zeigen
    const cards = html.match(/data-event-date="/g)?.length ?? 0;
    if (cards > events.length) throw new Error(`Unbekanntes Format: ${events.length} von ${cards} Event-Karten gelesen`);

    // Die Karte zeigt nur einige Köpfe; die vollständige Liste steht auf der Event-Seite.
    // Nacheinander abfragen, damit craftattackFetch die Pausen nach einer Sperre einhalten kann.
    for (const e of events) {
      if (e.participants.length >= e.participantCount) continue;
      const all = await fetchParticipants(e.href);
      if (all?.length) e.participants = all;
    }

    events.sort((a, b) => `${b.date}T${b.time ?? ""}`.localeCompare(`${a.date}T${a.time ?? ""}`));
    return { events, error: null };
  } catch (err) {
    return { events: [], error: err instanceof Error ? err.message : String(err) };
  }
}
