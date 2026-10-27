import Link from "next/link";
import { Head } from "./Head";
import type { Example, Magnet, Migration, Pair, RaidFlow, WaitingRoom } from "@/lib/viewerMigration";
import { num } from "@/lib/format";

/**
 * Darstellung der Zuschauerwanderung (lib/viewerMigration.ts). Reines SVG auf dem Server: Werte stehen zusätzlich
 * in Tabellen und als Tooltip (<title>). Farben aus einer geprüften Palette (CVD-sicher, hell und dunkel getrennt
 * abgestimmt), als Variablen unter `.mig` in globals.css.
 */

type Names = Record<string, { name: string; uuid: string } | undefined>;

const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const fmtPct = (x: number) => `${pct.format(x * 100)} %`;
const signed = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
/** Unsicher: wenige Starts oder kaum vom Zufall zu unterscheiden */
const unsure = (r: { n: number; t: number }) => r.n < 20 || Math.abs(r.t) < 2;

function Person({ id, names }: { id: string; names: Names }) {
  const p = names[id];
  return (
    <Link href={`/spieler/${encodeURIComponent(id)}`} className="conn__person">
      <Head id={id} uuid={p?.uuid} name={p?.name ?? id} size={22} decorative />
      <span>{p?.name ?? id}</span>
    </Link>
  );
}

/** Balken um die Null: links rot (weniger als sonst), rechts blau (mehr als sonst) */
function DivergingBar({ value, max, faded, label }: { value: number; max: number; faded: boolean; label: string }) {
  const W = 220;
  const H = 18;
  const mid = W / 2;
  const len = Math.min(1, Math.abs(value) / max) * (mid - 4);
  const x = value < 0 ? mid - len : mid;
  return (
    <svg className="mig__bar" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={mid} x2={mid} y1={0} y2={H} className="mig__zero" />
      {len > 0 && (
        <rect x={x} y={4} width={len} height={H - 8} rx={2} className={value < 0 ? "mig__loss" : "mig__gain"} opacity={faded ? 0.35 : 1} />
      )}
    </svg>
  );
}

