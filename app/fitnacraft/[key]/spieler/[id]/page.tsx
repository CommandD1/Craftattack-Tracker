import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { Sparkline } from "@/components/Sparkline";
import { ClipGrid } from "@/components/ClipGrid";
import type { Clip } from "@/lib/clips";
import { fcData, fcGate, who } from "@/lib/fitnacraft";
import { dateTime, duration, num, time } from "@/lib/format";
import { FcHead, change, fcPlayerHref, hours } from "../../../_components/FcNav";
import { FcBars } from "../../../_components/FcBars";

export async function generateMetadata({ params }: PageProps<"/fitnacraft/[key]/spieler/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

const dayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });

async function Profile(props: PageProps<"/fitnacraft/[key]/spieler/[id]">) {
  const key = await fcGate(props.params);
  const { id: raw } = await props.params;
  const id = decodeURIComponent(raw);
  const d = await fcData();
  const p = d.players.find((x) => x.id === id);
  if (!p) notFound();
  const rank = d.players.indexOf(p) + 1;
  const sessions = d.sessions.filter((s) => s.p === id);
  const points = sessions.flatMap((s) => s.v.map((v, k) => ({ at: new Date(s.a + k * 300_000).toISOString(), v })));
  const days = Object.keys(p.daily).sort();
  const links = d.links
    .filter((l) => l.a === id || l.b === id)
    .map((l) => {
      const other = l.a === id ? l.b : l.a;
      const out = l.a === id;
      return {
        other,
        together: l.together,
        raidsOut: out ? l.raidsAB : l.raidsBA,
        raidsIn: out ? l.raidsBA : l.raidsAB,
        msgsOut: out ? l.msgsAB : l.msgsBA,
        msgsIn: out ? l.msgsBA : l.msgsAB,
        chatSeconds: l.chatSeconds,
        title: out ? l.titleAB : l.titleBA,
      };
    })
    .sort((a, b) => b.together - a.together || b.raidsOut + b.raidsIn - (a.raidsOut + a.raidsIn));
  const raids = d.raids.filter((r) => r.from === id || r.to === id);
  const clips: Clip[] = d.clips
    .filter((c) => c.player === id)
    .slice(0, 12)
    .map((c) => ({ ...c, name: p.name, uuid: p.uuid, at: new Date(c.at).toISOString() }));
  const chats = d.chats.filter((c) => c.from === id || c.to === id).slice(0, 40);
  const name = (x: string | null) => who(d, x)?.name ?? x ?? "?";

  return (
    <>
      <FcHead k={key} d={d} tab="/spieler" eyebrow={`FitnaCraft-Rückblick · Platz ${rank} von ${d.players.length} nach Stream-Zeit`} title={p.name}>
        <p className="fc-who" style={{ gap: 14 }}>
          <Head id={p.id} uuid={p.uuid} name={p.name} size={56} src={64} decorative />
          <span>
            {sessions.length} Sessions an {p.days} Tagen, vom {dateTime(new Date(p.first).toISOString())} bis {dateTime(new Date(p.last).toISOString())} ·{" "}
            <a href={`https://www.twitch.tv/${encodeURIComponent(p.login)}`} target="_blank" rel="noopener noreferrer">
              twitch.tv/{p.login}
            </a>{" "}
            · <Link href={`/spieler/${encodeURIComponent(p.id)}`}>Profil auf CraftAttack</Link>
          </span>
        </p>
      </FcHead>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt title={`Längste Session: ${duration(p.longest)}`}>Stream-Zeit</dt>
              <FigValue>{hours(p.seconds)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={p.caAvgViewers ? `CraftAttack ⌀ ${num(p.caAvgViewers)} (${change(p.avgViewers, p.caAvgViewers)})` : undefined}>⌀ Zuschauer</dt>
              <FigValue>{num(p.avgViewers)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={dateTime(new Date(p.peakAt).toISOString())}>Spitze</dt>
              <FigValue>{num(p.peakViewers)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Zuschauer × Stunden">Zuschauer-Std</dt>
              <FigValue>{num(p.viewerHours)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={p.followersStart !== null && p.followersEnd !== null ? `${num(p.followersStart)} → ${num(p.followersEnd)} Follower (gesamt, auch außerhalb von FitnaCraft)` : undefined}>Neue Follower</dt>
              <FigValue>{`+${num(p.followerGain)}`}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`${num(p.paidSubs)} neu/verlängert · ${num(p.giftSubs)} verschenkt`}>Abos</dt>
              <FigValue>{num(p.paidSubs + p.giftSubs)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt>Bits</dt>
              <FigValue>{num(p.bits)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`${p.raidsOut} Raids raus, ${p.raidsIn} rein`}>Clips</dt>
              <FigValue>{num(p.clips)}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <div className="fc-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">FitnaCraft oder CraftAttack?</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Stream-Zeit und Zuschauer der ganzen Staffel nach Ort.
              </p>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ort</th>
                      <th className="num">Stream-Zeit</th>
                      <th className="num">⌀ Zuschauer</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>FitnaCraft</td>
                      <td className="num">{hours(p.seconds)}</td>
                      <td className="num">{num(p.avgViewers)}</td>
                    </tr>
                    <tr>
                      <td>CraftAttack</td>
                      <td className="num">{p.caSeconds ? hours(p.caSeconds) : "–"}</td>
                      <td className="num">{p.caAvgViewers !== null ? num(p.caAvgViewers) : "–"}</td>
                    </tr>
                    <tr>
                      <td>Andere Inhalte</td>
                      <td className="num">{p.otherSeconds ? hours(p.otherSeconds) : "–"}</td>
                      <td className="num">{p.otherAvgViewers !== null ? num(p.otherAvgViewers) : "–"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">Zuschauer auf FitnaCraft</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Alle Sessions hintereinander, höchster Wert je 5 Minuten.
              </p>
              <Sparkline points={points} width={600} height={120} label="Zuschauer" />
            </div>
          </div>
          <div className="fc-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">Tag für Tag</h3>
              <FcBars
                values={days.map((x) => p.daily[x])}
                labels={days.map((x) => x.slice(8, 10))}
                tips={days.map((x) => `${dayShort.format(Date.parse(`${x}T12:00:00Z`))} · ${duration(p.daily[x])}`)}
                label="Stream-Zeit auf FitnaCraft je Tag"
              />
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">Uhrzeit</h3>
              <FcBars
                values={p.hours}
                labels={p.hours.map((_, h) => String(h).padStart(2, "0"))}
                tips={p.hours.map((v, h) => `${String(h).padStart(2, "0")} Uhr · ${duration(v)} insgesamt`)}
                label="Stream-Zeit auf FitnaCraft je Uhrzeit"
                tickEvery={3}
              />
            </div>
          </div>

          <div className="box" data-tone="white">
            <h3 className="t-3">Sessions</h3>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Beginn</th>
                    <th className="num">Dauer</th>
                    <th className="num">⌀</th>
                    <th className="num">Spitze</th>
                    <th className="num">Follower</th>
                    <th className="num">Abos</th>
                    <th className="num">Clips</th>
                    <th>Titel</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sessions].reverse().map((s) => (
                    <tr key={s.a}>
                      <td>
                        {s.vod ? (
                          <a href={s.vod} target="_blank" rel="noopener noreferrer" title="VOD an dieser Stelle öffnen (falls noch vorhanden)">
                            {dateTime(new Date(s.a).toISOString())}
                          </a>
                        ) : (
                          dateTime(new Date(s.a).toISOString())
                        )}{" "}
                        <span className="muted">bis {time(new Date(s.b).toISOString())}</span>
                      </td>
                      <td className="num">{duration(s.seconds)}</td>
                      <td className="num">{num(s.avg)}</td>
                      <td className="num">{num(s.peak)}</td>
                      <td className="num">{s.followers !== null ? `+${num(s.followers)}` : "–"}</td>
                      <td className="num" title={`${s.paid} neu/verlängert · ${s.gift} verschenkt · ${num(s.bits)} Bits`}>
                        {num(s.paid + s.gift)}
                      </td>
                      <td className="num">{num(s.clips)}</td>
                      <td className="fc-title" title={s.titles.join("\n")}>
                        {s.titles[0]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="fc-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">Mit wem</h3>
              {links.length === 0 ? (
                <p className="muted">Keine anderen erfassten Spieler gleichzeitig auf FitnaCraft.</p>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Spieler</th>
                        <th className="num" title="Gleichzeitig live auf FitnaCraft">Zusammen</th>
                        <th className="num" title="Raids raus / rein">Raids</th>
                        <th className="num" title="Chat-Nachrichten raus / rein">Chat</th>
                        <th className="num" title="Gemeinsam im geteilten Chat (Stream Together)">Geteilt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {links.slice(0, 20).map((l) => {
                        const o = who(d, l.other)!;
                        const inFc = d.players.some((x) => x.id === l.other);
                        return (
                          <tr key={l.other}>
                            <td>
                              {inFc ? (
                                <Link className="fc-who" href={fcPlayerHref(key, l.other)}>
                                  <Head id={o.id} uuid={o.uuid} name={o.name} size={20} decorative /> {o.name}
                                </Link>
                              ) : (
                                <span className="fc-who">
                                  <Head id={o.id} uuid={o.uuid} name={o.name} size={20} decorative /> {o.name}
                                </span>
                              )}
                            </td>
                            <td className="num">{l.together ? duration(l.together) : "–"}</td>
                            <td className="num">{l.raidsOut + l.raidsIn ? `${l.raidsOut} / ${l.raidsIn}` : "–"}</td>
                            <td className="num">{l.msgsOut + l.msgsIn ? `${l.msgsOut} / ${l.msgsIn}` : "–"}</td>
                            <td className="num">{l.chatSeconds ? duration(l.chatSeconds) : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">Titel</h3>
              <ul className="fc-feed">
                {p.titles.map((t) => (
                  <li key={t.title}>
                    <span className="num muted">{hours(t.seconds)}</span>
                    <span>{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {raids.length > 0 && (
            <div className="box" data-tone="white">
              <h3 className="t-3">Raids</h3>
              <ul className="fc-feed fc-feed--wide">
                {raids.map((r) => (
                  <li key={`${r.at}-${r.from}`}>
                    <span className="num muted">{dayShort.format(r.at)}</span>
                    <span>
                      {r.from === id ? (
                        <>
                          raidet <b>{r.toName ?? name(r.to)}</b>
                        </>
                      ) : (
                        <>
                          wird von <b>{name(r.from)}</b> geraidet
                        </>
                      )}
                      {r.viewers ? ` mit ${num(r.viewers)} Zuschauern` : ""} · {time(new Date(r.at).toISOString())}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chats.length > 0 && (
            <div className="box" data-tone="white">
              <h3 className="t-3">Chat unter Spielern</h3>
              <p className="muted">Nachrichten erfasster Spieler in den Chats der anderen, während FitnaCraft lief.</p>
              <ul className="fc-feed">
                {chats.map((c, i) => (
                  <li key={`${c.at}-${i}`}>
                    <span className="num muted">{time(new Date(c.at).toISOString())}</span>
                    <span>
                      <b>{name(c.from)}</b> bei {name(c.to)}: {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.text}</a> : c.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="t-3" style={{ marginBottom: 12 }}>
              Meistgesehene Clips
            </h3>
            <ClipGrid clips={clips} showPlayer={false} />
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/spieler/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Spieler" figs={8} />}>
      <Profile {...props} />
    </Suspense>
  );
}
