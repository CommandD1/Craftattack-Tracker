import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { BOARD_KEYS, type BoardKey, type TrackerEvent } from "@/lib/types";
import { ago, boardValue, dateTime, duration, headUrl, num, skinUrl } from "@/lib/format";
import { EventFeed } from "@/components/EventFeed";
import { BOARD_ICON, Icon } from "@/components/Icons";
import { FigValue } from "@/components/FigValue";
import { PlayerCharts } from "@/components/PlayerCharts";
import { getAllSessions, getPlayerHistory } from "@/lib/store";
import { companionsOf, overlapsFor } from "@/lib/overlap";
import { TwitchEmbed } from "@/components/TwitchEmbed";

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/spieler/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

const LABEL: Record<BoardKey, string> = {
  playtimeSeconds: "Spielzeit",
  diamonds: "Diamanten",
  deaths: "Tode",
  blocksBroken: "Blöcke",
  mobsKilled: "Mobs",
  distance: "Strecke",
};
const TONE: Record<BoardKey, string> = {
  playtimeSeconds: "sky",
  diamonds: "diamond",
  deaths: "redstone",
  blocksBroken: "gold",
  mobsKilled: "grass",
  distance: "pink",
};

export default function Page(props: PageProps<"/spieler/[id]">) {
  return (
      <Player params={props.params} />
  );
}

interface Session {
  start: string;
  end: string | null;
  seconds: number;
}

/** Baut aus Join/Leave-Ereignissen eine Session-Liste. */
function sessions(events: TrackerEvent[], online: boolean, sessionStart: string | null, now: number): Session[] {
  const out: Session[] = [];
  let open: string | null = null;
  for (const e of events) {
    if (e.type === "join") open = e.at;
    if (e.type === "leave") {
      out.push({ start: open ?? e.at, end: e.at, seconds: Number(e.meta?.sessionSeconds ?? 0) });
      open = null;
    }
  }
  if (online && sessionStart) {
    out.push({ start: sessionStart, end: null, seconds: (now - Date.parse(sessionStart)) / 1000 });
  }
  return out.reverse();
}

