import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { BOARD_KEYS, type BoardKey, type TrackerEvent } from "@/lib/types";
import { ago, boardValue, dateTime, duration, headUrl, num } from "@/lib/format";
import { EventFeed } from "@/components/EventFeed";
import { BOARD_ICON, Icon } from "@/components/Icons";
import { FigValue } from "@/components/FigValue";
import { PlayerCharts } from "@/components/PlayerCharts";
import { getPlayerHistory } from "@/lib/store";
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
  const history = await getPlayerHistory(id);

  const mine = events.filter((e) => e.player === id);
  const sess = sessions(mine, p.online, p.sessionStart, now);
  const recent = [...mine].reverse().slice(0, 150);
  const deaths = mine.filter((e) => e.type === "death").reduce((s, e) => s + (e.delta ?? 0), 0);
  const ranks = Object.fromEntries(
    BOARD_KEYS.map((k) => [k, (state.latest?.boards?.[k] ?? []).findIndex((e) => e.id === id) + 1]),
  ) as Record<BoardKey, number>;

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
            <img className="head" src={headUrl(p.uuid, 112, p.id)} alt={`Kopf von ${p.name}`} width={112} height={112} />
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
                      {ranks[k] > 0 && <span className="tag" data-tone="ink" style={{ margin: 0, fontSize: ".75rem" }}>#{ranks[k]}</span>}
                    </span>
                  </dt>
                  <FigValue>{v !== undefined ? boardValue(k, v) : "–"}</FigValue>
                </div>
              );
            })}
          </dl>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            Die API liefert nur die Top 10 jeder Liste. Steht hier „–“, ist {p.name} dort (noch) nicht drin.
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
              <div className="box" data-tone="white">
                <p className="eyebrow" style={{ marginBottom: 10 }}>
                  Sessions
                </p>
                {sess.length === 0 ? (
                  <p className="muted">Noch keine komplette Session gesehen.</p>
                ) : (
                  <ul className="sessions">
                    {sess.slice(0, 12).map((s) => (
                      <li key={s.start}>
                        <span>
                          {dateTime(s.start)}
                          {s.end ? ` – ${dateTime(s.end).split(", ").pop()}` : " – jetzt"}
                        </span>
                        <span className="num">{duration(s.seconds)}</span>
                      </li>
                    ))}
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
