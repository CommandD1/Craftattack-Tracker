import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { ShowMore } from "@/components/ShowMore";
import { loadTracker } from "@/lib/data";
import { num } from "@/lib/format";
import { previewGate } from "@/lib/preview";
import { getRaidAnalysis, type RaidPlayer } from "@/lib/raidAnalysis";
import { RaidScatter } from "../../_components/RaidScatter";
import { RaidHours } from "../../_components/RaidHours";
import { PairMatrix } from "../../_components/PairMatrix";

export const metadata: Metadata = { title: "Raids" };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const fac = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v);

/** Spalten der Tabelle; `v` = Sortierwert */
const COLS: { key: string; label: string; hint: string; v: (p: RaidPlayer) => number; show: (p: RaidPlayer) => string }[] = [
  { key: "gegeben", label: "Gegeben", hint: "Raids, die er an andere CraftAttack-Spieler gemacht hat", v: (p) => p.given, show: (p) => num(p.given) },
  { key: "zgegeben", label: "Zuschauer gegeben", hint: "Zuschauer, die er weitergeschickt hat", v: (p) => p.givenViewers, show: (p) => num(p.givenViewers) },
  {
    key: "rate",
    label: "Raid-Rate",
    hint: "Raids an Erfasste ÷ Stream-Enden, bei denen jemand Erfasstes live war (er hätte raiden können)",
    v: (p) => (p.opportunities ? (p.given - p.givenExternal) / p.opportunities : -1),
    show: (p) => (p.opportunities ? `${pct((p.given - p.givenExternal) / p.opportunities)} von ${num(p.opportunities)}` : "–"),
  },
  { key: "bekommen", label: "Bekommen", hint: "Raids, die er bekommen hat (von Erfassten)", v: (p) => p.received, show: (p) => num(p.received) },
  { key: "zbekommen", label: "Zuschauer bekommen", hint: "Zuschauer, die zu ihm geschickt wurden", v: (p) => p.receivedViewers, show: (p) => num(p.receivedViewers) },
  {
    key: "magnet",
    label: "Magnet",
    hint: "Bekommen ÷ erwartet: Erwartet = wie viele Raids er bekommen hätte, wenn jeder Raid zufällig an einen der gerade Live-Spieler gegangen wäre. Über 1 = häufiger gewählt als die Gelegenheit hergibt",
    v: (p) => (p.expected >= 0.5 ? p.received / p.expected : -1),
    show: (p) => (p.expected >= 0.5 ? `${fac(p.received / p.expected)}× (erw. ${fac(p.expected)})` : "–"),
  },
  {
    key: "bilanz",
    label: "Bilanz",
    hint: "Zuschauer bekommen minus gegeben",
    v: (p) => p.receivedViewers - p.givenViewers,
    show: (p) => `${p.receivedViewers - p.givenViewers > 0 ? "+" : ""}${num(p.receivedViewers - p.givenViewers)}`,
  },
  {
    key: "gruppe",
    label: "In Gruppe",
    hint: "Anteil seiner Raids an Erfasste, die in der eigenen Gruppe blieben (Gruppen ohne Raids berechnet)",
    v: (p) => (p.given - p.givenExternal ? p.givenInGroup / (p.given - p.givenExternal) : -1),
    show: (p) => (p.given - p.givenExternal ? pct(p.givenInGroup / (p.given - p.givenExternal)) : "–"),
  },
  {
    key: "abstand",
    label: "Weit weg",
    hint: "Anteil seiner Raids an Erfasste, die 3+ Schritte entfernt oder gar nicht verbunden waren (Netz ohne Raids)",
    v: (p) => (p.given - p.givenExternal ? (p.givenHops[3] + p.givenHops[0]) / (p.given - p.givenExternal) : -1),
    show: (p) => (p.given - p.givenExternal ? pct((p.givenHops[3] + p.givenHops[0]) / (p.given - p.givenExternal)) : "–"),
  },
];

