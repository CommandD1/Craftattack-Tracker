"use client";

import { useRef, useState } from "react";
import { distance, duration, hearts, num } from "@/lib/format";

/**
 * Verlauf eines Werts rund um ein Ereignis (±3 Std): Linie mit Lücken, senkrechte Markierung beim Ereignis,
 * Fadenkreuz mit Tooltip. Eine Reihe, eine Achse.
 */
type Format = "num" | "distance" | "duration" | "hearts";
const FMT: Record<Format, (v: number) => string> = { num, distance, duration, hearts: (v) => `${hearts(v)} Herzen` };
const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

function niceTicks(min: number, max: number, count = 3, minStep = 0): number[] {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  // Ganze Zähler: nie Schritte unter 1, sonst stünde „28, 28, 27“ an der Achse
  const step = Math.max(minStep, [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

export function EventWindowChart({
  points,
  from,
  to,
  at,
  label,
  format = "num",
  tone = "var(--twitch)",
  step = false,
}: {
  points: [number, number | null][];
  from: number;
  to: number;
  at: number;
  label: string;
  format?: Format;
  /** Linienfarbe (CSS) */
  tone?: string;
  /** Treppe (Zähler) statt Linie */
  step?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = FMT[format];
  const W = 600;
  const H = 180;
  const L = 64;
  const R = 10;
  const T = 12;
  const B = 24;
  const vals = points.map(([, v]) => v).filter((v): v is number => v !== null);
  if (vals.length < 2) return <p className="muted">In diesem Zeitraum keine Werte.</p>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi, 3, format === "num" ? 1 : 0);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1] === yMin ? yMin + 1 : ticks[ticks.length - 1];
  const x = (t: number) => L + ((t - from) / (to - from)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  // Pfad mit Lücken
  let d = "";
  let pen = false;
  for (const [t, v] of points) {
    if (v === null) {
      pen = false;
      continue;
    }
    const X = x(t).toFixed(1);
    const Y = y(v).toFixed(1);
    if (!pen) d += `M${X},${Y}`;
    else d += step ? `H${X}V${Y}` : `L${X},${Y}`;
    pen = true;
  }
  const hours: number[] = [];
  for (let t = Math.ceil(from / 3600_000) * 3600_000; t <= to; t += 3600_000) hours.push(t);
  const withVal = points.filter(([, v]) => v !== null) as [number, number][];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const t = from + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (to - from);
    let best = 0;
    for (let i = 1; i < withVal.length; i++) if (Math.abs(withVal[i][0] - t) < Math.abs(withVal[best][0] - t)) best = i;
    setHover(best);
  };
  const h = hover !== null ? withVal[hover] : null;
  const atVal = withVal.reduce<[number, number] | null>((m, p) => (p[0] <= at + 60_000 && (!m || p[0] > m[0]) ? p : m), null);
  return (
    <div className="ewc">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ewc__grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="ewc__tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="ewc__tick">
            {tf.format(t)}
          </text>
        ))}
        <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} className="ewc__mark" />
        <path d={d} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
        {atVal && <circle cx={x(atVal[0])} cy={y(atVal[1])} r={4.5} fill={tone} className="ewc__dot" />}
        {h && (
          <>
            <line x1={x(h[0])} x2={x(h[0])} y1={T} y2={H - B} className="ewc__cross" />
            <circle cx={x(h[0])} cy={y(h[1])} r={4} fill={tone} className="ewc__dot" />
          </>
        )}
      </svg>
      {h && (
        <div className="ewc__tip" style={{ left: `${(x(h[0]) / W) * 100}%` }} role="status">
          <b>{fmt(h[1])}</b> {tf.format(h[0])} Uhr
          {Math.abs(h[0] - at) < 90_000 ? " · Ereignis" : h[0] < at ? ` · ${Math.round((at - h[0]) / 60_000)} Min davor` : ` · ${Math.round((h[0] - at) / 60_000)} Min danach`}
        </div>
      )}
    </div>
  );
}
