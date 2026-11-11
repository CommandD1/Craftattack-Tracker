import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { EventFeed } from "@/components/EventFeed";
import { Head } from "@/components/Head";
import { ShowMore } from "@/components/ShowMore";
import { EVENT_ICON, Icon } from "@/components/Icons";
import { loadTracker } from "@/lib/data";
import { getEventDetail } from "@/lib/eventDetail";
import { EVENT_META, eventBadge, eventHref, eventPlayers } from "@/lib/events";
import { getFeedFilter } from "@/lib/feedThresholds";
import { dateTime, num } from "@/lib/format";
import { previewEventHref, previewGate } from "@/lib/preview";
import { findVodAt, vodLink } from "@/lib/twitch";
import type { TrackerEvent } from "@/lib/types";
import { EventWindowChart } from "../../../_components/EventWindowChart";

export const metadata: Metadata = { title: "Ereignis" };

const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });

/** „vor 3 Min“ / „nach 2 Std 5 Min“ relativ zum Ereignis */
function rel(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  const s = m < 60 ? `${m} Min` : m < 1440 ? `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ""}` : `${Math.round(m / 1440)} Tagen`;
  return ms < 0 ? `${s} davor` : `${s} danach`;
}

async function Detail(props: PageProps<"/vorschau/[key]/ereignis/[id]">) {
  const root = await previewGate(props.params);
  const { id: raw } = await props.params;
  const id = decodeURIComponent(raw);
  const [d, { state }, isShown] = await Promise.all([getEventDetail(id), loadTracker(), getFeedFilter()]);
  if (!d) notFound();
  const e = d.event;
  const at = Date.parse(e.at);
  const meta = EVENT_META[e.type];
  const IconCmp = Icon[EVENT_ICON[e.type]];
  const href = (x: TrackerEvent) => previewEventHref(root, x.id);
  const p = e.player ? state.players[e.player] : undefined;
  const name = e.playerName ?? p?.name ?? e.player ?? "";
  const sentence = [e.player ? `${name} ${meta.text(e)}` : meta.text(e), meta.sub?.(e)].filter(Boolean).join(" · ");
  const badge = eventBadge(e);
  const login = p?.twitchLogin ?? p?.live?.login ?? null;
  const vod =
    typeof e.meta?.vodUrl === "string"
      ? e.meta.vodUrl
      : login
        ? await findVodAt(login, at - 30_000)
            .then((v) => (v ? vodLink(v.vodId, v.offset) : null))
            .catch(() => null)
        : null;
  const others = eventPlayers(e).filter((x) => x !== e.player);
  const present = d.present
    .map((x) => ({ ...x, p: state.players[x.id] }))
    .filter((x) => x.p)
    .sort((a, b) => Number(b.online) - Number(a.online) || (b.viewers ?? -1) - (a.viewers ?? -1));
  const onServer = present.filter((x) => x.online);
  const liveElsewhere = present.filter((x) => !x.online && x.viewers !== null);
  const label = meta.label;

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">
            Vorschau · <Link href={`${root}/ereignisse`}>Ereignisse</Link> · {label}
          </p>
          <div className="vs-hero">
            {e.player && <Head id={e.player} uuid={e.uuid ?? p?.uuid} name={name} size={72} src={128} decorative />}
            <div>
              <h1 className="t-1" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <IconCmp width={36} height={36} aria-hidden="true" /> {label}
                {badge ? <span className="num">{badge}</span> : null}
              </h1>
              <p className="vs-hero__text">{sentence}</p>
            </div>
          </div>
          <ul className="vs-facts">
            <li className="tag" data-tone="white">
              {dayLong.format(at)} Uhr
            </li>
            <li className="tag" data-tone={e.where === "twitch" ? "twitch" : "white"}>
              {e.where === "twitch" ? "Auf Twitch" : "Auf dem Server"}
            </li>
            {/* Nur bei Ereignissen ohne Zählerstand: dort ist jedes Ereignis genau ein Vorkommen (Tode z. B. gibt es doppelt aus Feed und Stats) */}
            {d.same.total > 0 && e.value === undefined && (
              <li className="tag" data-tone="white" title={e.player ? `„${label}“ von ${name} insgesamt` : `„${label}“ insgesamt`}>
                {num(d.same.nth)}. von {num(d.same.total)}
                {e.player ? ` bei ${name}` : ""}
              </li>
            )}
            {vod && (
              <li>
                <a className="tag" data-tone="twitch" href={vod} target="_blank" rel="noopener noreferrer">
                  ▶ Im VOD ansehen
                </a>
              </li>
            )}
            {e.player && (
              <li>
                <Link className="tag" data-tone="white" href={`/spieler/${encodeURIComponent(e.player)}`}>
                  Profil von {name}
                </Link>
              </li>
            )}
            <li>
              <Link className="tag" data-tone="white" href={eventHref(e)}>
                Alle „{label}“{e.player ? ` von ${name}` : ""}
              </Link>
            </li>
          </ul>
          {others.length > 0 && (
            <p style={{ marginTop: 12 }}>
              Beteiligt:{" "}
              {others.map((o, i) => (
                <span key={o}>
                  {i > 0 && ", "}
                  <Link href={`/spieler/${encodeURIComponent(o)}`}>
                    {state.players[o]?.name ?? o}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <nav className="vs-nav" aria-label={`Vorheriges und nächstes „${label}“`}>
            {d.same.prev ? (
              <Link className="btn btn--small" data-tone="white" href={href(d.same.prev)} title={dateTime(d.same.prev.at)}>
                ← Voriges „{label}“ ({rel(Date.parse(d.same.prev.at) - at)})
              </Link>
            ) : (
              <span className="muted">Das erste „{label}“{e.player ? ` von ${name}` : ""}</span>
            )}
            {d.same.next ? (
              <Link className="btn btn--small" data-tone="white" href={href(d.same.next)} title={dateTime(d.same.next.at)}>
                Nächstes „{label}“ ({rel(Date.parse(d.same.next.at) - at)}) →
              </Link>
            ) : (
              <span className="muted">Das letzte bisher</span>
            )}
          </nav>

          {(d.stat || d.viewers.length > 0 || d.online.length > 1) && (
            <div className="vs-two">
              {d.stat && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">
                    {d.stat.label} von {name}
                  </h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    3 Stunden davor bis 3 Stunden danach, gestrichelt: das Ereignis.
                  </p>
                  <EventWindowChart points={d.stat.points} from={d.window.from} to={d.window.to} at={at} label={`${d.stat.label} von ${name} rund um das Ereignis`} format={d.stat.format} tone="var(--presence)" step />
                </div>
              )}
              {d.viewers.length > 0 && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">Zuschauer von {name}</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Live auf Twitch; Lücken = nicht live.
                  </p>
                  <EventWindowChart points={d.viewers} from={d.window.from} to={d.window.to} at={at} label={`Zuschauer von ${name} rund um das Ereignis`} tone="var(--twitch)" />
                </div>
              )}
              {d.online.length > 1 && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">Spieler auf dem Server</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Wie voll der Server rund um das Ereignis war.
                  </p>
                  <EventWindowChart points={d.online} from={d.window.from} to={d.window.to} at={at} label="Spieler auf dem Server rund um das Ereignis" tone="var(--ink)" step />
                </div>
              )}
            </div>
          )}

          {e.player && (
            <div className="vs-two">
              <div className="box" data-tone="white">
                <h3 className="t-3">Davor bei {name}</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Die letzten Ereignisse vor diesem, neuestes zuletzt.
                </p>
                <EventFeed events={d.before} focus={e.player} isShown={isShown} hrefFor={href} empty="Davor nichts." />
                <p className="vs-now">▼ {label} · {dayLong.format(at)}</p>
              </div>
              <div className="box" data-tone="white">
                <h3 className="t-3">Danach bei {name}</h3>
                <p className="vs-now">▲ {label} · {dayLong.format(at)}</p>
                <EventFeed events={d.after} focus={e.player} isShown={isShown} hrefFor={href} empty="Danach (noch) nichts." />
              </div>
            </div>
          )}

          <div className="box" data-tone="white">
            <h3 className="t-3">Was sonst passierte</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              Ereignisse anderer Spieler 15 Minuten davor bis 15 Minuten danach, der Reihe nach ({num(d.around.length)}).
            </p>
            <ShowMore height={700} label="Ereignisse">
              <EventFeed events={d.around} isShown={isShown} hrefFor={href} empty="Sonst passierte in dieser Zeit nichts." />
            </ShowMore>
          </div>

          <div className="box" data-tone="white">
            <h3 className="t-3">Wer gerade da war</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              {num(onServer.length)} auf dem Server{onServer.filter((x) => x.viewers !== null).length ? `, davon ${num(onServer.filter((x) => x.viewers !== null).length)} live (lila Rand)` : ""}
              {liveElsewhere.length ? ` · ${num(liveElsewhere.length)} live woanders (blass)` : ""}.
            </p>
            <ul className="vs-heads">
              {[...onServer, ...liveElsewhere].map((x) => (
                <li key={x.id} data-live={x.viewers !== null ? "" : undefined} data-off={!x.online ? "" : undefined}>
                  <Link href={`/spieler/${encodeURIComponent(x.id)}`} title={`${x.p!.name}${x.viewers !== null ? ` · ${num(x.viewers)} Zuschauer` : ""}${x.online ? "" : " · nicht auf dem Server"}`}>
                    <Head id={x.id} uuid={x.p!.uuid} name={x.p!.name} size={32} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/ereignis/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Ereignis" figs={0} />}>
      <Detail {...props} />
    </Suspense>
  );
}
