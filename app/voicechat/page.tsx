import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { ShowMore } from "@/components/ShowMore";
import { HowLink } from "@/components/HowLink";
import { loadTracker } from "@/lib/data";
import { num } from "@/lib/format";
import { compareHref } from "@/lib/compareHref";
import { loadVoiceSummary } from "@/lib/voiceSummary";
import "./voicechat.css";

export const metadata: Metadata = {
  title: "Voicechat",
  description: "Wer war mit wem im Voicechat? Gruppen, Paare und Zeiten aus Simple Voice Chat, gelesen aus den Stream-Aufnahmen.",
};

const dt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "UTC" });
const h = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;

/**
 * Voicechat (Simple Voice Chat): Gruppen und Paare aus dem VOD-Scan des Videoprojekts (voice-summary.json, lib/voiceSummary.ts).
 * Konflikte und Datenqualität stehen nur auf der versteckten Seite /vorschau/<key>/voicechat.
 */
async function Voicechat() {
  const [v, { state }] = await Promise.all([loadVoiceSummary(), loadTracker()]);
  if (!v)
    return (
      <section className="block">
        <div className="wrap">
          <h1 className="t-1">Voicechat</h1>
          <p>Noch keine Auswertung vorhanden.</p>
        </div>
      </section>
    );
  const name = (id: string) => state.players[id]?.name ?? id;
  const head = (id: string, size = 24) => <Head id={id} uuid={state.players[id]?.uuid ?? null} name={name(id)} size={size} />;
  const who = (id: string) => (
    <Link className="vc-who" href={`/spieler/${encodeURIComponent(id)}`}>
      {head(id)} <span>{name(id)}</span>
    </Link>
  );
  const pairs = v.pairs.filter(([a, b]) => state.players[a] && state.players[b]);
  const maxPair = pairs[0]?.[2] ?? 1;
  const maxDay = Math.max(1, ...v.days.map((d) => d.groupHours));
  const maxHour = Math.max(1, ...v.hours);
  const players = v.players.filter((p) => p.hours > 0 && state.players[p.id]);
  const first = v.days[0]?.day, last = v.days.at(-1)?.day;
  const top = players[0];

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Community</p>
          <h1 className="t-1">Voicechat</h1>
          <p className="lead">
            Wer war mit wem in einer Gruppe von Simple Voice Chat? Gelesen aus der Gruppenliste am Bildschirmrand in den Stream-Aufnahmen
            {first && last ? ` (${shortDay.format(new Date(`${first}T12:00:00Z`))} bis ${shortDay.format(new Date(`${last}T12:00:00Z`))})` : ""}. Zu sehen ist nur, was ein
            Streamer im Bild hatte, während er auf dem Server war – die echten Zeiten sind eher länger.
          </p>
          <p className="muted">
            Stand {dt.format(new Date(v.made))} Uhr ·{" "}
            <Link href="/ereignisse?g=voice">Alle Voicechat-Sitzungen</Link>
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt title="Summe der Zeit aller Gruppen mit mindestens 2 erkannten Spielern; jede Gruppe zählt einmal, auch wenn sie mehrere Streamer zeigen">Gruppenzeit</dt>
              <FigValue>{h(v.totals.groupHours)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt>Spieler in Gruppen</dt>
              <FigValue>{num(players.length)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={v.largest ? `${dt.format(new Date(v.largest.at))} Uhr: ${v.largest.ids.map(name).join(", ")}` : undefined}>Größte Gruppe</dt>
              <FigValue unit="Spieler">{num(v.largest?.ids.length ?? 0)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={top ? `${name(top.id)}: ${h(top.hours)}` : undefined}>Am meisten im Voicechat</dt>
              <FigValue unit={top ? h(top.hours) : undefined}>{top ? name(top.id) : "–"}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap vc-cols">
          <div className="box" data-tone="white">
            <h2 className="t-3">Am längsten zusammen</h2>
            <p className="vc-note">Zeit in derselben Gruppe · ⇄ vergleicht beide</p>
            <ShowMore height={720} label="Paare">
              <ol className="vc-bars">
                {pairs.slice(0, 60).map(([a, b, hours]) => (
                  <li key={`${a}|${b}`}>
                    <span className="vc-pair">
                      {who(a)}
                      <span aria-hidden="true">+</span>
                      {who(b)}
                      <Link className="vc-cmp" href={compareHref(a, b)} title={`${name(a)} und ${name(b)} vergleichen`} aria-label={`${name(a)} und ${name(b)} vergleichen`}>
                        ⇄
                      </Link>
                    </span>
                    <span className="vc-bar" style={{ "--w": `${(hours / maxPair) * 100}%` } as React.CSSProperties} />
                    <span className="vc-num">{h(hours)}</span>
                  </li>
                ))}
              </ol>
            </ShowMore>
          </div>
          <div className="box" data-tone="white">
            <h2 className="t-3">Häufigste Gruppen</h2>
            <p className="vc-note">Genau diese Spieler zusammen in einer Gruppe.</p>
            <ShowMore height={720} label="Gruppen">
              <ol className="vc-groups">
                {v.groups
                  .filter((g) => g.ids.every((id) => state.players[id]))
                  .slice(0, 30)
                  .map((g) => (
                    <li key={g.ids.join(",")}>
                      <span className="vc-heads" title={g.ids.map(name).join(", ")}>
                        {g.ids.map((id) => (
                          <Link key={id} href={`/spieler/${encodeURIComponent(id)}`}>
                            {head(id, 28)}
                          </Link>
                        ))}
                      </span>
                      <span className="vc-num">{h(g.hours)}</span>
                      <span className="vc-when">
                        {g.ids.map(name).join(", ")} · zwischen {dt.format(new Date(g.first))} und {dt.format(new Date(g.last))}
                      </span>
                    </li>
                  ))}
              </ol>
            </ShowMore>
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
            Zeit in einer Gruppe mit mindestens einem weiteren erkannten Spieler. „Spricht“ = Anteil der Zeit mit weißem Rahmen um den Kopf (Mikro aktiv), „hört
            nicht zu“ = durchgestrichener Lautsprecher am Kopf.
          </p>
          <ShowMore height={900} label="Spieler">
            <div className="vc-scroll">
              <table className="vc-table">
                <thead>
                  <tr>
                    <th scope="col">Spieler</th>
                    <th scope="col" className="vc-num">
                      Zeit
                    </th>
                    <th scope="col" className="vc-num">
                      Spricht
                    </th>
                    <th scope="col" className="vc-num">
                      Hört nicht zu
                    </th>
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
                      <td>
                        <span className="vc-heads">
                          {p.partners
                            .filter(([q]) => state.players[q])
                            .map(([q, hrs]) => (
                              <Link key={q} href={compareHref(p.id, q)} title={`${name(p.id)} und ${name(q)}: ${h(hrs)} – vergleichen`}>
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
          </ShowMore>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap vc-cols">
          <div className="box" data-tone="white">
            <h2 className="t-3">Je Tag</h2>
            <ShowMore height={560} label="Tage">
              <ol className="vc-bars">
                {v.days.map((d) => (
                  <li key={d.day}>
                    <span>{dayFmt.format(new Date(`${d.day}T12:00:00Z`))}</span>
                    <span className="vc-bar" style={{ "--w": `${(d.groupHours / maxDay) * 100}%` } as React.CSSProperties} />
                    <span className="vc-num" title={`Ø ${d.avgSize.toLocaleString("de-DE")} Spieler je Gruppe, ${d.players} Spieler`}>
                      {h(d.groupHours)}
                    </span>
                  </li>
                ))}
              </ol>
            </ShowMore>
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
        <div className="wrap">
          <HowLink section="voicechat" />
        </div>
      </section>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Community" title="Voicechat" />}>
      <Voicechat />
    </Suspense>
  );
}
