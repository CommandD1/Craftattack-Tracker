import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { dayKey, getDayTimeline } from "@/lib/analytics";
import { duration, headUrl, num, time } from "@/lib/format";
import { DateNav } from "@/components/DateNav";

export const instant = false;
export const metadata: Metadata = { title: "Zeitstrahl" };

const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

export default async function Page(props: PageProps<"/zeitstrahl">) {
  const sp = await props.searchParams;
  await loadTracker();
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const { nav, rows, now } = await getDayTimeline(tag);
  const span = nav.to - nav.from;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - nav.from) / span) * 100));
  const nowPct = now < nav.to && now > nav.from ? pct(now) : null;
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const liveCount = rows.filter((r) => r.live.length).length;

  return (
    <>
      <section className="block page-head" data-tone="sky">
        <div className="wrap">
          <p className="eyebrow">Wer war wann da</p>
          <h1 className="t-1">Zeitstrahl</h1>
          <p>
            Jede Zeile ein Spieler, jeder Balken eine Session auf dem Server. Lila darunter: live auf Twitch.
            {nav.dataFrom && <> Daten an diesem Tag ab {time(new Date(nav.dataFrom).toISOString())} Uhr.</>}
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2 className="t-2">{dayLong.format(nav.from + 12 * 3600_000)}</h2>
              <p className="muted num" style={{ marginTop: 8 }}>
                {num(rows.length)} Spieler · {duration(total)} Spielzeit zusammen · {num(liveCount)} mit Stream
              </p>
            </div>
            <DateNav base="/zeitstrahl" day={nav.day} prev={nav.prev} next={nav.next} max={dayKey(now)} />
          </div>

          <div className="box" data-tone="white">
            <ul className="legend" style={{ marginBottom: 12 }}>
              <li>
                <i style={{ background: "var(--grass)" }} /> auf dem Server
              </li>
              <li>
                <i style={{ background: "var(--twitch)" }} /> live auf Twitch
              </li>
              {nowPct !== null && (
                <li>
                  <i style={{ background: "var(--redstone)" }} /> jetzt
                </li>
              )}
            </ul>
            {rows.length === 0 ? (
              <p className="st-online__empty">An diesem Tag war niemand online{nav.dataFrom ? " – zumindest seit der Tracker läuft" : ""}.</p>
            ) : (
              <div className="gantt" role="table" aria-label="Online-Zeiten pro Spieler">
                <div className="gantt__row gantt__head" role="row">
                  <span />
                  <div className="gantt__axis num" aria-hidden="true">
                    {HOURS.map((h) => (
                      <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                        {String(h).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                  <span className="gantt__sum muted">Summe</span>
                </div>
                {rows.map((r) => (
                  <div className="gantt__row" role="row" key={r.id}>
                    <Link className="gantt__name" href={`/spieler/${encodeURIComponent(r.id)}`} role="rowheader">
                      <img className="head" src={headUrl(r.uuid, 24, r.id)} alt="" width={24} height={24} loading="lazy" />
                      <span>{r.name}</span>
                    </Link>
                    <div className="gantt__track" role="cell" title={`${r.name}: ${duration(r.seconds)}`}>
                      {r.online.map(([a, b], k) => (
                        <span key={`o${k}`} className="gantt__on" style={{ left: `${pct(a)}%`, width: `${Math.max(0.3, pct(b) - pct(a))}%` }} title={`${time(new Date(a).toISOString())}–${b >= now - 60_000 && !nav.next ? "jetzt" : time(new Date(b).toISOString())}`} />
                      ))}
                      {r.live.map(([a, b], k) => (
                        <span key={`l${k}`} className="gantt__live" style={{ left: `${pct(a)}%`, width: `${Math.max(0.3, pct(b) - pct(a))}%` }} />
                      ))}
                      {nowPct !== null && <span className="gantt__now" style={{ left: `${nowPct}%` }} />}
                    </div>
                    <span className="gantt__sum num" role="cell">
                      {duration(r.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            Sessions entstehen aus den Join- und Leave-Ereignissen des Trackers, Streams aus den Stream-an/aus-Ereignissen. Genauigkeit: etwa 30
            Sekunden. Der <Link href={`/zeitraffer?tag=${nav.day}`}>Zeitraffer</Link> zeigt denselben Tag als Film.
          </p>
        </div>
      </section>
    </>
  );
}
