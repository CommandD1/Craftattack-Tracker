"use client";

import { useRef, useState } from "react";
import { distance, duration, hearts, num } from "@/lib/format";

/**
 * Rohdaten hinter einem Zähler-Ereignis: Zuwachs je Messung rund um das Ereignis als Säulen – auch die, die kein
 * Ereignis wurden. Linien: ab wann der Tracker ein Ereignis anlegt und ab wann es an diesem Tag im Feed steht.
 * Säulen über der Ereignis-Schwelle in Farbe, darunter blass, das Ereignis selbst dunkel; eine Serie als Band.
 */
type Format = "num" | "distance" | "duration" | "hearts";
const FMT: Record<Format, (v: number) => string> = { num, distance, duration, hearts: (v) => `${hearts(v)} Herzen` };
const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

export function EventSteps({
  steps,
  from,
  to,
  at,
  eventMin,
  feedMin,
  streak,
  format = "num",
  label,
}: {
  steps: [number, number][];
  from: number;
  to: number;
  at: number;
  eventMin: number | null;
  feedMin: number | null;
  streak: { from: number; to: number } | null;
  format?: Format;
  label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = FMT[format];
  if (!steps.length) return <p className="muted">In diesem Zeitraum keine Messungen.</p>;
  const W = 900;
  const H = 210;
  const L = 64;
  const R = 10;
  const T = 14;
  const B = 24;
  // Höhe: größter Zuwachs, aber die Schwellen sollen sichtbar bleiben
  const top = Math.max(1, ...steps.map(([, d]) => d), (eventMin ?? 0) * 1.15, (feedMin ?? 0) * 1.15);
  const x = (t: number) => L + ((t - from) / (to - from)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  // Säulenbreite aus dem typischen Abstand der Messungen
  const gaps = steps.slice(1).map(([t], i) => t - steps[i][0]).sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60_000;
  const bw = Math.max(1.2, ((typical / (to - from)) * (W - L - R)) * 0.8);
  let near = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i][0] - at) < Math.abs(steps[near][0] - at)) near = i;
  const isEvent = (i: number) => i === near && Math.abs(steps[i][0] - at) < 3 * 60_000;
  const hours: number[] = [];
  for (let t = Math.ceil(from / 3600_000) * 3600_000; t <= to; t += 3600_000) hours.push(t);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const t = from + ((((e.clientX - r.left) / r.width) * W - L) / (W - L - R)) * (to - from);
    let best = 0;
    for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i][0] - t) < Math.abs(steps[best][0] - t)) best = i;
    setHover(best);
  };
  const h = hover !== null ? steps[hover] : null;
  const over = eventMin !== null ? steps.filter(([, d]) => d >= eventMin).length : 0;
  return (
    <div className="ewc">
      <ul className="legend" style={{ marginBottom: 6 }}>
        <li>
          <i style={{ background: "var(--idle)" }} /> Zuwachs ohne Ereignis
        </li>
        {eventMin !== null && (
          <li>
            <i style={{ background: "var(--presence)" }} /> wurde ein Ereignis ({over})
          </li>
        )}
        <li>
          <i style={{ background: "var(--ink)" }} /> dieses Ereignis
        </li>
      </ul>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {streak && <rect x={x(streak.from) - bw} y={T} width={Math.max(2, x(streak.to) - x(streak.from) + bw * 2)} height={H - T - B} className="ews__streak" />}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="ewc__tick">
            {tf.format(t)}
          </text>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="ewc__grid" />
        <text x={L - 6} y={y(0) + 4} textAnchor="end" className="ewc__tick">
          0
        </text>
        {steps.map(([t, d], i) =>
          d > 0 ? (
            <rect
              key={t}
              x={x(t) - bw / 2}
              y={y(d)}
              width={bw}
              height={Math.max(1, y(0) - y(d))}
              rx={Math.min(2, bw / 2)}
              className={isEvent(i) ? "ews__bar ews__bar--this" : eventMin !== null && d >= eventMin ? "ews__bar ews__bar--event" : "ews__bar"}
            />
          ) : null,
        )}
        {eventMin !== null && (
          <g>
            <line x1={L} x2={W - R} y1={y(eventMin)} y2={y(eventMin)} className="ews__line" />
            <text x={L - 6} y={y(eventMin) + 4} textAnchor="end" className="ewc__tick ews__lbl">
              {fmt(eventMin)}
            </text>
            <text x={W - R} y={y(eventMin) - 4} textAnchor="end" className="ewc__tick ews__lbl">
              Ereignis ab {fmt(eventMin)}
            </text>
          </g>
        )}
        {feedMin !== null && feedMin !== eventMin && (
          <g>
            <line x1={L} x2={W - R} y1={y(feedMin)} y2={y(feedMin)} className="ews__line ews__line--feed" />
            <text x={L - 6} y={y(feedMin) + 4} textAnchor="end" className="ewc__tick ews__lbl">
              {fmt(feedMin)}
            </text>
            <text x={W - R} y={y(feedMin) - 4} textAnchor="end" className="ewc__tick ews__lbl">
              im Feed ab {fmt(feedMin)} (an diesem Tag)
            </text>
          </g>
        )}
        <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} className="ewc__mark" opacity={0.35} />
        {h && <line x1={x(h[0])} x2={x(h[0])} y1={T} y2={H - B} className="ewc__cross" />}
      </svg>
      {h && (
        <div className="ewc__tip" style={{ left: `${(x(h[0]) / W) * 100}%` }} role="status">
          <b>+{fmt(h[1])}</b> {tf.format(h[0])} Uhr
          {eventMin !== null ? (h[1] >= eventMin ? " · wurde ein Ereignis" : ` · fehlten ${fmt(eventMin - h[1])}`) : ""}
        </div>
      )}
    </div>
  );
}
