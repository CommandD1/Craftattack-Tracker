import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeletons";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { EVENT_GROUPS, EVENT_META, EVENT_TYPES, TIME_RANGES, isShownEvent, sharedChatPlayers, typesForGroup } from "@/lib/events";
import type { EventType } from "@/lib/types";
import { num } from "@/lib/format";
import { EventFeed } from "@/components/EventFeed";
import { EVENT_ICON, Icon } from "@/components/Icons";
import { getAllSessions } from "@/lib/store";
import { getPlayerEventTimeState } from "@/lib/playerEventStatus";
import { Head } from "@/components/Head";
import { PresenceLegend } from "@/components/HowLink";


export const metadata: Metadata = { title: "Ereignisse" };

const PAGE = 100;

/** Öffnet sofort mit Überschrift und Platzhaltern; die Daten werden nachgestreamt. */
export default function Page(props: PageProps<"/ereignisse">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Chronik" title="Ereignisse" />}>
      <Events searchParams={props.searchParams} />
    </Suspense>
  );
}

type Query = { g?: string; t?: string; wo?: string; spieler?: string; zeit?: string; seite?: string };

function qs(o: Query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

async function Events({ searchParams }: { searchParams: PageProps<"/ereignisse">["searchParams"] }) {
  const sp = await searchParams;
  const t = EVENT_TYPES.includes(str(sp.t) as EventType) ? (str(sp.t) as EventType) : undefined;
  // Einzeltyp gewinnt über die Gruppe; Gruppe des Typs wird mit angezeigt
  const g = t ? EVENT_GROUPS.find((grp) => grp.types.includes(t))?.key : str(sp.g);
  const where = str(sp.wo) === "server" || str(sp.wo) === "twitch" ? str(sp.wo) : undefined;
  const player = str(sp.spieler);
  const zeit = TIME_RANGES.some((r) => r.key === str(sp.zeit)) ? str(sp.zeit) : undefined;
  const page = Math.max(1, Number(sp.seite ?? 1) || 1);
  const q: Query = { g, t, wo: where, spieler: player, zeit };

  const { state, events, now } = await loadTracker();

  // Basisfilter (ohne Kategorie), damit die Zusammenfassung pro Kategorie stimmt
  const range = TIME_RANGES.find((r) => r.key === zeit)?.ms ?? null;
  const since = range ? now - range : 0;
  let base = [...events].reverse().filter(isShownEvent);
  if (since) base = base.filter((e) => Date.parse(e.at) >= since);
  if (where) base = base.filter((e) => e.where === where);
  if (player) base = base.filter((e) => e.player === player || e.meta?.raidTargetPlayerId === player || sharedChatPlayers(e).includes(player));

  const types = t ? [t] : typesForGroup(g);
  const list = types ? base.filter((e) => types.includes(e.type)) : base;

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const slice = list.slice((page - 1) * PAGE, page * PAGE);
  const playerName = player ? state.players[player]?.name ?? player : null;
  const getTimeState = player
    ? await getPlayerEventTimeState({
        playerEvents: events.filter((event) => event.player === player),
        displayEvents: slice,
        serverSessions: (await getAllSessions()).filter((session) => session.player === player),
        liveSince: state.players[player]?.liveSince ?? null,
        liveLogin: state.players[player]?.live?.login ?? state.players[player]?.twitchLogin ?? null,
        now,
      })
    : undefined;

  const groupCounts = EVENT_GROUPS.map((grp) => ({ ...grp, n: base.filter((e) => grp.types.includes(e.type)).length }));
  const groupTypes = g ? typesForGroup(g) ?? [] : [];
  const typeCounts = groupTypes.map((ty) => ({ type: ty, n: base.filter((e) => e.type === ty).length }));

  const playersSorted = Object.values(state.players).sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Chronik</p>
          <h1 className="t-1">Ereignisse</h1>
          <p>
            Jede Änderung, die der Tracker in den offiziellen Stats oder im Twitch-Chat entdeckt hat – mit Uhrzeit.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <ul className="grid ev-summary" aria-label="Kategorien">
            <li>
              <Link href={`/ereignisse${qs({ ...q, g: undefined, t: undefined })}`} aria-current={!g ? "true" : undefined} data-tone={!g ? "ink" : "white"}>
                <span className="num">{num(base.length)}</span>
                <span className="eyebrow">Alles</span>
              </Link>
            </li>
            {groupCounts.map((grp) => (
              <li key={grp.key}>
                <Link
                  href={`/ereignisse${qs({ ...q, g: grp.key, t: undefined })}`}
                  aria-current={g === grp.key && !t ? "true" : undefined}
                  data-tone={g === grp.key ? "ink" : "white"}
                >
                  <span className="num">{num(grp.n)}</span>
                  <span className="eyebrow">
                    <span className="swatch" data-tone={grp.tone} aria-hidden="true" /> {grp.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="ev-filters">
            {typeCounts.length > 1 && (
              <div className="ev-filters__row">
                <p className="eyebrow">Art</p>
                <ul className="filters" aria-label="Art">
                  <li>
                    <Link className="tag" aria-current={!t ? "true" : undefined} href={`/ereignisse${qs({ ...q, t: undefined })}`}>
                      Alle
                    </Link>
                  </li>
                  {typeCounts.map(({ type, n }) => {
                    const IconCmp = Icon[EVENT_ICON[type]];
                    return (
                      <li key={type}>
                        <Link className="tag" aria-current={t === type ? "true" : undefined} href={`/ereignisse${qs({ ...q, t: type })}`}>
                          <IconCmp width={14} height={14} aria-hidden="true" /> {EVENT_META[type].label} <span className="num">({num(n)})</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="ev-filters__row">
              <p className="eyebrow">Zeitraum</p>
              <ul className="filters" aria-label="Zeitraum">
                {TIME_RANGES.map((r) => (
                  <li key={r.key}>
                    <Link
                      className="tag"
                      aria-current={(zeit ?? "alle") === r.key ? "true" : undefined}
                      href={`/ereignisse${qs({ ...q, zeit: r.key === "alle" ? undefined : r.key })}`}
                    >
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ev-filters__row">
              <p className="eyebrow">Wo</p>
              <ul className="filters" aria-label="Wo">
                <li>
                  <Link className="tag" aria-current={!where ? "true" : undefined} href={`/ereignisse${qs({ ...q, wo: undefined })}`}>
                    Überall
                  </Link>
                </li>
                <li>
                  <Link className="tag" aria-current={where === "server" ? "true" : undefined} href={`/ereignisse${qs({ ...q, wo: "server" })}`}>
                    Auf dem Server
                  </Link>
                </li>
                <li>
                  <Link className="tag" aria-current={where === "twitch" ? "true" : undefined} href={`/ereignisse${qs({ ...q, wo: "twitch" })}`}>
                    Auf Twitch
                  </Link>
                </li>
              </ul>
            </div>

            <div className="ev-filters__row">
              <p className="eyebrow">Spieler</p>
              <form className="ev-form" method="get" action="/ereignisse">
                {g && <input type="hidden" name="g" value={g} />}
                {t && <input type="hidden" name="t" value={t} />}
                {where && <input type="hidden" name="wo" value={where} />}
                {zeit && <input type="hidden" name="zeit" value={zeit} />}
                <select name="spieler" defaultValue={player ?? ""} aria-label="Spieler">
                  <option value="">Alle Spieler</option>
                  {playersSorted.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.online ? " · online" : ""}
                    </option>
                  ))}
                </select>
                <button className="btn btn--small" data-tone="ink" type="submit">
                  Zeigen
                </button>
                {playerName && (
                  <Link className="tag tag--head" data-tone="white" href={`/ereignisse${qs({ ...q, spieler: undefined })}`} aria-label={`Filter ${playerName} entfernen`}>
                    <Head id={player!} uuid={state.players[player!]?.uuid} name={playerName} size={20} src={32} decorative /> {playerName} ✕
                  </Link>
                )}
              </form>
            </div>
          </div>

          <div className="section-head">
            <p className="muted num">
              {num(total)} Treffer
              {pages > 1 ? ` · Seite ${page} von ${pages}` : ""}
            </p>
            {(g || t || where || player || zeit) && (
              <Link className="btn btn--small" data-tone="white" href="/ereignisse">
                Filter zurücksetzen
              </Link>
            )}
          </div>

          <EventFeed events={slice} showPlayer={!player} getTimeState={getTimeState} />
          {player && (
            <PresenceLegend />
          )}

          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {page > 1 && (
                <Link className="btn btn--small" data-tone="white" href={`/ereignisse${qs({ ...q, seite: String(page - 1) })}`}>
                  ← Neuer
                </Link>
              )}
              <span className="btn btn--small" data-tone="ink" aria-current="true">
                {page} / {pages}
              </span>
              {page < pages && (
                <Link className="btn btn--small" data-tone="white" href={`/ereignisse${qs({ ...q, seite: String(page + 1) })}`}>
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