async function Raids(props: PageProps<"/vorschau/[key]/raids">) {
  const root = await previewGate(props.params);
  const sp = await props.searchParams;
  const [a, { state }] = await Promise.all([getRaidAnalysis(), loadTracker()]);
  const name = (id: string) => state.players[id]?.name ?? id;
  const uuid = (id: string) => state.players[id]?.uuid ?? "";
  const names: Record<string, [string, string]> = Object.fromEntries(Object.values(state.players).map((x) => [x.id, [x.name, x.uuid]]));
  const sort = COLS.find((c) => c.key === sp.sort) ?? COLS[0];
  const rows = [...a.players].sort((x, y) => sort.v(y) - sort.v(x) || y.given + y.received - (x.given + x.received));
  const active = a.players.filter((p) => p.given + p.received > 0);
  const inG = a.inGroup.known ? a.inGroup.actual / a.inGroup.known : 0;
  const inGexp = a.inGroup.known ? a.inGroup.expected / a.inGroup.known : 0;
  const hopTotal = a.hops.reduce((s, h) => s + h.actual, 0) || 1;
  const hopExp = a.hops.reduce((s, h) => s + h.expected, 0) || 1;
  const top = (f: (p: RaidPlayer) => number) => [...a.players].sort((x, y) => f(y) - f(x))[0];
  const magnet = [...a.players].filter((p) => p.expected >= 3).sort((x, y) => y.received / y.expected - x.received / x.expected)[0];

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">
            Vorschau · <Link href={`${root}/ereignisse`}>Ereignisse</Link> · Raids
          </p>
          <h1 className="t-1">Wer raidet wen?</h1>
          <p>
            Gebende und Bekommende nach Anzahl und Zuschauern – gemessen an den Gelegenheiten: Wer gerade live war, hätte das Ziel sein können. Gruppen und Abstand kommen aus dem
            Netz ohne Raids (geteilte Chats, Titel, Nachrichten), damit Raids sich nicht selbst zur Gruppe machen. Erfasst werden nur Raids zwischen
            CraftAttack-Spielern; Raids an andere Kanäle sieht der Tracker nicht.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt title={`An ${num(a.days)} Tagen`}>Raids</dt>
              <FigValue>{num(a.total)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Spieler, die mindestens einmal geraidet haben oder geraidet wurden">Spieler beteiligt</dt>
              <FigValue>{num(active.length)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Summe der Raid-Zuschauer">Zuschauer weitergegeben</dt>
              <FigValue>{num(a.viewers)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title={`Zufällig unter den Live-Spielern wären es ${pct(inGexp)}`}>In die eigene Gruppe</dt>
              <FigValue unit={`statt ${pct(inGexp)}`}>{pct(inG)}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <ul className="vs-rel" aria-label="Auffällig">
            <li className="tag" data-tone="gold">
              Meiste Raids gegeben: {name(top((p) => p.given).id)} ({num(top((p) => p.given).given)})
            </li>
            <li className="tag" data-tone="gold">
              Meiste Zuschauer bekommen: {name(top((p) => p.receivedViewers).id)} ({num(top((p) => p.receivedViewers).receivedViewers)})
            </li>
            {magnet && (
              <li className="tag" data-tone="gold" title="Mindestens 3 erwartete Raids">
                Größter Magnet: {name(magnet.id)} ({fac(magnet.received / magnet.expected)}× so oft wie erwartet)
              </li>
            )}
          </ul>

          <div className="vs-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">Gebende und Bekommende – Anzahl</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Über der Diagonale bekommt jemand mehr Raids, als er gibt.
              </p>
              <RaidScatter
                points={active.map((p) => ({ id: p.id, name: name(p.id), uuid: uuid(p.id), x: p.given, y: p.received }))}
                xLabel="gegeben"
                yLabel="bekommen"
                label="Raids gegeben gegen bekommen je Spieler"
              />
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">… nach Zuschauern</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Wie viele Zuschauer jemand weitergeschickt bzw. bekommen hat.
              </p>
              <RaidScatter
                points={active.map((p) => ({ id: p.id, name: name(p.id), uuid: uuid(p.id), x: p.givenViewers, y: p.receivedViewers }))}
                xLabel="Zuschauer gegeben"
                yLabel="Zuschauer bekommen"
                label="Raid-Zuschauer gegeben gegen bekommen je Spieler"
              />
            </div>
          </div>

          <div className="box" data-tone="white" id="tabelle">
            <h3 className="t-3">Alle Spieler</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              Sortiert nach „{sort.label}“ – {sort.hint}. Spaltenkopf anklicken zum Umsortieren.
            </p>
            <ShowMore height={900} label="Spieler">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Spieler</th>
                    {COLS.map((c) => (
                      <th key={c.key} className="num" title={c.hint}>
                        <Link href={`${root}/raids?sort=${c.key}#tabelle`} aria-current={c.key === sort.key ? "true" : undefined} scroll={false}>
                          {c.label}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/spieler/${encodeURIComponent(p.id)}`} className="vs-pair__side" style={{ gap: 8 }}>
                          <Head id={p.id} uuid={uuid(p.id)} name={name(p.id)} size={20} decorative /> {name(p.id)}
                        </Link>
                      </td>
                      {COLS.map((c) => (
                        <td key={c.key} className="num">
                          {c.show(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </ShowMore>
          </div>

          <div className="vs-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">Gruppe und Abstand</h3>
              <p className="muted" style={{ marginBottom: 12 }}>
                Wohin Raids an Erfasste gingen, verglichen mit einem zufälligen Raid an einen der gerade Live-Spieler (schwarzer Strich). Abstand = Schritte im Netz ohne Raids.
              </p>
              <dl className="vs-compare">
                {[
                  { label: "eigene Gruppe", actual: inG, expected: inGexp },
                  ...a.hops.map((h) => ({ label: h.label, actual: h.actual / hopTotal, expected: h.expected / hopExp })),
                ].map((r) => (
                  <div key={r.label} style={{ display: "contents" }}>
                    <dt>{r.label}</dt>
                    <dd className="vs-compare__bar" title={`tatsächlich ${pct(r.actual)}, zufällig ${pct(r.expected)}`}>
                      <span style={{ width: `${Math.min(100, r.actual * 100)}%` }} />
                      <i style={{ left: `${Math.min(100, r.expected * 100)}%` }} />
                    </dd>
                    <dd className="num" style={{ margin: 0 }}>
                      {pct(r.actual)} <span className="muted">/ {pct(r.expected)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">Tageszeit</h3>
              <RaidHours hours={a.hours} />
            </div>
          </div>

          <div className="box" data-tone="white">
            <h3 className="t-3">Wer → wen</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              Raids zwischen erfassten Spielern: Zeilen raiden, Spalten werden geraidet, Kreisfläche = Anzahl. Klick öffnet den neuesten Raid des Paars.
            </p>
            <PairMatrix matrix={a.pairs} names={names} giver={top((p) => p.given).id} receiver={top((p) => p.received).id} hrefBase={`${root}/ereignis/`} noun="Raids" />
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/raids">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Raids" />}>
      <Raids {...props} />
    </Suspense>
  );
}
