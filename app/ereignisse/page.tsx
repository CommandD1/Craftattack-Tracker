import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { EVENT_GROUPS, typesForGroup } from "@/lib/events";
import { num } from "@/lib/format";
import { EventFeed } from "@/components/EventFeed";

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export const metadata: Metadata = { title: "Ereignisse" };

const PAGE = 100;

export default function Page(props: PageProps<"/ereignisse">) {
  return (
      <Events searchParams={props.searchParams} />
  );
}

function qs(o: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function Events({ searchParams }: { searchParams: PageProps<"/ereignisse">["searchParams"] }) {
  const sp = await searchParams;
  const g = typeof sp.g === "string" ? sp.g : undefined;
  const where = typeof sp.wo === "string" ? sp.wo : undefined;
  const player = typeof sp.spieler === "string" ? sp.spieler : undefined;
  const page = Math.max(1, Number(sp.seite ?? 1) || 1);

  const { state, events } = await loadTracker();
  const types = typesForGroup(g);

  let list = [...events].reverse();
  if (types) list = list.filter((e) => types.includes(e.type));
  if (where === "server" || where === "twitch") list = list.filter((e) => e.where === where);
  if (player) list = list.filter((e) => e.player === player);

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const slice = list.slice((page - 1) * PAGE, page * PAGE);
  const playerName = player ? state.players[player]?.name ?? player : null;

  return (
    <>
      <section className="block page-head" data-tone="gold">
        <div className="wrap">
          <p className="eyebrow">Chronik</p>
          <h1 className="t-1">Ereignisse</h1>
          <p>
            Jede Änderung, die der Tracker in den offiziellen Stats entdeckt hat. Joins, Leaves, Tode, Loot und
            Streams – mit Uhrzeit.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="eyebrow">Filter</p>
              <ul className="filters" aria-label="Kategorie">
                <li>
                  <Link className="tag" aria-current={!g ? "true" : undefined} href={`/ereignisse${qs({ wo: where, spieler: player })}`}>
                    Alles
                  </Link>
                </li>
                {EVENT_GROUPS.map((grp) => (
                  <li key={grp.key}>
                    <Link
                      className="tag"
                      aria-current={g === grp.key ? "true" : undefined}
                      href={`/ereignisse${qs({ g: grp.key, wo: where, spieler: player })}`}
                    >
                      {grp.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="filters" aria-label="Wo">
                <li>
                  <Link className="tag" aria-current={!where ? "true" : undefined} href={`/ereignisse${qs({ g, spieler: player })}`}>
                    Überall
                  </Link>
                </li>
                <li>
                  <Link className="tag" aria-current={where === "server" ? "true" : undefined} href={`/ereignisse${qs({ g, wo: "server", spieler: player })}`}>
                    Auf dem Server
                  </Link>
                </li>
                <li>
                  <Link className="tag" aria-current={where === "twitch" ? "true" : undefined} href={`/ereignisse${qs({ g, wo: "twitch", spieler: player })}`}>
                    Auf Twitch
                  </Link>
                </li>
                {playerName && (
                  <li>
                    <Link className="tag" data-tone="amethyst" aria-current="true" href={`/ereignisse${qs({ g, wo: where })}`} title="Filter entfernen">
                      {playerName} ✕
                    </Link>
                  </li>
                )}
              </ul>
            </div>
            <p className="muted num">{num(total)} Treffer</p>
          </div>

          <EventFeed events={slice} />

          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {page > 1 && (
                <Link className="btn btn--small" data-tone="white" href={`/ereignisse${qs({ g, wo: where, spieler: player, seite: String(page - 1) })}`}>
                  ← Neuer
                </Link>
              )}
              <span className="btn btn--small" data-tone="ink" aria-current="true">
                {page} / {pages}
              </span>
              {page < pages && (
                <Link className="btn btn--small" data-tone="white" href={`/ereignisse${qs({ g, wo: where, spieler: player, seite: String(page + 1) })}`}>
                  Älter →
                </Link>
              )}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
