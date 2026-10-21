import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeletons";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getOfficialEvents, type OfficialEvent } from "@/lib/officialEvents";
import { loadTracker } from "@/lib/data";
import { EventFeed } from "@/components/EventFeed";


export const metadata: Metadata = { title: "Events" };

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

function stateOf(e: OfficialEvent, today: string): { label: string; key: "upcoming" | "today" | "past" } {
  if (e.end < today) return { label: "Vorbei", key: "past" };
  if (e.date <= today && today <= e.end) return { label: "Heute", key: "today" };
  return { label: "Kommt noch", key: "upcoming" };
}

/** Öffnet sofort mit Überschrift und Platzhaltern; die Daten werden nachgestreamt. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Offizielle Termine" title="Events" tone="amethyst" />}>
      <Events />
    </Suspense>
  );
}

function Card({ e, today }: { e: OfficialEvent; today: string }) {
  const st = stateOf(e, today);
  const tone = st.key === "today" ? "redstone" : st.key === "upcoming" ? "grass" : "paper";
  return (
    <li>
      <a className="box event-card" href={e.href} target="_blank" rel="noopener" data-tone="white">
        <div className="event-card__tags">
          <span className="tag" data-tone="amethyst">
            <time dateTime={e.date}>{dateFmt.format(new Date(e.date + "T12:00:00Z"))}</time>
            {e.end !== e.date && <> – {dateFmt.format(new Date(e.end + "T12:00:00Z"))}</>}
          </span>
          <span className="tag" data-tone={tone}>
            {st.label}
          </span>
        </div>
        <h3 className="t-3">{e.title}</h3>
        {e.text && <p>{e.text}</p>}
        <div className="event-card__foot">
          <span className="muted" style={{ fontSize: ".9375rem" }}>
            {e.season}
          </span>
          <span className="event-card__go" aria-hidden="true">
            Ansehen →
          </span>
        </div>
      </a>
    </li>
  );
}

async function Events() {
  await connection();
  const [{ events, error }, { events: tracked }] = await Promise.all([getOfficialEvents(), loadTracker()]);
  const today = dayKey.format(new Date());
  const current = events.filter((e) => e.season.includes("14"));
  const older = events.filter((e) => !e.season.includes("14"));
  const upcoming = current.filter((e) => stateOf(e, today).key !== "past");
  const past = current.filter((e) => stateOf(e, today).key === "past");
  const serverEvents = [...tracked].reverse().filter((e) => e.type === "server_online" || e.type === "server_offline" || e.type === "tracker_start").slice(0, 20);

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Offizielle Termine</p>
          <h1 className="t-1">Events</h1>
          <p>
            Was auf dem Server geplant ist und wann. Die Termine kommen von der{" "}
            <a href="https://craftattack.one/events/" target="_blank" rel="noopener">
              offiziellen Events-Seite
            </a>{" "}
            und werden stündlich abgeglichen.
          </p>
        </div>
      </section>

      <section className="block" data-tone="ender-2">
        <div className="wrap stack" style={{ "--stack": "32px" } as React.CSSProperties}>
          <div className="section-head">
            <div className="stack" style={{ "--stack": "8px" } as React.CSSProperties}>
              <p className="eyebrow">Läuft gerade</p>
              <h2 className="t-2">CraftAttack 14</h2>
            </div>
            <a className="btn btn--small" data-tone="white" href="https://craftattack.one/staffeln/craftattack-14/" target="_blank" rel="noopener">
              Zur Staffel
            </a>
          </div>

          {error && (
            <div className="box" data-tone="gold">
              <p className="t-3">Events gerade nicht abrufbar.</p>
              <p>{error}</p>
            </div>
          )}

          <div className="stack">
            <h3 className="eyebrow">Kommt noch</h3>
            {upcoming.length === 0 ? (
              <p className="st-online__empty">Nichts angekündigt. Kommt bestimmt noch.</p>
            ) : (
              <ol className="grid" style={{ "--min": "280px", listStyle: "none", margin: 0, padding: 0 } as React.CSSProperties}>
                {upcoming.map((e) => (
                  <Card key={e.href} e={e} today={today} />
                ))}
              </ol>
            )}
          </div>

          {past.length > 0 && (
            <div className="stack">
              <h3 className="eyebrow">Schon vorbei</h3>
              <ol className="grid" style={{ "--min": "280px", listStyle: "none", margin: 0, padding: 0 } as React.CSSProperties}>
                {past.map((e) => (
                  <Card key={e.href} e={e} today={today} />
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      {older.length > 0 && (
        <section className="block" data-tone="paper">
          <div className="wrap stack" style={{ "--stack": "24px" } as React.CSSProperties}>
            <h2 className="t-2">Frühere Staffeln</h2>
            <ol className="grid" style={{ "--min": "280px", listStyle: "none", margin: 0, padding: 0 } as React.CSSProperties}>
              {older.map((e) => (
                <Card key={e.href} e={e} today={today} />
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="block" data-tone="paper" style={older.length > 0 ? { paddingTop: 0 } : undefined}>
        <div className="wrap">
          <div className="section-head">
            <div className="stack" style={{ "--stack": "8px" } as React.CSSProperties}>
              <h2 className="t-2">Server-Chronik</h2>
              <p className="lead">Was der Tracker selbst gesehen hat: Server an, Server aus, Start der Aufzeichnung.</p>
            </div>
            <Link className="btn btn--small" data-tone="white" href="/ereignisse?g=server">
              Alle Server-Ereignisse
            </Link>
          </div>
          <EventFeed events={serverEvents} empty="Seit Start des Trackers war der Server durchgehend online." />
        </div>
      </section>
    </>
  );
}
