import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { fcBase, fcData, fcGate, type FcPlayer } from "@/lib/fitnacraft";
import { dateTime, duration, num } from "@/lib/format";
import { FcHead, change, fcPlayerHref, hours } from "../_components/FcNav";
import { FcStackChart } from "../_components/FcStackChart";
import { FcBars } from "../_components/FcBars";

const SORTS = [
  { key: "zeit", label: "Zeit", hint: "Stream-Zeit auf FitnaCraft", v: (p: FcPlayer) => p.seconds },
  { key: "zuschauer", label: "⌀ Zuschauer", hint: "Durchschnittliche Zuschauer auf FitnaCraft", v: (p: FcPlayer) => p.avgViewers },
  { key: "vergleich", label: "vs. CA", hint: "⌀ Zuschauer auf FitnaCraft im Vergleich zu CraftAttack (ganze Staffel)", v: (p: FcPlayer) => (p.caAvgViewers ? p.avgViewers / p.caAvgViewers : -1) },
  { key: "spitze", label: "Spitze", hint: "Höchste Zuschauerzahl auf FitnaCraft", v: (p: FcPlayer) => p.peakViewers },
  { key: "zuschauerstunden", label: "Zuschauer-Std", hint: "Zuschauer × Stunden", v: (p: FcPlayer) => p.viewerHours },
  { key: "follower", label: "Follower", hint: "Follower-Zuwachs während der FitnaCraft-Streams", v: (p: FcPlayer) => p.followerGain },
  { key: "abos", label: "Abos", hint: "Neue und verlängerte Abos plus verschenkte", v: (p: FcPlayer) => p.paidSubs + p.giftSubs },
  { key: "bits", label: "Bits", hint: "Cheers im eigenen Kanal", v: (p: FcPlayer) => p.bits },
  { key: "clips", label: "Clips", hint: "Clips aus den FitnaCraft-Streams", v: (p: FcPlayer) => p.clips },
] as const;

const hourLabel = (h: number) => String(h).padStart(2, "0");

