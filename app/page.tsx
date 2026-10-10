import Link from "next/link";
import { loadTracker } from "@/lib/data";
import { BOARD_KEYS, type BoardKey } from "@/lib/types";
import { boardValue, headUrl, num, duration, dateTime } from "@/lib/format";
import { StatusLine } from "@/components/StatusLine";
import { EventFeed } from "@/components/EventFeed";
import { Sparkline } from "@/components/Sparkline";
import { BOARD_ICON, Icon } from "@/components/Icons";
import { FigValue } from "@/components/FigValue";

const BOARDS: Record<BoardKey, { title: string; sub: string; tone: string }> = {
  playtimeSeconds: { title: "Dauerzocker", sub: "Meiste Spielzeit", tone: "sky" },
  diamonds: { title: "Diamantenbank", sub: "Wer hat, der hat", tone: "diamond" },
  deaths: { title: "Friedhof", sub: "Hier liegen sie. Immer wieder.", tone: "ender" },
  blocksBroken: { title: "Abrissbirne", sub: "Meiste Blöcke abgebaut", tone: "gold" },
  mobsKilled: { title: "Monsterjäger", sub: "Meiste Mobs erledigt", tone: "grass" },
  distance: { title: "Weltenbummler", sub: "Weiteste Strecke", tone: "pink" },
};

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export default function Home() {
  return (
      <Dashboard />
  );
}

