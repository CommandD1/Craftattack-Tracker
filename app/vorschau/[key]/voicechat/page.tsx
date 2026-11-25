import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { loadTracker } from "@/lib/data";
import { num } from "@/lib/format";
import { previewGate } from "@/lib/preview";
import { loadOverlays, loadVoiceSummary } from "@/lib/voiceSummary";
import "./voicechat.css";

export const metadata: Metadata = { title: "Voicechat" };

const dt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const h = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "–");

async function Inner(props: PageProps<"/vorschau/[key]/voicechat">) {
  const root = await previewGate(props.params);
  const [v, { state }, ov] = await Promise.all([loadVoiceSummary(), loadTracker(), loadOverlays()]);
  if (!v) return <p className="wrap">Noch keine Auswertung vom Scan.</p>;
  const name = (id: string) => state.players[id]?.name ?? id;
  const uuid = (id: string) => state.players[id]?.uuid ?? null;
  const head = (id: string, size = 24) => <Head id={id} uuid={uuid(id)} name={name(id)} size={size} />;
  const who = (id: string) => (
    <Link className="vc-who" href={`/spieler/${encodeURIComponent(id)}`}>
      {head(id)} <span>{name(id)}</span>
    </Link>
  );
  const maxPair = v.pairs[0]?.[2] ?? 1;
  const maxDay = Math.max(1, ...v.days.map((d) => d.groupHours));
  const maxHour = Math.max(1, ...v.hours);
  const players = v.players.filter((p) => p.hours > 0);
  const t = v.totals;

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">
            Vorschau · Rückblick-Video · <Link href={`${root}/gesichter`}>Gesichter zuordnen</Link> · <Link href={`${root}/voicechat/zeitstrahl`}>Zeitstrahl je Tag</Link>
          </p>
          <h1 className="t-1">Voicechat</h1>
          <p>
            Wer war mit wem in einer Voicechat-Gruppe? Gelesen aus den Kopf-Listen von Simple Voice Chat in den VODs, ein Bild alle 10 Sekunden, nur solange der
            Streamer auf dem Server war und nicht AFK. Eine Gruppe, die mehrere Streamer gleichzeitig zeigen, zählt nur einmal. Köpfe ohne passenden Skin sind über
            die Reihenfolge der Liste bei anderen Streamern und davor/danach gefolgert.
          </p>
          <p className="vc-status">
            Vorläufig: Scan bei {pct(v.scan.done, v.scan.total)} ({num(v.scan.done)} von {num(v.scan.total)} Bildern)
            {v.scan.reached && <> · VODs gelesen bis {dt.format(new Date(v.scan.reached))} Uhr, dazu 13.–14.11.</>} · Stand {dt.format(new Date(v.made))} Uhr
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt title="Summe der Zeit aller Gruppen mit mindestens 2 bekannten Spielern">Gruppenzeit</dt>
              <FigValue>{h(t.groupHours)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Verschiedene Zusammensetzungen">Gruppen</dt>
              <FigValue>{num(t.groups)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`${num(t.known)} erkannt, ${num(t.inferred)} gefolgert, ${num(t.open)} offen`}>Köpfe bestimmt</dt>
              <FigValue unit={`${pct(t.inferred, t.heads)} gefolgert`}>{pct(t.known + t.inferred, t.heads)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={v.largest ? `${dt.format(new Date(v.largest.at))} Uhr` : undefined}>Größte Gruppe</dt>
              <FigValue unit="Spieler">{num(v.largest?.ids.length ?? 0)}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap vc-cols">
          <div className="box" data-tone="white">
            <h2 className="t-3">Am längsten zusammen</h2>
            <ol className="vc-bars">
              {v.pairs.slice(0, 25).map(([a, b, hours]) => (
                <li key={`${a}|${b}`}>
                  <span className="vc-pair">
                    {who(a)}
                    <span aria-hidden="true">+</span>
                    {who(b)}
                  </span>
                  <span className="vc-bar" style={{ "--w": `${(hours / maxPair) * 100}%` } as React.CSSProperties} />
                  <span className="vc-num">{h(hours)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="box" data-tone="white">
            <h2 className="t-3">Häufigste Gruppen</h2>
            <p className="vc-note">Gleiche bekannte Spieler zusammen; „+3?“ = so viele Köpfe dieser Liste sind noch unbekannt.</p>
            <ol className="vc-groups">
              {v.groups.slice(0, 20).map((g) => (
                <li key={g.ids.join(",")}>
                  <span className="vc-heads" title={g.ids.map(name).join(", ")}>
                    {g.ids.map((id) => (
                      <Link key={id} href={`/spieler/${encodeURIComponent(id)}`}>
                        {head(id, 28)}
                      </Link>
                    ))}
                    {g.open > 0 && <span className="vc-open" title="Unbekannte Köpfe in der Liste">+{g.open}?</span>}
                  </span>
                  <span className="vc-num">{h(g.hours)}</span>
                  <span className="vc-when">
                    gesehen {dt.format(new Date(g.first))} bis {dt.format(new Date(g.last))}
                  </span>
                </li>
              ))}
            </ol>
            {v.largest && (
              <p className="vc-note">
                Größte Gruppe ({dt.format(new Date(v.largest.at))} Uhr): {v.largest.ids.map(name).join(", ")}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="block" data-tone="white">
        <div className="wrap stack">
          <h2 className="t-2">Spieler</h2>
          <p className="vc-note">
            Zeit in einer Gruppe mit mindestens einem weiteren bekannten Spieler. „Spricht“ = Anteil der Bilder mit weißem Rahmen um den Kopf, „hört nicht zu“ =
            durchgestrichener Lautsprecher am Kopf. „Stumm“ und „In Gruppe“ nur aus dem eigenen Stream.
          </p>
          <div className="vc-scroll">
            <table className="vc-table">
              <thead>
                <tr>
                  <th scope="col">Spieler</th>
                  <th scope="col" className="vc-num">Zeit</th>
                  <th scope="col" className="vc-num">Spricht</th>
                  <th scope="col" className="vc-num">Hört nicht zu</th>
                  <th scope="col" className="vc-num" title="Eigenes Mikro stumm (Symbol unten links im eigenen Stream)">Stumm</th>
                  <th scope="col" className="vc-num" title="Anteil der eigenen Stream-Bilder mit Gruppenliste">In Gruppe</th>
                  <th scope="col">Meist mit</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{who(p.id)}</th>
                    <td className="vc-num">{h(p.hours)}</td>
                    <td className="vc-num">{p.talk == null ? "–" : `${p.talk} %`}</td>
                    <td className="vc-num">{p.deaf == null ? "–" : `${p.deaf} %`}</td>
                    <td className="vc-num">{p.muted == null ? "–" : `${p.muted} %`}</td>
                    <td className="vc-num">{p.groupShare == null ? "–" : `${p.groupShare} %`}</td>
                    <td>
                      <span className="vc-heads">
                        {p.partners.map(([q, hrs]) => (
                          <Link key={q} href={`/spieler/${encodeURIComponent(q)}`} title={`${name(q)}: ${h(hrs)}`}>
                            {head(q)}
                          </Link>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap vc-cols">
          <div className="box" data-tone="white">
            <h2 className="t-3">Je Tag</h2>
            <ol className="vc-bars">
              {v.days.map((d) => (
                <li key={d.day}>
                  <span>{dayFmt.format(new Date(`${d.day}T12:00:00Z`))}</span>
                  <span className="vc-bar" style={{ "--w": `${(d.groupHours / maxDay) * 100}%` } as React.CSSProperties} />
                  <span className="vc-num" title={`Ø ${d.avgSize} Spieler je Gruppe, ${d.players} Spieler`}>
                    {h(d.groupHours)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="box" data-tone="white">
            <h2 className="t-3">Je Uhrzeit</h2>
            <div className="vc-hours" role="img" aria-label="Gruppenzeit je Stunde des Tages">
              {v.hours.map((x, i) => (
                <span key={i} title={`${i}–${i + 1} Uhr: ${h(x)}`} style={{ "--h": `${(x / maxHour) * 100}%` } as React.CSSProperties} />
              ))}
            </div>
            <div className="vc-hours-axis" aria-hidden="true">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>24 Uhr</span>
            </div>
          </div>
        </div>
      </section>

      <section className="block" data-tone="white">
        <div className="wrap stack">
          <h2 className="t-2">Datenqualität je Streamer</h2>
          <p className="vc-note">Köpfe in den Listen aus dem jeweiligen Stream: erkannt (Skin), gefolgert (Reihenfolge), offen.</p>
          <ol className="vc-quality">
            {v.quality.map((q) => (
              <li key={q.id}>
                {who(q.id)}
                <span className="vc-stack" title={`${num(q.known)} erkannt, ${num(q.inferred)} gefolgert, ${num(q.open)} offen · ${num(q.withGroup)} von ${num(q.frames)} Bildern mit Gruppe`}>
                  <i data-k="known" style={{ flexGrow: q.known }} />
                  <i data-k="inferred" style={{ flexGrow: q.inferred }} />
                  <i data-k="open" style={{ flexGrow: q.open }} />
                </span>
                <span className="vc-num">{pct(q.known + q.inferred, q.heads)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      {ov && (
        <section className="block" data-tone="paper">
          <div className="wrap stack">
            <h2 className="t-2">Einblendungen über dem HUD</h2>
            <p className="vc-note">
              Je Streamer das Mittel aus ~24 Bildern über alle VODs (links) und rechts magenta die Bereiche, die sich kaum ändern: Banner, Logos, Rahmen,
              Chat-Kästen, aber auch das Minecraft-HUD und oft gehaltene Gegenstände. Umrandet die Stellen, die der Scan liest: grün Kopfliste, türkis
              Stumm-Symbol, gelb Chat, weiß Hotbar. Liegt eine feste Fläche auf einer dieser Stellen, ist dort vermutlich etwas eingeblendet. Verdeckte Plätze
              der Kopfliste bleiben „unbekannt“ und werden über die Reihenfolge bei den anderen Streamern gefolgert.
            </p>
            <ol className="vc-ov">
              {Object.entries(ov)
                .sort((a, b) => (b[1].overlays.filter((o) => o.covers.length).length - a[1].overlays.filter((o) => o.covers.length).length) || a[0].localeCompare(b[0]))
                .map(([id, o]) => {
                  const covered = [...new Set(o.overlays.flatMap((x) => x.covers))];
                  return (
                    <li key={id} className="box" data-tone="white">
                      <div className="vc-ov-head">
                        {who(id)}
                        <span className="vc-note">
                          {covered.length ? `Mögliche Einblendung über: ${covered.map((c) => PART[c] ?? c).join(", ")}` : "Nichts über den gelesenen Stellen"}
                          {!o.layout && " · keine Kopfliste gefunden"}
                        </span>
                      </div>
                      <img src={`${root}/voicechat/bild/${id}.png`} alt={`Overlay-Karte ${name(id)}`} loading="lazy" className="vc-ov-img" />
                      <p className="vc-note">
                        Fest in der Kopfliste {o.shares.liste ?? "–"} % · am Stumm-Symbol {o.shares.symbol ?? "–"} % · im Chat {o.shares.chat ?? "–"} %
                      </p>
                    </li>
                  );
                })}
            </ol>
          </div>
        </section>
      )}
    </>
  );
}

const PART: Record<string, string> = { liste: "Kopfliste", symbol: "Stumm-Symbol", chat: "Chat" };

export default function Page(props: PageProps<"/vorschau/[key]/voicechat">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Voicechat" />}>
      <Inner {...props} />
    </Suspense>
  );
}