async function Overview(props: PageProps<"/fitnacraft/[key]">) {
  const key = await fcGate(props.params);
  const sp = await props.searchParams;
  const d = await fcData();
  const base = fcBase(key);
  const sort = SORTS.find((s) => s.key === sp.sortieren) ?? SORTS[0];
  const players = [...d.players].sort((a, b) => sort.v(b) - sort.v(a) || b.seconds - a.seconds);

  const totalSec = d.players.reduce((s, p) => s + p.seconds, 0);
  const viewerHours = d.players.reduce((s, p) => s + p.viewerHours, 0);
  const followers = d.players.reduce((s, p) => s + p.followerGain, 0);
  const paid = d.players.reduce((s, p) => s + p.paidSubs, 0);
  const gift = d.players.reduce((s, p) => s + p.giftSubs, 0);
  const bits = d.players.reduce((s, p) => s + p.bits, 0);
  const clips = d.players.reduce((s, p) => s + p.clips, 0);
  const peakN = Math.max(...d.bins.fcN);
  const peakNAt = d.bins.start + d.bins.fcN.indexOf(peakN) * d.bins.step;
  const peakV = Math.max(...d.bins.fc);
  const peakVAt = d.bins.start + d.bins.fc.indexOf(peakV) * d.bins.step;

  // Zuschauer je Stunde (Mittel der 5-Minuten-Werte) vom 27.10. bis zum Server-Ende
  const per = 12;
  const from = Date.parse("2026-10-26T23:00:00Z");
  const i0 = Math.max(0, Math.round((from - d.bins.start) / d.bins.step));
  const i1 = Math.min(d.bins.fc.length, Math.round((d.end - d.bins.start) / d.bins.step));
  const times: number[] = [];
  const agg = { fc: [] as number[], ca: [] as number[], other: [] as number[] };
  for (let i = i0; i + per <= i1; i += per) {
    times.push(d.bins.start + i * d.bins.step);
    for (const k of ["fc", "ca", "other"] as const) agg[k].push(d.bins[k].slice(i, i + per).reduce((a, b) => a + b, 0) / per);
  }
  const days = d.days.filter((x) => x.day >= "2026-10-27" && x.day <= "2026-11-10");
  const hoursAll = Array.from({ length: 24 }, (_, h) => d.players.reduce((s, p) => s + p.hours[h], 0));
  const dayCount = d.days.filter((x) => x.fcPlayers > 0).length || 1;

  const longest = [...d.sessions].sort((a, b) => b.seconds - a.seconds)[0];
  const peakSession = [...d.sessions].sort((a, b) => b.peak - a.peak)[0];
  const name = (id: string) => d.players.find((p) => p.id === id)?.name ?? id;
  const records = [
    { label: "Längste Session", id: longest.p, value: duration(longest.seconds), sub: dateTime(new Date(longest.a).toISOString()) },
    { label: "Höchste Spitze", id: peakSession.p, value: `${num(peakSession.peak)} Zuschauer`, sub: dateTime(new Date(peakSession.peakAt).toISOString()) },
    ...(
      [
        ["Meiste Stream-Zeit", (p: FcPlayer) => p.seconds, (p: FcPlayer) => hours(p.seconds)],
        ["Meiste Zuschauer-Stunden", (p: FcPlayer) => p.viewerHours, (p: FcPlayer) => num(p.viewerHours)],
        ["Meiste neue Follower", (p: FcPlayer) => p.followerGain, (p: FcPlayer) => `+${num(p.followerGain)}`],
        ["Meiste Abos", (p: FcPlayer) => p.paidSubs + p.giftSubs, (p: FcPlayer) => num(p.paidSubs + p.giftSubs)],
        ["Meiste verschenkte Abos", (p: FcPlayer) => p.giftSubs, (p: FcPlayer) => num(p.giftSubs)],
        ["Meiste Bits", (p: FcPlayer) => p.bits, (p: FcPlayer) => num(p.bits)],
      ] as const
    ).map(([label, f, fmt]) => {
      const p = [...d.players].sort((a, b) => f(b) - f(a))[0];
      return { label, id: p.id, value: fmt(p), sub: null as string | null };
    }),
  ];
  const winners = d.players.filter((p) => p.caAvgViewers && p.avgViewers > p.caAvgViewers).length;

  return (
    <>
      <FcHead k={key} d={d} tab="" title="FitnaCraft">
        <p>
          Nach dem 31. Oktober sind viele CraftAttack-Spieler auf FitnaCraft gewechselt, bis der Server am 10. November mit dem Finale endete. Der Tracker hat die Twitch-Daten
          aller Mitglieder jede Minute mitgeschrieben – auch, wenn sie nicht auf CraftAttack waren. Daraus ist dieser einmalige Rückblick entstanden.
        </p>
      </FcHead>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt title="CraftAttack-Mitglieder mit mindestens einer FitnaCraft-Session">Spieler</dt>
              <FigValue>{num(d.players.length)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Stream-Zeit aller Spieler auf FitnaCraft zusammen">Stream-Zeit</dt>
              <FigValue>{hours(totalSec)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Zuschauer × Stunden, über alle FitnaCraft-Streams">Zuschauer-Stunden</dt>
              <FigValue>{num(viewerHours)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`Höchste Summe der Zuschauer aller FitnaCraft-Streams, ${dateTime(new Date(peakVAt).toISOString())}`}>Spitze Zuschauer</dt>
              <FigValue>{num(peakV)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`Meiste Spieler gleichzeitig live auf FitnaCraft, ${dateTime(new Date(peakNAt).toISOString())}`}>Gleichzeitig live</dt>
              <FigValue>{num(peakN)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Summe der Follower-Zuwächse während der FitnaCraft-Streams">Neue Follower</dt>
              <FigValue>{`+${num(followers)}`}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`${num(paid)} neue oder verlängerte, ${num(gift)} verschenkte`}>Abos</dt>
              <FigValue>{num(paid + gift)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`Clips aus FitnaCraft-Streams · dazu ${num(bits)} Bits aus Cheers`}>Clips</dt>
              <FigValue>{num(clips)}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block block--tight mig" data-tone="paper">
        <div className="wrap stack">
          <div className="section-head">
            <div>
              <h2 className="t-2">Wohin die Zuschauer gingen</h2>
              <p className="muted">
                Zuschauer aller erfassten CraftAttack-Mitglieder, je Stunde gemittelt: auf FitnaCraft, auf CraftAttack oder bei anderen Inhalten.
              </p>
            </div>
          </div>
          <div className="box" data-tone="white">
            <FcStackChart
              times={times}
              label="Zuschauer der CraftAttack-Mitglieder je Stunde nach Ort"
              series={[
                { name: "FitnaCraft", cls: "mig__c1", values: agg.fc },
                { name: "CraftAttack", cls: "mig__c2", values: agg.ca },
                { name: "Andere Inhalte", cls: "mig__c0", values: agg.other },
              ]}
              marker={{ at: d.from, label: "erster FitnaCraft-Stream" }}
            />
          </div>
          <div className="box" data-tone="white">
            <h3 className="t-3">Tag für Tag</h3>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th className="num" title="Spieler live auf FitnaCraft">FitnaCraft</th>
                    <th className="num" title="Spieler auf CraftAttack und live">CraftAttack</th>
                    <th className="num" title="Zuschauer-Stunden auf FitnaCraft">Zuschauer-Std FC</th>
                    <th className="num" title="Zuschauer-Stunden auf CraftAttack">Zuschauer-Std CA</th>
                    <th className="num" title="Anteil FitnaCraft an FC + CA">Anteil FC</th>
                    <th className="num" title="Höchste Zuschauersumme auf FitnaCraft">Spitze FC</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((x) => (
                    <tr key={x.day}>
                      <td>
                        {x.fcPlayers ? (
                          <Link href={`${base}/zeitstrahl?tag=${x.day}`}>{new Date(`${x.day}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" })}</Link>
                        ) : (
                          new Date(`${x.day}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" })
                        )}
                      </td>
                      <td className="num">{x.fcPlayers || "–"}</td>
                      <td className="num">{x.caPlayers || "–"}</td>
                      <td className="num">{x.fcVh ? num(x.fcVh) : "–"}</td>
                      <td className="num">{x.caVh ? num(x.caVh) : "–"}</td>
                      <td className="num">{x.fcVh + x.caVh ? `${Math.round((x.fcVh / (x.fcVh + x.caVh)) * 100)} %` : "–"}</td>
                      <td className="num">{x.fcPeakV ? num(x.fcPeakV) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper" id="bestenliste">
        <div className="wrap stack">
          <div className="section-head">
            <div>
              <h2 className="t-2">Bestenliste</h2>
              <p className="muted">
                Sortiert nach „{sort.label}“ ({sort.hint}), Spaltenkopf anklicken zum Umsortieren. {winners} von {d.players.filter((p) => p.caAvgViewers).length} hatten auf FitnaCraft im Schnitt mehr Zuschauer als auf CraftAttack.
              </p>
            </div>
          </div>
          <div className="box" data-tone="white">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Spieler</th>
                    {SORTS.map((s) => (
                      <th key={s.key} className="num" title={s.hint}>
                        <Link href={`${base}${s.key === "zeit" ? "" : `?sortieren=${s.key}`}#bestenliste`} aria-current={s.key === sort.key ? "true" : undefined} scroll={false}>
                          {s.label}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {players.map((p, i) => (
                    <tr key={p.id}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <Link className="fc-who" href={fcPlayerHref(key, p.id)}>
                          <Head id={p.id} uuid={p.uuid} name={p.name} size={22} decorative /> {p.name}
                        </Link>
                      </td>
                      <td className="num">{hours(p.seconds)}</td>
                      <td className="num">{num(p.avgViewers)}</td>
                      <td className="num" title={p.caAvgViewers ? `CraftAttack ⌀ ${num(p.caAvgViewers)}` : "Nie auf CraftAttack gestreamt"}>
                        {change(p.avgViewers, p.caAvgViewers)}
                      </td>
                      <td className="num">{num(p.peakViewers)}</td>
                      <td className="num">{num(p.viewerHours)}</td>
                      <td className="num">+{num(p.followerGain)}</td>
                      <td className="num" title={`${num(p.paidSubs)} neu/verlängert · ${num(p.giftSubs)} verschenkt`}>
                        {num(p.paidSubs + p.giftSubs)}
                      </td>
                      <td className="num">{num(p.bits)}</td>
                      <td className="num">{num(p.clips)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap fc-two">
          <div className="box" data-tone="white">
            <h3 className="t-3">Rekorde</h3>
            <div className="tbl-wrap">
              <table className="tbl">
                <tbody>
                  {records.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>
                        <Link className="fc-who" href={fcPlayerHref(key, r.id)}>
                          <Head id={r.id} uuid={d.names[r.id]?.[1]} name={name(r.id)} size={20} decorative /> {name(r.id)}
                        </Link>
                      </td>
                      <td className="num" title={r.sub ?? undefined}>
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="box" data-tone="white">
            <h3 className="t-3">Tagesrhythmus</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Wie viele Spieler im Schnitt zu jeder Uhrzeit live auf FitnaCraft waren.
            </p>
            <FcBars
              values={hoursAll}
              labels={hoursAll.map((_, h) => hourLabel(h))}
              tips={hoursAll.map((v, h) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)} Uhr · ⌀ ${(v / 3600 / dayCount).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Spieler live`)}
              label="Durchschnittlich live auf FitnaCraft je Uhrzeit"
              tickEvery={3}
            />
          </div>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <details className="box" data-tone="white">
            <summary className="t-3">Wie FitnaCraft erkannt wird</summary>
            <ul style={{ marginTop: 12 }}>
              <li>Eine Minute zählt als FitnaCraft, wenn der Spieler live war, in der Kategorie Minecraft streamte, gerade nicht auf CraftAttack online war und der Titel „FitnaCraft“ nannte (auch „Fitna Craft“).</li>
              <li>Nicht gezählt: VOD-Wiederholungen („💥 VOD 💥“), Titel mit „vorbei“ und alles nach dem Finale am 10. November.</li>
              <li>Unterbrechungen bis 10 Minuten gehören zur selben Session; Schnipsel unter 3 Minuten fallen weg.</li>
              <li>Abos, Bits, Clips und Follower zählen nur, wenn sie während einer FitnaCraft-Session passierten. Der FitnaCraft-Server selbst wurde nie abgefragt, deshalb gibt es keine Spielwerte wie Tode oder Blöcke.</li>
              <li>24/7-Streams mit FitnaCraft im Titel zählen auch dann, wenn der Streamer gerade schlief – Twitch verrät das nicht.</li>
            </ul>
          </details>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="FitnaCraft" figs={8} />}>
      <Overview {...props} />
    </Suspense>
  );
}
