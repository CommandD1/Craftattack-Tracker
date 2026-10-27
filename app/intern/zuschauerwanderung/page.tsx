import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/Skeletons";
import { FigValue } from "@/components/FigValue";
import { ExampleChart, heatmapAxes, MagnetTable, PairHeatmap, WaitingRoomTable } from "@/components/ViewerMigration";
import { loadTracker } from "@/lib/data";
import { getViewerMigration } from "@/lib/viewerMigration";
import { num } from "@/lib/format";

/** Interne Auswertung: nirgends verlinkt und nicht für Suchmaschinen */
export const metadata: Metadata = { title: "Zuschauerwanderung", robots: { index: false, follow: false } };

const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "Europe/Berlin" });
/** Zeitraum kurz, z. B. „10.–25. Okt.“ (passt in die Kennzahl-Kachel) */
const span = (a: number, b: number) => {
  const x = day.formatToParts(a);
  const y = day.formatToParts(b);
  const month = (p: Intl.DateTimeFormatPart[]) => p.find((q) => q.type === "month")?.value;
  const d = (p: Intl.DateTimeFormatPart[]) => p.find((q) => q.type === "day")?.value;
  return month(x) === month(y) ? `${d(x)}.–${d(y)}. ${month(y)}` : `${day.format(a)} – ${day.format(b)}`;
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Intern" title="Zuschauerwanderung" tone="ender" />}>
      <Analysis />
    </Suspense>
  );
}

async function Analysis() {
  await connection();
  const [{ state }, m] = await Promise.all([loadTracker(), getViewerMigration()]);
  const names = Object.fromEntries(Object.values(state.players).map((p) => [p.id, { name: p.name, uuid: p.uuid }]));
  const losers = m.waitingRooms.filter((r) => r.effect < 0).slice(0, 20);
  const gainers = m.waitingRooms.filter((r) => r.effect > 0).reverse().slice(0, 8);
  const { rows, cols } = heatmapAxes(m);
  const range = m.from && m.to ? span(m.from, m.to) : "–";

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Intern · nicht verlinkt</p>
          <h1 className="t-1 mig__title">Zuschauerwanderung</h1>
          <p>
            Sind manche Streams nur das „Wartezimmer“, bis ein anderer CraftAttack-Streamer live geht? Für jeden Start mit mindestens
            300 Zuschauern wird jeder andere laufende Stream verglichen: Zuschauer 5 Min vor dem Start gegen 10–20 Min danach, abzüglich
            der Änderung, die dieser Stream sonst bei gleichem Streamalter und gleicher Tageszeit hat.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="white">
              <dt>Zeitraum</dt>
              <FigValue>{range}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt>Starts ausgewertet</dt>
              <FigValue>{num(m.bigStarts)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Paare aus Start und gleichzeitig laufendem Stream">Beobachtungen</dt>
              <FigValue>{num(m.observations)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="white">
              <dt title="Mittlere Abweichung aller laufenden Streams nach einem fremden Start">Ø alle Streams</dt>
              <FigValue>{`${pct.format(m.overall.effect * 100)} %`}</FigValue>
            </div>
          </dl>
          <p className="muted mig__note">
            Im Mittel verlieren laufende Streams kaum ({pct.format(m.overall.effect * 100)} % ± {pct.format(m.overall.se * 100).replace("+", "")} %).
            Das Wartezimmer gibt es also nicht überall, aber bei einzelnen Streams deutlich. „Unsicher“: unter 20 Starts oder der Effekt
            ist kleiner als das Zweifache seines Standardfehlers. Starts überlagern sich und betreffen viele Streams gleichzeitig; die
            Werte sind Hinweise, keine Beweise. Raids fallen heraus (der raidende Stream endet).
          </p>
        </div>
      </section>

      <section className="block mig" data-tone="paper">
        <div className="wrap stack">
          <div className="section-head">
            <h2 className="t-2">Wartezimmer</h2>
            <p className="muted">Streams, die nach fremden Starts mehr Zuschauer verlieren als sonst</p>
          </div>
          <div className="box" data-tone="white">
            <WaitingRoomTable rows={losers} names={names} title="Streams mit Zuschauerverlust nach fremden Starts" />
          </div>

          <div className="section-head">
            <h2 className="t-2">Magneten</h2>
            <p className="muted">Wessen Start anderen CraftAttack-Streams am meisten Zuschauer abzieht</p>
          </div>
          <div className="box" data-tone="white">
            <MagnetTable rows={m.magnets.slice(0, 15)} names={names} />
          </div>

          {rows.length > 0 && cols.length > 0 && (
            <>
              <div className="section-head">
                <h2 className="t-2">Wer verliert an wen</h2>
                <p className="muted">Zeilen: deutlichste Wartezimmer · Spalten: stärkste Magneten · Wert beim Überfahren</p>
              </div>
              <div className="box" data-tone="white">
                <PairHeatmap rows={rows} cols={cols} pairs={m.pairs} names={names} />
              </div>
            </>
          )}

          <div className="section-head">
            <h2 className="t-2">Beispiele</h2>
            <p className="muted">Die sechs Starts mit dem größten Abzug: Zuschauer der drei größten Verlierer in % des Stands vor dem Start</p>
          </div>
          <div className="grid mig__examples">
            {m.examples.map((ex) => (
              <ExampleChart key={`${ex.b}-${ex.at}`} ex={ex} names={names} />
            ))}
          </div>

          {gainers.length > 0 && (
            <>
              <div className="section-head">
                <h2 className="t-2">Gegenrichtung</h2>
                <p className="muted">Streams, die nach fremden Starts eher Zuschauer dazugewinnen</p>
              </div>
              <div className="box" data-tone="white">
                <WaitingRoomTable rows={gainers} names={names} title="Streams mit Zuschauergewinn nach fremden Starts" />
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