async function Player({ params }: { params: PageProps<"/spieler/[id]">["params"] }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw).toLowerCase();
  const { state, events, now } = await loadTracker();
  const p = state.players[id];
  if (!p) notFound();
  const [history, allSessions] = await Promise.all([getPlayerHistory(id), getAllSessions()]);
  const overlaps = overlapsFor(id, allSessions, now);
  const nameOf = (pid: string) => state.players[pid]?.name ?? pid;

  const mine = events.filter((e) => e.player === id);
  const sess = sessions(mine, p.online, p.sessionStart, now);
  const recent = [...mine].reverse().slice(0, 150);
  const deaths = mine.filter((e) => e.type === "death").reduce((s, e) => s + (e.delta ?? 0), 0);
  // Rang: bevorzugt aus /api/ext/<id> (für alle Spieler), sonst Position in der Top 10 der Haupt-API
  const ranks = Object.fromEntries(
    BOARD_KEYS.map((k) => {
      const ext = k !== "playtimeSeconds" ? p.ranks?.[k] : undefined;
      if (ext) return [k, { rank: ext.rank, of: ext.of }];
      const pos = (state.latest?.boards?.[k] ?? []).findIndex((e) => e.id === id) + 1;
      return [k, pos > 0 ? { rank: pos, of: null } : null];
    }),
  ) as Record<BoardKey, { rank: number; of: number | null } | null>;

  return (
    <>
      <section className="block page-head" data-tone={p.live ? "twitch" : p.online ? "grass" : "sky"}>
        <div className="wrap">
          <p className="eyebrow">
            <Link href="/spieler" style={{ textDecoration: "none" }}>
              Spieler
            </Link>{" "}
            / Profil
          </p>
          <div className="player-head" style={{ marginTop: 16 }}>
            <img className="skin" src={skinUrl(p.uuid, 256, p.id)} alt={`Skin von ${p.name}`} width={180} height={200} />
            <div>
              <h1 className="t-1">{p.name}</h1>
              <div className="player-head__tags">
                {p.online ? (
                  <span className="tag" data-tone="grass">
                    <span className="dot" /> Online seit {p.sessionStart ? ago(p.sessionStart).replace("vor ", "") : "–"}
                  </span>
                ) : (
                  <span className="tag" data-tone="paper">
                    Offline · zuletzt {ago(p.lastSeen)}
                  </span>
                )}
                {p.live ? (
                  <a className="tag" data-tone="ink" href={`https://www.twitch.tv/${encodeURIComponent(p.live.login)}`} target="_blank" rel="noopener">
                    <span className="dot dot--live" /> Live · {num(p.live.viewers)} Zuschauer
                  </a>
                ) : (
                  <span className="tag" data-tone="paper">
                    Nicht live
                  </span>
                )}
                <span className="tag" data-tone="white">
                  Erfasst seit {dateTime(p.firstSeen)}
                </span>
              </div>
            </div>
          </div>
          {p.live && (
            <p style={{ marginTop: 20, fontWeight: 600 }} title={p.live.title}>
              „{p.live.title}“
            </p>
          )}
        </div>
      </section>

      {p.live && <TwitchEmbed login={p.live.login} name={p.name} />}

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <h2 className="sr-only">Statistiken</h2>
          <dl className="grid st-figs st-figs--6">
            {BOARD_KEYS.map((k) => {
              const IconCmp = Icon[BOARD_ICON[k]];
              const v = p.stats[k];
              return (
                <div key={k} className="box st-fig" data-tone={TONE[k]}>
                  <dt>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <IconCmp width={18} height={18} aria-hidden="true" /> {LABEL[k]}
                      {ranks[k] && (
                        <span
                          className="tag"
                          data-tone="ink"
                          style={{ margin: 0, fontSize: ".75rem" }}
                          title={ranks[k].of ? `Platz ${ranks[k].rank} von ${ranks[k].of}` : `Platz ${ranks[k].rank} in der Top 10`}
                        >
                          #{ranks[k].rank}
                          {ranks[k].of ? <span className="muted">/{ranks[k].of}</span> : null}
                        </span>
                      )}
                    </span>
                  </dt>
                  <FigValue>{v !== undefined ? boardValue(k, v) : "–"}</FigValue>
                </div>
              );
            })}
          </dl>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            Tode, Diamanten, Blöcke, Mobs und Strecke kommen aus der Einzelstatistik der API (inklusive Rang unter allen
            Teilnehmenden). Die Spielzeit liefert die API nur für die Top 10 – steht dort „–“, ist {p.name} (noch) nicht drin.
          </p>
          <PlayerCharts points={history} name={p.name} />
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap">
          <div className="grid" style={{ "--min": "300px", "--gap": "24px" } as React.CSSProperties}>
            <div style={{ gridColumn: "span 2" }}>
              <div className="section-head">
                <h2 className="t-2">Verlauf</h2>
                <Link className="btn btn--small" data-tone="white" href={`/ereignisse?spieler=${encodeURIComponent(id)}`}>
                  Alle {num(mine.length)}
                </Link>
              </div>
              <EventFeed events={recent} showPlayer={false} empty={`Für ${p.name} wurde noch nichts aufgezeichnet.`} />
            </div>
            <aside className="stack" style={{ "--stack": "16px" } as React.CSSProperties}>
              <div className="box" data-tone="white">
                <p className="eyebrow" style={{ marginBottom: 10 }}>
                  Vom Tracker gemessen
                </p>
                <dl className="player-card__stats" style={{ borderTop: 0, paddingTop: 0 }}>
                  <dt>Sessions</dt>
                  <dd className="num">{num(p.sessions)}</dd>
                  <dt>Online-Zeit</dt>
                  <dd className="num">
                    {duration(p.trackedSeconds + (p.online && p.sessionStart ? (now - Date.parse(p.sessionStart)) / 1000 : 0))}
                  </dd>
                  <dt>Tode gesehen</dt>
                  <dd className="num">{num(deaths)}</dd>
                  <dt>Längste Session</dt>
                  <dd className="num">{p.longestSession > 0 ? duration(p.longestSession) : "–"}</dd>
                  <dt>Peak-Zuschauer</dt>
                  <dd className="num">{num(p.peakViewers)}</dd>
                  <dt>Ereignisse</dt>
                  <dd className="num">{num(mine.length)}</dd>
                </dl>
              </div>
              <section className="box st-board" data-tone="sky" aria-labelledby="b-with">
                <header className="st-board__head">
                  <span className="st-board__icon">
                    <Icon.users aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="t-3" id="b-with">
                      Mitspieler
                    </h3>
                    <p className="st-board__sub">Meiste gemeinsame Online-Zeit</p>
                  </div>
                </header>
                <ol className="st-board__list">
                  {overlaps.length === 0 ? (
                    <li className="st-board__note">Noch keine Überschneidung gesehen.</li>
                  ) : (
                    overlaps.slice(0, 10).map((o, i) => (
                      <li key={o.player}>
                        <Link
                          className="st-board__row"
                          href={`/spieler/${encodeURIComponent(o.player)}`}
                          title={`${nameOf(o.player)}: ${duration(o.seconds)} gemeinsam online in ${num(o.sessions)} Sessions`}
                        >
                          <span className="st-board__rank num">{i + 1}</span>
                          <img className="head" src={headUrl(state.players[o.player]?.uuid, 28, o.player)} alt="" width={28} height={28} loading="lazy" />
                          <span className="st-board__name">
                            {nameOf(o.player)}
                            {o.now && <span className="dot" style={{ marginLeft: 8 }} title="gerade gemeinsam online" />}
                          </span>
                          <span className="st-board__val num">{duration(o.seconds)}</span>
                        </Link>
                      </li>
                    ))
                  )}
                </ol>
                <p className="muted" style={{ marginTop: 10, fontSize: ".875rem" }}>
                  Seit Tracker-Start, aus den Join/Leave-Ereignissen berechnet. Der grüne Punkt heißt: gerade gemeinsam online.
                </p>
              </section>
              <div className="box" data-tone="white">
                <p className="eyebrow" style={{ marginBottom: 10 }}>
                  Sessions
                </p>
                {sess.length === 0 ? (
                  <p className="muted">Noch keine komplette Session gesehen.</p>
                ) : (
                  <ul className="sessions">
                    {sess.slice(0, 12).map((s) => {
                      const with_ = companionsOf(id, s.start, s.end, allSessions, now);
                      const shown = with_.slice(0, 4);
                      return (
                        <li key={s.start}>
                          <span>
                            {dateTime(s.start)}
                            {s.end ? ` – ${dateTime(s.end).split(", ").pop()}` : " – jetzt"}
                            {with_.length > 0 && (
                              <span
                                className="muted session-with"
                                title={with_.map((w) => `${nameOf(w.player)} (${duration(w.seconds)})`).join(", ")}
                              >
                                mit {shown.map((w) => nameOf(w.player)).join(", ")}
                                {with_.length > shown.length ? ` +${with_.length - shown.length}` : ""}
                              </span>
                            )}
                          </span>
                          <span className="num">{duration(s.seconds)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
