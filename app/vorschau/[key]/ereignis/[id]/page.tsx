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
import { getEventPair } from "@/lib/eventPair";
import { EVENT_META, eventBadge, eventHref, eventPlayers } from "@/lib/events";
import { getFeedFilter } from "@/lib/feedThresholds";
import { dateTime, distance, duration, hearts, num } from "@/lib/format";
import { previewEventHref, previewGate } from "@/lib/preview";
import { findVodAt, vodLink } from "@/lib/twitch";
import { BOARD_KEYS, type TrackerEvent } from "@/lib/types";
import { EventWindowChart } from "../../../_components/EventWindowChart";
import { EventSteps } from "../../../_components/EventSteps";
import { EventOccurrences } from "../../../_components/EventOccurrences";
import { EventMatrix } from "../../../_components/EventMatrix";
import { PairMatrix } from "../../../_components/PairMatrix";

export const metadata: Metadata = { title: "Ereignis" };

const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });

const localParts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Zeitpunkt als `datetime-local`-Wert in deutscher Zeit („2026-11-10T23:02“), wie ihn /graph erwartet */
const localTime = (ms: number) => localParts.format(ms).replace(" ", "T");

/** Kurzname eines zugehörigen Ereignisses: „Meilenstein 200.000“, „Platz 1“, „Blöcke +2.707“ */
function relLabel(x: TrackerEvent): string {
  if (x.type === "rank") return `Platz ${x.value ?? "?"} bei „${String(x.meta?.label ?? "")}“`;
  if (x.type === "milestone") return `Meilenstein ${num(x.value ?? 0)}`;
  if (x.type === "record") return `Rekord: ${num(x.value ?? 0)} ${String(x.meta?.label ?? "")}`.trim();
  if (x.type === "join" || x.type === "first_join" || x.type === "stream_start" || x.type === "raid") return `${EVENT_META[x.type].label} von ${x.playerName ?? x.player ?? "?"}`;
  return `${EVENT_META[x.type].label} ${eventBadge(x) ?? ""}`.trim();
}

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
  const pair = await getEventPair(e);
  const pname = (pid: string) => state.players[pid]?.name ?? pid;
  const puuid = (pid: string) => state.players[pid]?.uuid ?? "";
  const names: Record<string, [string, string]> = Object.fromEntries(Object.values(state.players).map((x) => [x.id, [x.name, x.uuid]]));
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
  // Graph-Seite mit genau diesem Ausschnitt (datetime-local in deutscher Zeit)
  const graph = (metric: string, spieler: string[]) => {
    const q = new URLSearchParams({ metric, zeit: "eigen", von: localTime(d.window.from), bis: localTime(d.window.to) });
    if (spieler.length) q.set("spieler", spieler.join(","));
    return `/graph?${q}`;
  };
  // Köpfe und Namen für „Wann noch“
  const who = d.all.who.map(([wid]) => [wid, state.players[wid]?.name ?? wid, state.players[wid]?.uuid ?? ""] as [string, string, string]);
  // Stärke im Format des Zählers (Zuwachs bzw. Meilenstein), sonst als Zahl
  const intensityFormat = e.type === "rank" ? "rank" : d.stat && e.type !== "death" ? d.stat.format : "num";
  // Zuwachs im Format des Zählers (km, Herzen, Zeit, Anzahl)
  const fmtStat = (v: number) => (d.stat?.format === "distance" ? distance(v) : d.stat?.format === "duration" ? duration(v) : d.stat?.format === "hearts" ? `${hearts(v)} Herzen` : num(v));
  // Meilensteine und Ränge derselben Familie als Rauten im Verlauf (ohne dieses Ereignis selbst)
  const marks = (d.related ? [...d.related.ladder, ...d.related.together.filter((x) => x.type === "milestone" || x.type === "rank")] : [])
    .filter((x, i, a) => x.id !== e.id && a.findIndex((y) => y.id === x.id) === i)
    .map((x) => ({ t: Date.parse(x.at), label: `${relLabel(x)} · ${dayLong.format(Date.parse(x.at))} Uhr`, href: href(x) }));
  const milestones = d.related ? d.related.ladder.filter((x) => x.type === "milestone") : [];
  const ranks = d.related ? d.related.ladder.filter((x) => x.type === "rank") : [];
  const detailBase = `${root}/ereignis/`;
  // Berliner Tag des Ereignisses (für die Häufigkeit je Tag)
  const eventDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);
  const playersWithSame = new Set(d.all.points.map((x) => x[2])).size;

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">
            Vorschau · <Link href={`${root}/ereignisse`}>Ereignisse</Link> · {label}
          </p>
          <div className="vs-hero">
            {e.player && !pair && <Head id={e.player} uuid={e.uuid ?? p?.uuid} name={name} size={72} src={128} decorative />}
            <div>
              <h1 className="t-1" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <IconCmp width={36} height={36} aria-hidden="true" /> {label}
                {badge ? <span className="num">{badge}</span> : null}
              </h1>
              {pair ? (
                <div className="vs-pair" style={{ marginTop: 12 }}>
                  <Link className="vs-pair__side" href={`/spieler/${encodeURIComponent(pair.giver)}`}>
                    <Head id={pair.giver} uuid={puuid(pair.giver)} name={pname(pair.giver)} size={56} src={64} decorative />
                    <span>
                      <b>{pname(pair.giver)}</b>
                      <span className="vs-pair__role">{pair.gives}</span>
                    </span>
                  </Link>
                  <span className="vs-pair__arrow" aria-hidden="true">
                    →
                  </span>
                  <Link className="vs-pair__side" href={`/spieler/${encodeURIComponent(pair.receiver)}`}>
                    <Head id={pair.receiver} uuid={puuid(pair.receiver)} name={pname(pair.receiver)} size={56} src={64} decorative />
                    <span>
                      <b>{pname(pair.receiver)}</b>
                      <span className="vs-pair__role">
                        {pair.gets} {pname(pair.giver)}
                      </span>
                    </span>
                  </Link>
                </div>
              ) : null}
              {e.type === "chat" && typeof e.meta?.message === "string" ? (
                <blockquote className="vs-talk__bubble" style={{ marginTop: 14, fontSize: "1.125rem", color: "var(--ink)" }}>
                  {e.meta.message}
                </blockquote>
              ) : (
                <p className="vs-hero__text">{sentence}</p>
              )}
              {pair && (
                <p className="muted" style={{ marginTop: 8 }}>
                  {num(pair.together)} {pair.noun} von {pname(pair.giver)} an {pname(pair.receiver)} in der Staffel, {num(pair.reverse)} in die andere Richtung.
                </p>
              )}
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
          {d.related && (d.related.together.length > 0 || d.related.cause) && (
            <ul className="vs-rel" aria-label="Gehört zusammen">
              {d.related.cause && (
                <li>
                  <a
                    className="tag"
                    data-tone="gold"
                    href="#rohdaten"
                    title="Der Zuwachs steht in den Rohdaten unten (dunkle Säule); er war zu klein für ein eigenes Ereignis"
                  >
                    ⇄ ausgelöst durch +{fmtStat(d.related.cause.d)} {d.related.label}{" "}
                    <span className="muted">
                      ({rel(d.related.cause.at - at).replace(/^0 Min (davor|danach)$/, "gleiche Minute")}
                      {d.related.cause.eventMin !== null && d.related.cause.d < d.related.cause.eventMin
                        ? `, unter der Ereignis-Schwelle von ${fmtStat(d.related.cause.eventMin)} – daher kein eigenes Ereignis`
                        : ""}
                      )
                    </span>
                  </a>
                </li>
              )}
              {d.related.together.map((x) => (
                <li key={x.id}>
                  <Link className="tag" data-tone="gold" href={href(x)} title={`${relLabel(x)} · ${dayLong.format(Date.parse(x.at))} Uhr`}>
                    ⇄ {relLabel(x)} <span className="muted">({rel(Date.parse(x.at) - at).replace(/^0 Min (davor|danach)$/, "gleiche Minute")})</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && !pair && (
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
                    {d.stat.label}
                    {e.player ? ` von ${name}` : ""}
                  </h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    3 Stunden davor bis 3 Stunden danach, gestrichelt: das Ereignis{marks.length ? "; Rauten: Meilensteine und Ränge derselben Art" : ""}.
                  </p>
                  <EventWindowChart
                    points={d.stat.points}
                    from={d.window.from}
                    to={d.window.to}
                    at={at}
                    label={`${d.stat.label}${e.player ? ` von ${name}` : ""} rund um das Ereignis`}
                    format={d.stat.format}
                    tone="var(--presence)"
                    step
                    href={graph(d.stat.metric, e.player ? [e.player] : [])}
                    marks={marks}
                  />
                </div>
              )}
              {d.viewers.length > 0 && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">Zuschauer von {name}</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Live auf Twitch; Lücken = nicht live.
                  </p>
                  <EventWindowChart points={d.viewers} from={d.window.from} to={d.window.to} at={at} label={`Zuschauer von ${name} rund um das Ereignis`} tone="var(--twitch)" href={e.player ? graph("viewers", [e.player]) : undefined} />
                </div>
              )}
              {d.online.length > 1 && d.stat?.metric !== "onlineCount" && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">Spieler auf dem Server</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Wie voll der Server rund um das Ereignis war.
                  </p>
                  <EventWindowChart points={d.online} from={d.window.from} to={d.window.to} at={at} label="Spieler auf dem Server rund um das Ereignis" tone="var(--ink)" step href={graph("onlineCount", [])} />
                </div>
              )}
            </div>
          )}

          {d.stat && d.stat.hasSteps && d.stat.steps.length > 0 && (
            <div className="box" data-tone="white" id="rohdaten">
              <h3 className="t-3">Rohdaten: {d.stat.label} je Messung</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                {d.stat.key === "followers"
                  ? "Jede Säule: neue Follower je Minute zwischen zwei Messungen, während der Streamer auf dem Server war – auch, wenn es kein Ereignis wurde."
                  : d.stat.key === "twitchSubs"
                    ? "Jede Säule: Abos in dieser Minute im Kanal, während der Streamer auf dem Server war – auch die kleinen Minuten, die es nicht in den Feed geschafft haben."
                    : d.stat.key === "twitchBits"
                      ? "Jede Säule ist ein Cheer im Kanal – auch die kleinen, die kein Ereignis wurden."
                      : `Jede Säule ist der Zuwachs zwischen zwei Messungen (${(BOARD_KEYS as string[]).includes(d.stat.key) ? "etwa jede Minute" : "etwa alle 5 Minuten"}) – auch der, der kein Ereignis wurde.`}
                {d.stat.eventMin !== null ? " Über der gestrichelten Linie legt der Tracker ein Ereignis an." : " Für diesen Wert gibt es nur Meilensteine, keine Zuwachs-Ereignisse."}
              </p>
              {d.stat.streak && (
                <p className="vs-now">
                  Teil einer Serie: {num(d.stat.streak.count)} Messungen in Folge über der Schwelle, {dateTime(new Date(d.stat.streak.from).toISOString())}–
                  {dateTime(new Date(d.stat.streak.to).toISOString()).slice(-5)} Uhr
                </p>
              )}
              <EventSteps
                steps={d.stat.steps}
                from={d.window.from}
                to={d.window.to}
                at={at}
                eventMin={d.stat.eventMin}
                feedMin={d.stat.feedMin}
                streak={d.stat.streak}
                format={d.stat.format}
                label={`Zuwachs ${d.stat.label} je Messung rund um das Ereignis`}
                per={d.stat.per}
              />
            </div>
          )}

          {d.related && e.player && ((milestones.length > 0 && e.type !== "milestone") || ranks.length > 0) && (
            <div className="box" data-tone="white">
              <h3 className="t-3">Zusammenhänge: {d.related.label}</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Meilensteine und Ränge von {name} in „{d.related.label}“ über die Staffel – sie entstehen aus denselben Zuwächsen wie
                dieses Ereignis. Klick öffnet sie.
              </p>
              {/* Bei Meilensteinen zeigt „Wann noch“ dieselbe Treppe schon */}
              {milestones.length > 0 && e.type !== "milestone" && (
                <EventOccurrences
                  points={milestones.map((x, i) => [Date.parse(x.at), x.value ?? 0, -1, i] as [number, number, number, number])}
                  ids={milestones.map((x) => x.id)}
                  who={[]}
                  current={e.id}
                  hrefBase={detailBase}
                  format={d.stat?.format ?? "num"}
                  label={`Meilensteine von ${name} in ${d.related.label}`}
                />
              )}
              {ranks.length > 0 && (
                <>
                  <p className="eyebrow" style={{ marginTop: 12 }}>
                    Ränge in „{String(ranks[0].meta?.label ?? d.related.label)}“
                  </p>
                  <ul className="vs-rel">
                    {ranks.map((x) => (
                      <li key={x.id}>
                        <Link className="tag" data-tone={x.id === e.id ? "ink" : x.value === 1 ? "gold" : "white"} href={href(x)} aria-current={x.id === e.id ? "true" : undefined}>
                          Platz {x.value} <span className="muted">(vorher {String(x.meta?.before ?? "–")}) · {dayLong.format(Date.parse(x.at)).split(" um ")[0]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {pair && pair.talk.length > 0 && (
            <div className="box" data-tone="white">
              <h3 className="t-3">Unterhaltung</h3>
              <p className="muted" style={{ marginBottom: 12 }}>
                Was erfasste Spieler 45 Minuten davor bis danach im Chat von {pname(pair.receiver)} geschrieben haben – und was {pname(pair.receiver)} bei{" "}
                {pname(pair.giver)} zurückschrieb (lila). Klick öffnet die Nachricht.
              </p>
              <ShowMore height={640} label="Nachrichten">
                <ul className="vs-talk">
                  {pair.talk.map((m) => {
                    const from = m.player ?? "";
                    const back = from === pair.receiver;
                    return (
                      <li key={m.id} data-cur={m.id === e.id ? "" : undefined} data-in={back ? "" : undefined}>
                        <Head id={from} uuid={puuid(from)} name={pname(from)} size={32} />
                        <Link className="vs-talk__bubble" href={href(m)}>
                          <span className="vs-talk__meta">
                            <b>{pname(from)}</b>
                            {back ? ` bei ${pname(pair.giver)}` : ""} · {dayLong.format(Date.parse(m.at)).split(" um ")[1] ?? ""}
                            {m.id === e.id ? " · diese Nachricht" : ""}
                          </span>
                          {String(m.meta?.message ?? "")}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </ShowMore>
            </div>
          )}

          {pair && (
            <>
              <div className="vs-two">
                {[
                  { id: pair.giver, days: pair.giverDays, text: `${pname(pair.giver)} ${pair.gives} …` },
                  { id: pair.receiver, days: pair.receiverDays, text: `${pname(pair.receiver)} ${pair.gets} …` },
                ].map((side) => (
                  <div className="box" data-tone="white" key={side.id}>
                    <h3 className="t-3">{side.text}</h3>
                    <p className="muted" style={{ marginBottom: 8 }}>
                      … jemandem bzw. von jemandem, je Tag ({num(side.days.reduce((s, x) => s + x.n, 0))} insgesamt). Klick öffnet das erste des Tages.
                    </p>
                    <EventOccurrences
                      points={side.days.map((x, i) => [Date.parse(`${x.day}T12:00:00Z`), x.n, -1, i] as [number, number, number, number])}
                      ids={side.days.map((x) => x.first)}
                      who={[]}
                      current={side.days.find((x) => x.day === eventDay)?.first ?? ""}
                      hrefBase={detailBase}
                      format="num"
                      label={`${side.text} je Tag`}
                    />
                  </div>
                ))}
              </div>
              <div className="box" data-tone="white">
                <h3 className="t-3">Wer → wen</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  {pair.noun} zwischen allen Spielern: Zeilen geben, Spalten bekommen, Kreisfläche = Anzahl. Ring: {pname(pair.giver)} → {pname(pair.receiver)}, gestrichelt: zurück.
                </p>
                <PairMatrix matrix={pair.matrix} names={names} giver={pair.giver} receiver={pair.receiver} hrefBase={detailBase} noun={pair.noun} />
              </div>
            </>
          )}

          {d.frequency ? (
            <div className="stack">
              {e.player && d.frequency.mine.length > 0 && (
                <div className="box" data-tone="white">
                  <h3 className="t-3">Wann noch bei {name}</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    „{label}“ von {name} je Tag ({num(d.frequency.mine.reduce((s, x) => s + x.n, 0))} insgesamt) – alle gleich stark, deshalb zählt, wie oft. Klick öffnet das erste des Tages.
                  </p>
                  <EventOccurrences
                    points={d.frequency.mine.map((x, i) => [Date.parse(`${x.day}T12:00:00Z`), x.n, -1, i] as [number, number, number, number])}
                    ids={d.frequency.mine.map((x) => x.first)}
                    who={[]}
                    current={d.frequency.mine.find((x) => x.day === eventDay)?.first ?? ""}
                    hrefBase={detailBase}
                    format="num"
                    label={`„${label}“ von ${name} je Tag`}
                  />
                </div>
              )}
              <div className="box" data-tone="white">
                <h3 className="t-3">Bei allen Spielern</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Wie oft die {num(d.frequency.players.length)} aktivsten Spieler „{label}“ hatten, je Tag; Kreisfläche = Anzahl{e.player ? `, Ring: ${name} an diesem Tag` : ""}.
                </p>
                <EventMatrix
                  players={d.frequency.players.map((pid) => [pid, state.players[pid]?.name ?? pid, state.players[pid]?.uuid ?? ""] as [string, string, string])}
                  days={d.frequency.days}
                  cells={d.frequency.cells}
                  currentPlayer={e.player ?? null}
                  currentDay={eventDay}
                  hrefBase={detailBase}
                  noun={`× „${label}“`}
                />
              </div>
            </div>
          ) : (
          <div className="stack">
            {d.mine && e.player && (
              <div className="box" data-tone="white">
                <h3 className="t-3">Wann noch bei {name}</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Jedes „{label}“ von {name} in der Staffel{d.mine.partial ? " (die neuesten)" : ""}; je höher, desto stärker. Dieses ist das {num(d.mine.rank)}.-stärkste von {num(d.mine.total)}.
                </p>
                <EventOccurrences points={d.mine.points} ids={d.mine.ids} who={[]} current={e.id} hrefBase={detailBase} format={intensityFormat} label={`Alle „${label}“ von ${name} in der Staffel`} />
              </div>
            )}
            <div className="box" data-tone="white">
              {e.type === "record" ? (
                <>
                  <h3 className="t-3">Verlauf dieses Rekords</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Jeder neue Rekord „{String(e.meta?.label ?? label)}“ der Staffel ({num(d.all.total)}), Höhe = Rekordwert. Klick öffnet ihn.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="t-3">Bei allen Spielern</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Die {num(d.all.points.length)} stärksten „{label}“ von {num(playersWithSame)} Spielern, die 60 stärksten mit Kopf. Dieses ist auf Platz {num(d.all.rank)} von {num(d.all.total)}.
                  </p>
                </>
              )}
              <EventOccurrences points={d.all.points} ids={d.all.ids} who={who} current={e.id} hrefBase={detailBase} format={intensityFormat} label={e.type === "record" ? `Verlauf des Rekords ${String(e.meta?.label ?? "")}` : `Die stärksten „${label}“ aller Spieler`} heads={e.type !== "record"} />
            </div>
          </div>
          )}

          {e.player && (
            <div className="vs-two">
              <div className="box" data-tone="white">
                <h3 className="t-3">Davor bei {name}</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Die letzten Ereignisse vor diesem, neuestes zuletzt.
                </p>
                <EventFeed events={d.before} focus={e.player} isShown={isShown} hrefFor={href} richTips empty="Davor nichts." />
                <p className="vs-now">▼ {label} · {dayLong.format(at)}</p>
              </div>
              <div className="box" data-tone="white">
                <h3 className="t-3">Danach bei {name}</h3>
                <p className="vs-now">▲ {label} · {dayLong.format(at)}</p>
                <EventFeed events={d.after} focus={e.player} isShown={isShown} hrefFor={href} richTips empty="Danach (noch) nichts." />
              </div>
            </div>
          )}

          {pair && (
            <div className="vs-two">
              <div className="box" data-tone="white">
                <h3 className="t-3">Davor bei {pname(pair.other.id)}</h3>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Die andere Seite: was {pname(pair.other.id)} vorher erlebte.
                </p>
                <EventFeed events={pair.other.before} focus={pair.other.id} isShown={isShown} hrefFor={href} richTips empty="Davor nichts." />
                <p className="vs-now">▼ {label} · {dayLong.format(at)}</p>
              </div>
              <div className="box" data-tone="white">
                <h3 className="t-3">Danach bei {pname(pair.other.id)}</h3>
                <p className="vs-now">▲ {label} · {dayLong.format(at)}</p>
                <EventFeed events={pair.other.after} focus={pair.other.id} isShown={isShown} hrefFor={href} richTips empty="Danach (noch) nichts." />
              </div>
            </div>
          )}

          <div className="box" data-tone="white">
            <h3 className="t-3">Was sonst passierte</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              Ereignisse anderer Spieler 15 Minuten davor bis 15 Minuten danach, der Reihe nach ({num(d.around.length)}).
            </p>
            <ShowMore height={700} label="Ereignisse">
              <EventFeed events={d.around} isShown={isShown} hrefFor={href} richTips empty="Sonst passierte in dieser Zeit nichts." />
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