async function Dashboard() {
  const { state, events, now } = await loadTracker();
  const s = state.latest;
  const liveList = s ? [...(s.live ?? [])].sort((a, b) => b.viewers - a.viewers) : [];
  const viewers = liveList.reduce((a, l) => a + l.viewers, 0);
  const recent = [...events].reverse().slice(0, 25);
  const hist = state.history.slice(-240); // letzte 2 Std
  const trackedPlayers = Object.keys(state.players).length;
  // Vom Tracker selbst gemessene Online-Zeit – für alle Spieler, nicht nur die Top 10 der API
  const trackedTime = Object.values(state.players)
    .map((p) => ({
      ...p,
      seconds: p.trackedSeconds + (p.online && p.sessionStart ? (now - Date.parse(p.sessionStart)) / 1000 : 0),
    }))
    .filter((p) => p.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10);

  return (
    <div className="st" data-state={s ? (s.serverOnline ? "ok" : "offline") : "loading"}>
      <section className="block page-head" data-tone="diamond">
        <div className="wrap">
          <p className="eyebrow">Live vom Server · inoffizieller Tracker</p>
          <h1 className="hero__logo">
            <img
              src="/img/ca14-wordmark.webp"
              srcSet="/img/ca14-wordmark-480.webp 480w, /img/ca14-wordmark.webp 880w"
              sizes="(max-width: 560px) 70vw, 360px"
              alt="CraftAttack 14"
              width={880}
              height={591}
              fetchPriority="high"
              decoding="async"
            />
          </h1>
          <p>
            Wer ist drauf, wer streamt, wer stirbt – und <strong>wann</strong> genau. Der Tracker merkt sich
            jede Änderung der offiziellen Stats und macht daraus eine Chronik.
          </p>
          <StatusLine state={state} />
          {s && !s.serverOnline && (
            <div className="box st-banner" data-tone="redstone" role="status">
              <p className="t-3 st-banner__title">Der Server ist gerade offline.</p>
              <p>Neustart, Wartung oder Feierabend. Die Zahlen unten sind der letzte Stand.</p>
            </div>
          )}
          {!s && state.lastError && (
            <div className="box st-banner" data-tone="gold" role="status">
              <p className="t-3 st-banner__title">Keine Verbindung zur API.</p>
              <p>{state.lastError} – wir versuchen es alle 30 Sekunden automatisch wieder.</p>
            </div>
          )}
        </div>
      </section>

      <section className="block block--tight" data-tone="ink" aria-labelledby="fig-h">
        <div className="wrap">
          <h2 className="sr-only" id="fig-h">
            Auf einen Blick
          </h2>
          <dl className="grid st-figs st-figs--6">
            <Link href="/spieler?filter=online" className="box st-fig" data-tone="grass">
              <dt>Online</dt>
              <FigValue>{s ? num(s.onlineCount) : "–"}</FigValue>
            </Link>
            <Link href="/live" className="box st-fig" data-tone="amethyst">
              <dt>Live auf Twitch</dt>
              <FigValue>{s ? num(liveList.length) : "–"}</FigValue>
            </Link>
            <Link href="/live" className="box st-fig" data-tone="twitch">
              <dt>Zuschauer</dt>
              <FigValue>{s ? num(viewers) : "–"}</FigValue>
            </Link>
            <div className="box st-fig" data-tone="diamond">
              <dt>Stunden gespielt</dt>
              <FigValue>{s ? num(s.totals.playtimeSeconds / 3600) : "–"}</FigValue>
            </div>
            <Link href="/ereignisse?g=death" className="box st-fig" data-tone="redstone">
              <dt>Tode</dt>
              <FigValue>{s ? num(s.totals.deaths) : "–"}</FigValue>
            </Link>
            <Link href="/ereignisse" className="box st-fig" data-tone="gold">
              <dt>Ereignisse</dt>
              <FigValue>{num(state.eventCount)}</FigValue>
            </Link>
          </dl>
        </div>
      </section>

      <section className="block block--tight" data-tone="grass" aria-labelledby="online-h">
        <div className="wrap">
          <h2 className="t-2 st-online__h" id="online-h">
            <span className="dot" aria-hidden="true" /> Gerade online{" "}
            {s && s.online.length > 0 && <span className="num">({s.online.length})</span>}
          </h2>
          {s && s.online.length > 0 ? (
            <ul className="st-chips">
              {[...s.online]
                .sort((a, b) => (b.live?.viewers ?? -1) - (a.live?.viewers ?? -1))
                .map((p) => (
                  <li key={p.id}>
                    <Link
                      className="st-chip-in"
                      data-live={p.live ? "true" : undefined}
                      href={`/spieler/${encodeURIComponent(p.id)}`}
                      title={p.live?.title}
                    >
                      <img className="head" src={headUrl(p.uuid, 32)} alt="" width={32} height={32} loading="lazy" />
                      <span>{p.name}</span>
                      {p.live && (
                        <span className="st-livetag">
                          <span className="dot dot--live" /> {num(p.live.viewers)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="st-online__empty">
              {s
                ? s.serverOnline
                  ? "Gerade ist keiner drauf. Alle am Schlafen?"
                  : "Der Server ist offline, also ist auch keiner drauf."
                : "Sobald die erste Abfrage durch ist, siehst du hier, wer drauf ist."}
            </p>
          )}
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="feed-h">
        <div className="wrap">
          <div className="section-head">
            <div className="stack" style={{ "--stack": "8px" } as React.CSSProperties}>
              <h2 className="t-2" id="feed-h">
                Zuletzt passiert
              </h2>
              <p className="lead">Was, wer, wo, wann. Neuestes oben.</p>
            </div>
            <Link className="btn btn--small" data-tone="white" href="/ereignisse">
              Alle Ereignisse
            </Link>
          </div>
          <div className="grid" style={{ "--min": "300px", "--gap": "24px" } as React.CSSProperties}>
            <div style={{ gridColumn: "span 2" }} className="feed-col">
              <EventFeed events={recent} />
            </div>
            <aside className="stack" style={{ "--stack": "16px" } as React.CSSProperties}>
              <div className="box spark-card" data-tone="white">
                <div className="spark-card__head">
                  <span className="eyebrow">Online · 2 Std</span>
                  <span className="num spark-card__val">{s ? num(s.onlineCount) : "–"}</span>
                </div>
                <Sparkline points={hist.map((h) => ({ at: h.at, v: h.onlineCount }))} format={num} label="Online" />
              </div>
              <div className="box spark-card" data-tone="white">
                <div className="spark-card__head">
                  <span className="eyebrow">Zuschauer · 2 Std</span>
                  <span className="num spark-card__val">{num(viewers)}</span>
                </div>
                <Sparkline points={hist.map((h) => ({ at: h.at, v: h.viewers }))} format={num} label="Zuschauer" />
              </div>
              <div className="box spark-card" data-tone="white">
                <div className="spark-card__head">
                  <span className="eyebrow">Tracker</span>
                </div>
                <dl className="player-card__stats" style={{ borderTop: 0, paddingTop: 0 }}>
                  <dt>Läuft seit</dt>
                  <dd className="num">{duration((now - Date.parse(state.startedAt)) / 1000)}</dd>
                  <dt>Spieler erfasst</dt>
                  <dd className="num">{num(trackedPlayers)}</dd>
                  <dt>Abfragen</dt>
                  <dd className="num">{num(state.polls)}</dd>
                  <dt>Ereignisse</dt>
                  <dd className="num">{num(state.eventCount)}</dd>
                </dl>
              </div>
              <div className="box spark-card" data-tone="gold">
                <div className="spark-card__head">
                  <span className="eyebrow">Rekorde seit Start</span>
                </div>
                <div className="records">
                  {(
                    [
                      ["peakOnline", "Gleichzeitig online"],
                      ["peakLive", "Gleichzeitig live"],
                      ["peakViewers", "Zuschauer gesamt"],
                    ] as const
                  ).map(([k, label]) => {
                    const r = state.records[k];
                    return (
                      <div className="records__row" key={k}>
                        <span>{label}</span>
                        <span className="num">{r ? num(r.value) : "–"}</span>
                        {r && <small>{dateTime(r.at)}</small>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="boards-h" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2 className="t-2" id="boards-h">
              Bestenlisten
            </h2>
            <Link className="btn btn--small" data-tone="white" href="/bestenlisten">
              Mehr als Top 10
            </Link>
          </div>
          <div className="grid st-boards">
            {BOARD_KEYS.map((key) => {
              const b = BOARDS[key];
              const IconCmp = Icon[BOARD_ICON[key]];
              const list = s?.boards?.[key] ?? [];
              return (
                <section className="box st-board" data-tone={b.tone} key={key} aria-labelledby={`b-${key}`}>
                  <header className="st-board__head">
                    <span className="st-board__icon">
                      <IconCmp aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="t-3" id={`b-${key}`}>
                        {b.title}
                      </h3>
                      <p className="st-board__sub">{b.sub}</p>
                    </div>
                  </header>
                  <ol className="st-board__list">
                    {list.length === 0 ? (
                      <li className="st-board__note">Noch keiner.</li>
                    ) : (
                      list.slice(0, 10).map((e, i) => (
                        <li key={e.id}>
                          <Link className="st-board__row" href={`/spieler/${encodeURIComponent(e.id)}`}>
                            <span className="st-board__rank num">{i + 1}</span>
                            <img className="head" src={headUrl(e.uuid, 28)} alt="" width={28} height={28} loading="lazy" />
                            <span className="st-board__name">{e.name}</span>
                            <span className="st-board__val num">{boardValue(key, e.value)}</span>
                          </Link>
                        </li>
                      ))
                    )}
                  </ol>
                </section>
              );
            })}
            <section className="box st-board" data-tone="lava" aria-labelledby="b-tracked">
              <header className="st-board__head">
                <span className="st-board__icon">
                  <Icon.users aria-hidden="true" />
                </span>
                <div>
                  <h3 className="t-3" id="b-tracked">
                    Dauergäste
                  </h3>
                  <p className="st-board__sub">Online-Zeit laut Tracker, alle Spieler</p>
                </div>
              </header>
              <ol className="st-board__list">
                {trackedTime.length === 0 ? (
                  <li className="st-board__note">Noch keiner.</li>
                ) : (
                  trackedTime.map((p, i) => (
                    <li key={p.id}>
                      <Link className="st-board__row" href={`/spieler/${encodeURIComponent(p.id)}`}>
                        <span className="st-board__rank num">{i + 1}</span>
                        <img className="head" src={headUrl(p.uuid, 28)} alt="" width={28} height={28} loading="lazy" />
                        <span className="st-board__name">{p.name}</span>
                        <span className="st-board__val num">{duration(p.seconds)}</span>
                      </Link>
                    </li>
                  ))
                )}
              </ol>
            </section>
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            Die sechs oberen Listen kommen so von der API (nur Top 10). „Dauergäste“ misst der Tracker selbst seit seinem Start,
            dafür für alle Spieler.
          </p>
        </div>
      </section>
    </div>
  );
}
