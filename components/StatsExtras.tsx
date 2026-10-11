import Link from "next/link";
import type { StatsExtras as Data } from "@/lib/analytics";
import { dateTime, duration, headUrl, num, time } from "@/lib/format";
import { Sparkline } from "./Sparkline";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const dayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
const dayLabel = (day: string) => dayShort.format(new Date(`${day}T12:00:00Z`));

function Card({ title, sub, children, wide = false, tone = "white" }: { title: string; sub?: string; children: React.ReactNode; wide?: boolean; tone?: string }) {
  return (
    <section className="box stat-card" data-tone={tone} style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <header className="stat-card__head">
        <h3 className="t-3">{title}</h3>
        {sub && <p className="muted">{sub}</p>}
      </header>
      {children}
    </section>
  );
}

function Person({ id, name, uuid, right }: { id: string; name: string; uuid: string; right: React.ReactNode }) {
  return (
    <li className="plist__row">
      <Link className="plist__who" href={`/spieler/${encodeURIComponent(id)}`}>
        <img className="head" src={headUrl(uuid, 24, id)} alt="" width={24} height={24} loading="lazy" />
        <span>{name}</span>
      </Link>
      <span className="plist__val num">{right}</span>
    </li>
  );
}

/** Heatmap Wochentag × Stunde */
function Heatmap({ values }: { values: (number | null)[][] }) {
  const flat = values.flat().filter((v): v is number => v !== null);
  if (!flat.length) return <p className="muted">Noch keine Daten.</p>;
  const max = Math.max(1, ...flat);
  return (
    <div className="hm" role="img" aria-label="Durchschnittlich online nach Wochentag und Uhrzeit">
      <div className="hm__row hm__head num" aria-hidden="true">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h : ""}</span>)}
      </div>
      {values.map((row, d) => (
        <div className="hm__row" key={d}>
          <span className="hm__day">{DAYS[d]}</span>
          {row.map((v, h) => (
            <span
              key={h}
              className="hm__cell"
              style={{ "--a": v === null ? 0 : Math.max(0.08, v / max) } as React.CSSProperties}
              title={`${DAYS[d]} ${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} Uhr: ${v === null ? "keine Daten" : `Ø ${num(v)} online`}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function HourBars({ values, unit }: { values: { hour: number; rate: number | null; deaths: number; playerHours: number }[]; unit: string }) {
  const max = Math.max(1, ...values.map((v) => v.rate ?? 0));
  return (
    <div className="hbars" role="img" aria-label={unit}>
      {values.map((v) => (
        <span key={v.hour} title={`${String(v.hour).padStart(2, "0")} Uhr: ${v.rate === null ? "zu wenig Daten" : `${num(v.rate)} ${unit} (${num(v.deaths)} Tode in ${num(v.playerHours)} Spielerstunden)`}`}>
          <i style={{ height: `${v.rate === null ? 0 : Math.max(2, (v.rate / max) * 100)}%` }} />
          <b className="num">{v.hour % 3 === 0 ? v.hour : ""}</b>
        </span>
      ))}
    </div>
  );
}

export function StatsExtras({ d, tag }: { d: Data; tag: (day: string) => number }) {
  const lastDay = d.days[d.days.length - 1];
  return (
    <>
      <dl className="grid st-figs st-figs--6" style={{ marginBottom: 32 }}>
        <div className="box st-fig" data-tone="grass">
          <dt>Server erreichbar</dt>
          <dd className="num">{d.availability.ratio === null ? "–" : `${(Math.round(d.availability.ratio * 1000) / 10).toLocaleString("de-DE")} %`}</dd>
        </div>
        <div className="box st-fig" data-tone="sky">
          <dt>Spielerstunden</dt>
          <dd className="num">{num(d.totals.playerHours)}</dd>
        </div>
        <div className="box st-fig" data-tone="white">
          <dt>Spieler bisher</dt>
          <dd className="num">{num(d.totals.players)}</dd>
        </div>
        <div className="box st-fig" data-tone="grass">
          <dt>Aktiv in 24 h</dt>
          <dd className="num">{num(d.loyalty.groups.h24)}</dd>
        </div>
        <div className="box st-fig" data-tone="gold">
          <dt>Länger als 1 Tag weg</dt>
          <dd className="num">{num(d.loyalty.groups.d3 + d.loyalty.groups.d7 + d.loyalty.groups.gone)}</dd>
        </div>
        <div className="box st-fig" data-tone="redstone">
          <dt>Tode heute</dt>
          <dd className="num">{lastDay ? num(lastDay.deaths) : "–"}</dd>
        </div>
      </dl>

      <div className="grid stat-grid" style={{ "--min": "340px" } as React.CSSProperties}>
        <Card title="Tag für Tag" sub="Jeder Tag der Staffel, soweit der Tracker ihn gesehen hat" wide>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th className="num">Spieler</th>
                  <th className="num">Max. online</th>
                  <th className="num">Spielerstunden</th>
                  <th className="num">Tode</th>
                  <th className="num">Zuschauer-Spitze</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...d.days].reverse().map((r) => (
                  <tr key={r.day}>
                    <td>
                      Tag {tag(r.day)} <span className="muted">{dayLabel(r.day)}</span>
                    </td>
                    <td className="num">{num(r.players)}</td>
                    <td className="num">{num(r.maxOnline)}</td>
                    <td className="num">{num(r.playerHours)}</td>
                    <td className="num">{num(r.deaths)}</td>
                    <td className="num">{num(r.maxViewers)}</td>
                    <td>
                      <Link href={`/zeitstrahl?tag=${r.day}`}>Zeitstrahl</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Wann ist der Server voll?" sub="Ø Spieler online je Wochentag und Stunde (Berliner Zeit)">
          <Heatmap values={d.heatmap} />
        </Card>

        <Card title="Vollste Momente" sub="Mindestens zwei Stunden auseinander">
          <ol className="plist">
            {d.fullest.map((r, i) => (
              <li className="plist__row" key={r.at}>
                <span>
                  <b className="num">{i + 1}.</b> {num(r.value)} Spieler gleichzeitig
                </span>
                <span className="plist__val muted">{dateTime(r.at)}</span>
              </li>
            ))}
            {d.fullest.length === 0 && <li className="muted">Noch nichts.</li>}
          </ol>
          <h4 className="eyebrow" style={{ margin: "16px 0 8px" }}>
            Meiste Zuschauer gleichzeitig
          </h4>
          <ol className="plist">
            {d.mostViewers.slice(0, 5).map((r) => (
              <li className="plist__row" key={r.at}>
                <span className="num">{num(r.value)} Zuschauer</span>
                <span className="plist__val muted">{dateTime(r.at)}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Gefährlichste Tageszeit" sub="Tode je 100 Spielerstunden nach Uhrzeit" tone="white">
          <HourBars values={d.deathsByHour} unit="Tode je 100 Spielerstunden" />
        </Card>

        <Card title="Tod-Serien" sub="Mindestens drei Tode eines Spielers innerhalb einer Stunde">
          <ol className="plist">
            {d.deathStreaks.map((s) => (
              <Person key={`${s.id}${s.from}`} id={s.id} name={s.name} uuid={s.uuid} right={`${num(s.count)} Tode · ${dateTime(s.from)}–${time(s.to)}`} />
            ))}
            {d.deathStreaks.length === 0 && <li className="muted">Noch keine. Beeindruckend.</li>}
          </ol>
        </Card>

        <Card title="Todesrate" sub="Tode pro Online-Stunde laut Tracker, ab zwei Toden und einer Stunde">
          <ol className="plist">
            {d.deathRate.map((r) => (
              <Person key={r.id} id={r.id} name={r.name} uuid={r.uuid} right={`${r.perHour.toLocaleString("de-DE")} / h · ${num(r.deaths)} in ${r.hours.toLocaleString("de-DE")} h`} />
            ))}
            {d.deathRate.length === 0 && <li className="muted">Noch zu wenige Daten.</li>}
          </ol>
        </Card>

        <Card title="Treue" sub="Wie viele Spieler pro Tag da waren und wer länger fehlt">
          {d.loyalty.perDay.length > 1 && <Sparkline points={d.loyalty.perDay.map((p) => ({ at: `${p.day}T12:00:00Z`, v: p.players }))} width={320} height={80} step label="Spieler pro Tag" />}
          <ul className="filters" style={{ margin: "12px 0" }}>
            <li>
              <span className="tag" data-tone="grass">
                ≤ 24 h: {num(d.loyalty.groups.h24)}
              </span>
            </li>
            <li>
              <span className="tag">1–3 Tage: {num(d.loyalty.groups.d3)}</span>
            </li>
            <li>
              <span className="tag">3–7 Tage: {num(d.loyalty.groups.d7)}</span>
            </li>
            <li>
              <span className="tag" data-tone="redstone">
                &gt; 7 Tage: {num(d.loyalty.groups.gone)}
              </span>
            </li>
          </ul>
          <h4 className="eyebrow" style={{ margin: "8px 0" }}>
            Seit über drei Tagen nicht gesehen
          </h4>
          <ol className="plist">
            {d.loyalty.gone.slice(0, 10).map((p) => (
              <Person key={p.id} id={p.id} name={p.name} uuid={p.uuid} right={`seit ${num(p.days)} Tagen · zuletzt ${dayLabel(p.lastSeen.slice(0, 10))}`} />
            ))}
            {d.loyalty.gone.length === 0 && <li className="muted">Alle sind noch dabei.</li>}
          </ol>
        </Card>

        <Card title="Server-Verfügbarkeit" sub="Ausfälle laut Stats-API und Lücken in der Aufzeichnung">
          <ol className="plist">
            {d.availability.outages.map((o) => (
              <li className="plist__row" key={o.from}>
                <span>
                  <span className="dot dot--off" aria-hidden="true" /> Ausfall {dateTime(o.from)}
                </span>
                <span className="plist__val num">{o.minutes === null ? "läuft noch" : `${num(o.minutes)} Min`}</span>
              </li>
            ))}
            {d.availability.outages.length === 0 && (
              <li className="plist__row">
                <span>
                  <span className="dot" aria-hidden="true" /> Bisher kein Ausfall beobachtet.
                </span>
              </li>
            )}
          </ol>
          {d.availability.gaps.length > 0 && (
            <>
              <h4 className="eyebrow" style={{ margin: "16px 0 8px" }}>
                Datenlücken (Tracker oder Quelle nicht erreichbar)
              </h4>
              <ol className="plist">
                {d.availability.gaps.slice(0, 8).map((g) => (
                  <li className="plist__row" key={g.from}>
                    <span>{dateTime(g.from)}</span>
                    <span className="plist__val num">{g.minutes >= 60 ? duration(g.minutes * 60) : `${num(g.minutes)} Min`}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
