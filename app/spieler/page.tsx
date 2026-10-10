import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { duration, headUrl, num, ago } from "@/lib/format";

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export const metadata: Metadata = { title: "Spieler" };

export default function Page(props: PageProps<"/spieler">) {
  return (
      <Players searchParams={props.searchParams} />
  );
}

async function Players({ searchParams }: { searchParams: PageProps<"/spieler">["searchParams"] }) {
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" ? sp.filter : "alle";
  const { state, now } = await loadTracker();

  let players = Object.values(state.players);
  if (filter === "online") players = players.filter((p) => p.online);
  if (filter === "live") players = players.filter((p) => p.live);
  players.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const av = a.live?.viewers ?? -1;
    const bv = b.live?.viewers ?? -1;
    if (av !== bv) return bv - av;
    return (b.stats.playtimeSeconds ?? 0) - (a.stats.playtimeSeconds ?? 0) || a.name.localeCompare(b.name, "de");
  });

  const counts = {
    alle: Object.keys(state.players).length,
    online: Object.values(state.players).filter((p) => p.online).length,
    live: Object.values(state.players).filter((p) => p.live).length,
  };

  return (
    <>
      <section className="block page-head" data-tone="grass">
        <div className="wrap">
          <p className="eyebrow">Alle, die der Tracker je gesehen hat</p>
          <h1 className="t-1">Spieler</h1>
          <p>
            Jeder, der seit Start des Trackers online war, gestreamt hat oder in einer Bestenliste aufgetaucht ist.
            Die Zahlen sind der letzte bekannte Stand.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <ul className="filters" aria-label="Filter">
              {(["alle", "online", "live"] as const).map((f) => (
                <li key={f}>
                  <Link className="tag" aria-current={filter === f ? "true" : undefined} href={f === "alle" ? "/spieler" : `/spieler?filter=${f}`}>
                    {f === "alle" ? "Alle" : f === "online" ? "Online" : "Live"} <span className="num">({counts[f]})</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="muted num">{num(players.length)} Spieler</p>
          </div>

          {players.length === 0 ? (
            <p className="st-online__empty">Noch niemand erfasst. Gib dem Tracker eine Minute.</p>
          ) : (
            <ul className="grid" style={{ "--min": "240px", "--gap": "16px", listStyle: "none", padding: 0, margin: 0 } as React.CSSProperties}>
              {players.map((p) => (
                <li key={p.id}>
                  <Link className="box player-card" data-tone="white" href={`/spieler/${encodeURIComponent(p.id)}`}>
                    <div className="player-card__top">
                      <img className="head" src={headUrl(p.uuid, 48)} alt="" width={48} height={48} loading="lazy" />
                      <div>
                        <p className="player-card__name">{p.name}</p>
                        <div className="player-card__tags">
                          {p.online ? (
                            <span className="tag" data-tone="grass">
                              <span className="dot" /> Online
                            </span>
                          ) : (
                            <span className="tag" data-tone="paper">
                              Offline
                            </span>
                          )}
                          {p.live && (
                            <span className="tag" data-tone="twitch">
                              <span className="dot dot--live" /> {num(p.live.viewers)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <dl className="player-card__stats">
                      <dt>Spielzeit</dt>
                      <dd className="num">{p.stats.playtimeSeconds !== undefined ? duration(p.stats.playtimeSeconds) : "–"}</dd>
                      <dt>Tode</dt>
                      <dd className="num">{p.stats.deaths !== undefined ? num(p.stats.deaths) : "–"}</dd>
                      <dt title="Vom Tracker gemessen, für alle Spieler">Online (Tracker)</dt>
                      <dd className="num">
                        {duration(p.trackedSeconds + (p.online && p.sessionStart ? (now - Date.parse(p.sessionStart)) / 1000 : 0))}
                      </dd>
                      <dt>Sessions</dt>
                      <dd className="num">{num(p.sessions)}</dd>
                      <dt>Zuletzt</dt>
                      <dd className="num">{p.online ? "jetzt" : ago(p.lastSeen)}</dd>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
