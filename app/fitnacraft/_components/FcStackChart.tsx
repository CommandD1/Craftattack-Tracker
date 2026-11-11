"use client";

import { useRef, useState } from "react";

/**
 * Gestapelte Fläche über mehrere Tage (z. B. Zuschauer auf FitnaCraft, CraftAttack und bei anderen Inhalten).
 * Farben aus `.mig` (geprüfte Palette, hell/dunkel); Fadenkreuz mit Tooltip, je Tag eine Beschriftung.
 */

const nf = new Intl.NumberFormat("de-DE");
const tipFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });
const hourFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" });
const short = (v: number) => (v >= 10_000 ? `${nf.format(Math.round(v / 1000))} Tsd.` : nf.format(Math.round(v)));

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export function FcStackChart({
  times,
  series,
  label,
  unit = "Zuschauer",
  marker,
}: {
  times: number[];
  /** Von unten nach oben; `cls` = mig__c1 … mig__c7 / mig__c0 */
  series: { name: string; cls: string; values: number[] }[];
  label: string;
  unit?: string;
  /** Senkrechte Markierung (z. B. Wechsel am 31.10.) */
  marker?: { at: number; label: string } | null;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 300;
  const L = 56;
  const R = 12;
  const T = 14;
  const B = 28;
  const n = times.length;
  const totals = times.map((_, i) => series.reduce((s, x) => s + x.values[i], 0));
  const ticks = niceTicks(Math.max(1, ...totals));
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const xt = (t: number) => L + ((t - times[0]) / Math.max(1, times[n - 1] - times[0])) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const lower = new Array<number>(n).fill(0);
  const bands = series.map((s) => {
    const lo = [...lower];
    const hi = lo.map((v, i) => v + s.values[i]);
    for (let i = 0; i < n; i++) lower[i] = hi[i];
    const top = hi.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const bottom = lo.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return { s, d: `M${top.join("L")}L${bottom.join("L")}Z` };
  });
  // Tagesbeschriftung an Mitternacht (Berlin); bei vielen Tagen jeden zweiten
  const midnights = times.map((t, i) => ({ t, i })).filter(({ t }) => hourFmt.format(t) === "00" && new Date(t).getUTCMinutes() === 0);
  const every = midnights.length > 12 ? 2 : 1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  return (
    <div className="mig__chart">
      <ul className="mig__keys" aria-label="Legende">
        {[...series].reverse().map((s) => (
          <li key={s.name}>
            <i className={s.cls} aria-hidden="true" /> {s.name}
          </li>
        ))}
      </ul>
      <div className="mig__plot">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="mig__grid" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" className="mig__tick">
                {short(v)}
              </text>
            </g>
          ))}
          {midnights
            .filter((_, k) => k % every === 0)
            .map(({ t, i }) => (
              <g key={t}>
                <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="mig__grid" opacity={0.5} />
                <text x={x(i)} y={H - 8} textAnchor="middle" className="mig__tick">
                  {dayFmt.format(t)}
                </text>
              </g>
            ))}
          {bands.map(({ s, d }) => (
            <path key={s.name} d={d} className={`mig__band ${s.cls}`} />
          ))}
          {marker && marker.at > times[0] && marker.at < times[n - 1] && (
            <g>
              <line x1={xt(marker.at)} x2={xt(marker.at)} y1={T} y2={H - B} className="mig__cross" strokeDasharray="4 3" />
              <text x={xt(marker.at) + 6} y={T + 12} className="mig__tick">
                {marker.label}
              </text>
            </g>
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="mig__cross" />}
        </svg>
        {hover !== null && (
          <div className="mig__tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
            <b>
              {tipFmt.format(times[hover])} · {nf.format(Math.round(totals[hover]))} {unit}
            </b>
            {[...series].reverse().map((s) => (
              <span key={s.name}>
                <i className={s.cls} aria-hidden="true" /> {s.name}: {nf.format(Math.round(s.values[hover]))}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
