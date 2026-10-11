import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { ago, headUrl, num } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { EventFeed } from "@/components/EventFeed";
import { FigValue } from "@/components/FigValue";

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export const metadata: Metadata = { title: "Live" };

export default function Page() {
  return (
      <Live />
  );
}

async function Live() {
  const { state, events } = await loadTracker();
  const players = Object.values(state.players);
  const live = players.filter((p) => p.live).sort((a, b) => (b.live!.viewers ?? 0) - (a.live!.viewers ?? 0));
  const viewersAll = live.reduce((s, p) => s + (p.live?.viewers ?? 0), 0);
  // Zählt global nur, wer dabei auch auf dem Server ist
  const viewers = live.filter((p) => p.online).reduce((s, p) => s + (p.live?.viewers ?? 0), 0);
  const hist = state.history.slice(-720); // 6 Std
  const peak = hist.reduce((m, h) => Math.max(m, h.viewers), 0);
  const twitchEvents = [...events].reverse().filter((e) => e.where === "twitch").slice(0, 40);

  return (
    <>
      <section className="block page-head" data-tone="twitch">
        <div className="wrap">
          <p className="eyebrow">Twitch</p>
          <h1 className="t-1">Live</h1>
          <p>Wer gerade streamt, wie viele zuschauen und wer wann an- und ausgemacht hat.</p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="amethyst">
              <dt>Streams</dt>
              <FigValue>{num(live.length)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="twitch">
              <dt title="Zuschauer der Streamer, die gerade auf dem Server sind">Zuschauer auf dem Server</dt>
              <FigValue>{num(viewers)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="amethyst">
              <dt title="Zuschauer aller Streams, auch ohne Server">Zuschauer gesamt</dt>
              <FigValue>{num(viewersAll)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="gold">
              <dt>Peak · 6 Std</dt>
              <FigValue>{num(peak)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="grass">
              <dt>Davon auf dem Server</dt>
              <FigValue>{num(live.filter((p) => p.online).length)}</FigValue>
            </div>
          </dl>
          <div className="box spark-card" data-tone="white" style={{ marginTop: 24 }}>
            <div className="spark-card__head">
              <span className="eyebrow">Zuschauer auf dem Server · letzte 6 Std</span>
              <span className="num spark-card__val">{num(viewers)}</span>
            </div>
            <Sparkline points={hist.map((h) => ({ at: h.at, v: h.viewers }))} width={900} height={120} label="Zuschauer" />
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <h2 className="t-2">Gerade live</h2>
            <p className="muted">Nach Zuschauern sortiert</p>
          </div>
          {live.length === 0 ? (
            <p className="st-online__empty">Gerade streamt niemand.</p>
          ) : (
            <ul className="grid" style={{ "--min": "340px", "--gap": "16px", listStyle: "none", margin: 0, padding: 0 } as React.CSSProperties}>
              {live.map((p) => (
                <li key={p.id}>
                  <a
                    className="box stream"
                    data-tone="white"
                    href={`https://www.twitch.tv/${encodeURIComponent(p.live!.login)}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <img className="head" src={headUrl(p.uuid, 56, p.id)} alt="" width={56} height={56} loading="lazy" />
                    <div style={{ minWidth: 0 }}>
                      <p className="stream__name">
                        {p.name}{" "}
                        {p.online ? (
                          <span className="tag" data-tone="grass" style={{ fontSize: ".75rem", padding: "1px 6px", verticalAlign: "middle" }}>
                            auf dem Server
                          </span>
                        ) : (
                          <span className="tag" data-tone="paper" style={{ fontSize: ".75rem", padding: "1px 6px", verticalAlign: "middle" }}>
                            nicht auf dem Server
                          </span>
                        )}
                      </p>
                      <p className="stream__title" title={p.live!.title}>
                        {p.live!.title}
                      </p>
                      <p className="muted" style={{ fontSize: ".8125rem", marginTop: 4 }}>
                        Live seit {p.liveSince ? ago(p.liveSince).replace("vor ", "") : "–"} · Peak {num(p.peakViewers)}
                      </p>
                    </div>
                    <p className="stream__viewers num">
                      <span className="dot dot--live" style={{ display: "inline-block", marginRight: 6 }} />
                      {num(p.live!.viewers)}
                      <small>Zuschauer</small>
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="block" data-tone="paper" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2 className="t-2">Stream-Chronik</h2>
            <Link className="btn btn--small" data-tone="white" href="/ereignisse?wo=twitch">
              Alle
            </Link>
          </div>
          <EventFeed events={twitchEvents} empty="Noch kein Stream an- oder ausgegangen, seit der Tracker läuft." />
        </div>
      </section>
    </>
  );
}