export function WaitingRoomTable({ rows, names, title }: { rows: WaitingRoom[]; names: Names; title: string }) {
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(r.effect)));
  return (
    <div className="tbl-wrap">
      <table className="tbl mig__tbl">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <th>Streamer</th>
            <th className="num" title="Fremde Starts, während dieser Stream lief">Starts</th>
            <th className="num">Ø Zuschauer</th>
            <th>Abweichung vom Üblichen</th>
            <th className="num">Effekt</th>
            <th className="num" title="Zusätzliche Zuschauer-Änderung je fremdem Start">je Start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = unsure(r);
            const name = names[r.id]?.name ?? r.id;
            return (
              <tr key={r.id}>
                <td>
                  <Person id={r.id} names={names} />
                </td>
                <td className="num">{num(r.n)}</td>
                <td className="num">{num(r.baseViewers)}</td>
                <td>
                  <DivergingBar
                    value={r.effect}
                    max={max}
                    faded={u}
                    label={`${name}: ${fmtPct(r.effect)} gegenüber dem Üblichen nach ${r.n} fremden Starts (t = ${r.t.toFixed(1)})`}
                  />
                </td>
                <td className="num">
                  {fmtPct(r.effect)}
                  {u && <span className="mig__unsure"> unsicher</span>}
                </td>
                <td className="num">{signed.format(r.perStart)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MagnetTable({ rows, names }: { rows: Magnet[]; names: Names }) {
  const max = Math.max(1, ...rows.map((r) => r.pulled));
  const W = 220;
  return (
    <div className="tbl-wrap">
      <table className="tbl mig__tbl">
        <caption className="sr-only">Wessen Start zieht anderen CraftAttack-Streams Zuschauer ab</caption>
        <thead>
          <tr>
            <th>Streamer geht live</th>
            <th className="num">Starts</th>
            <th>Zuschauer, die andere zusätzlich verlieren (20–40 Min danach)</th>
            <th className="num">je Start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const len = Math.max(0, (r.pulled / max) * (W - 4));
            const name = names[r.id]?.name ?? r.id;
            return (
              <tr key={r.id}>
                <td>
                  <Person id={r.id} names={names} />
                </td>
                <td className="num">{num(r.starts)}</td>
                <td>
                  <svg className="mig__bar" viewBox={`0 0 ${W} 18`} width={W} height={18} role="img" aria-label={`${name}: ca. ${num(r.pulled)} Zuschauer je Start`}>
                    <title>{`${name}: andere verlieren je Start zusammen ca. ${num(r.pulled)} Zuschauer mehr als üblich (${r.starts} Starts)`}</title>
                    <line x1={0} x2={0} y1={0} y2={18} className="mig__zero" />
                    {len > 0 && <rect x={0} y={4} width={len} height={10} rx={2} className="mig__s1" opacity={unsure({ n: r.starts * 5, t: r.t }) ? 0.35 : 1} />}
                  </svg>
                </td>
                <td className="num">
                  {num(Math.max(0, r.pulled))}
                  {unsure({ n: r.starts * 5, t: r.t }) && <span className="mig__unsure"> unsicher</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Heatmap: Zeile = Stream, der verliert; Spalte = Stream, der live geht; dunkler = mehr Verlust je Start */
export function PairHeatmap({ rows, cols, pairs, names }: { rows: string[]; cols: string[]; pairs: Pair[]; names: Names }) {
  const byKey = new Map(pairs.map((p) => [`${p.a}|${p.b}`, p]));
  const losses = pairs.filter((p) => rows.includes(p.a) && cols.includes(p.b) && p.n >= 2 && p.perEvent < 0).map((p) => -p.perEvent);
  const max = Math.max(1, ...losses);
  const STEPS = 6;
  const step = (loss: number) => Math.min(STEPS - 1, Math.floor((loss / max) * STEPS));
  const cell = 34;
  const left = 130;
  const top = 110;
  const W = left + cols.length * cell + 4;
  const H = top + rows.length * cell + 4;
  const name = (id: string) => names[id]?.name ?? id;
  return (
    <figure className="mig__fig">
      <div className="tbl-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Wer verliert an wen: Zuschauerverlust je Start" className="mig__heat">
          {cols.map((b, j) => (
            <text key={b} transform={`translate(${left + j * cell + cell / 2 + 4}, ${top - 8}) rotate(-55)`} className="mig__axis">
              {name(b)}
            </text>
          ))}
          {rows.map((a, i) => (
            <g key={a}>
              <text x={left - 8} y={top + i * cell + cell / 2 + 4} textAnchor="end" className="mig__axis">
                {name(a)}
              </text>
              {cols.map((b, j) => {
                const p = a === b ? undefined : byKey.get(`${a}|${b}`);
                const x = left + j * cell;
                const y = top + i * cell;
                const tip = p
                  ? `${name(a)} bei ${p.n} Start${p.n === 1 ? "" : "s"} von ${name(b)}: ${signed.format(p.perEvent)} Zuschauer je Start gegenüber dem Üblichen`
                  : a === b
                    ? name(a)
                    : `${name(a)} lief bei keinem Start von ${name(b)}`;
                const cls = !p || p.n < 2 ? "mig__cell-none" : p.perEvent >= 0 ? "mig__cell-mid" : `mig__h${step(-p.perEvent)}`;
                return (
                  <rect key={b} x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={3} className={cls}>
                    <title>{tip}</title>
                  </rect>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mig__legend">
        <span>weniger</span>
        {Array.from({ length: STEPS }, (_, k) => (
          <i key={k} className={`mig__h${k}`} />
        ))}
        <span>mehr Verlust je Start (bis ca. {num(max)} Zuschauer)</span>
        <i className="mig__cell-mid" /> <span>kein Verlust</span>
        <i className="mig__cell-none" /> <span>zu wenige Starts</span>
      </figcaption>
    </figure>
  );
}

/** Zuschauer der drei größten Verlierer in % des Stands vor dem Start, −30 bis +60 Min */
export function ExampleChart({ ex, names }: { ex: Example; names: Names }) {
  const W = 340;
  const H = 190;
  const L = 40;
  const R = 92;
  const T = 12;
  const B = 26;
  const ys = ex.lines.flatMap((l) => l.points.map((p) => p[1]));
  const yMin = Math.max(0, Math.floor(Math.min(60, ...ys) / 20) * 20);
  const yMax = Math.ceil(Math.max(120, ...ys) / 20) * 20;
  const x = (m: number) => L + ((m + 30) / 90) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax; v += 20) ticks.push(v);
  const name = (id: string) => names[id]?.name ?? id;
  // Namen am Linienende ohne Überlappung (mindestens 13 px Abstand)
  const ends = ex.lines
    .map((l, k) => ({ k, y: y(l.points.at(-1)?.[1] ?? 100), name: name(l.a) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
  const when = new Date(ex.at).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  return (
    <figure className="box mig__ex" data-tone="white">
      <figcaption>
        <b>{name(ex.b)}</b> geht live <span className="muted">· {when}</span>
        <br />
        <span className="muted">Andere CraftAttack-Streams verlieren zusammen ca. {num(ex.pulled)} Zuschauer mehr als üblich</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Zuschauer der größten Verlierer, als ${name(ex.b)} live ging`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 100 ? "mig__ref" : "mig__grid"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="mig__tick">
              {v} %
            </text>
          </g>
        ))}
        {[-30, 0, 30, 60].map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="mig__tick">
            {m === 0 ? "Start" : `${m > 0 ? "+" : ""}${m} Min`}
          </text>
        ))}
        <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} className="mig__start" />
        {ex.lines.map((l, k) => (
          <g key={l.a}>
            <polyline
              points={l.points.map(([m, v]) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
              className={`mig__line mig__l${k + 1}`}
            >
              <title>{`${name(l.a)}: vorher Ø ${num(l.before)} Zuschauer, ${signed.format(l.loss)} gegenüber dem Üblichen`}</title>
            </polyline>
          </g>
        ))}
        {ends.map((e) => (
          <g key={e.k}>
            <circle cx={W - R + 6} cy={e.y - 4} r={4} className={`mig__dot mig__l${e.k + 1}`} />
            <text x={W - R + 14} y={e.y} className="mig__label">
              {e.name}
            </text>
          </g>
        ))}
      </svg>
      <table className="tbl mig__mini">
        <caption className="sr-only">Größte Verlierer bei diesem Start</caption>
        <thead>
          <tr>
            <th>Verliert</th>
            <th className="num">vorher</th>
            <th className="num">ggü. üblich</th>
          </tr>
        </thead>
        <tbody>
          {ex.lines.map((l, k) => (
            <tr key={l.a}>
              <td>
                <i className={`mig__key mig__l${k + 1}`} aria-hidden="true" /> {name(l.a)}
              </td>
              <td className="num">{num(l.before)}</td>
              <td className="num">{signed.format(l.loss)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Zeilen und Spalten der Heatmap: deutlichste Wartezimmer × stärkste Magneten */
export function heatmapAxes(m: Migration): { rows: string[]; cols: string[] } {
  const rows = m.waitingRooms.filter((r) => r.effect < 0 && !unsure(r)).slice(0, 10).map((r) => r.id);
  const cols = m.magnets.slice(0, 10).map((r) => r.id);
  return { rows, cols };
}

/** Erben: wer nach dem Ende eines Streams mehr Zuschauer bekommt als üblich (ohne Raids) */
export function HeirsTable({ rows, names }: { rows: Pair[]; names: Names }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.perEvent)));
  const W = 220;
  return (
    <div className="tbl-wrap">
      <table className="tbl mig__tbl">
        <caption className="sr-only">Wer nach dem Ende eines Streams zusätzliche Zuschauer bekommt</caption>
        <thead>
          <tr>
            <th>Geht offline</th>
            <th>Bekommt Zuschauer</th>
            <th className="num">Enden</th>
            <th>Zusätzliche Zuschauer 5–25 Min danach</th>
            <th className="num">je Ende</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = unsure({ n: r.n * 5, t: r.t });
            const len = (Math.max(0, r.perEvent) / max) * (W - 4);
            const label = `${names[r.b]?.name ?? r.b} nach dem Ende von ${names[r.a]?.name ?? r.a}: ${signed.format(r.perEvent)} Zuschauer gegenüber dem Üblichen (${r.n} Enden, t = ${r.t.toFixed(1)})`;
            return (
              <tr key={`${r.a}|${r.b}`}>
                <td>
                  <Person id={r.a} names={names} />
                </td>
                <td>
                  <Person id={r.b} names={names} />
                </td>
                <td className="num">{num(r.n)}</td>
                <td>
                  <svg className="mig__bar" viewBox={`0 0 ${W} 18`} width={W} height={18} role="img" aria-label={label}>
                    <title>{label}</title>
                    <line x1={0} x2={0} y1={0} y2={18} className="mig__zero" />
                    {len > 0 && <rect x={0} y={4} width={len} height={10} rx={2} className="mig__s1" opacity={u ? 0.35 : 1} />}
                  </svg>
                </td>
                <td className="num">
                  {signed.format(r.perEvent)}
                  {u && <span className="mig__unsure"> unsicher</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Raids: ausdrücklicher Wechsel mit Zuschauerzahl laut Twitch */
export function RaidTable({ rows, names }: { rows: RaidFlow[]; names: Names }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl mig__tbl">
        <caption className="sr-only">Raids zwischen CraftAttack-Streams</caption>
        <thead>
          <tr>
            <th>Raidet</th>
            <th>Ziel</th>
            <th className="num">Raids</th>
            <th className="num">Zuschauer gesamt</th>
            <th className="num">Ø je Raid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.from}|${r.to}`}>
              <td>
                <Person id={r.from} names={names} />
              </td>
              <td>
                <Person id={r.to} names={names} />
              </td>
              <td className="num">{num(r.n)}</td>
              <td className="num">{num(r.viewers)}</td>
              <td className="num">{num(r.viewers / r.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
