"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { headUrl, num } from "@/lib/format";

/**
 * Gebende gegen Bekommende: je Spieler ein Kopf, x = gegeben, y = bekommen (Wurzel-Skala, damit die vielen kleinen
 * nicht in der Ecke kleben). Diagonale = ausgeglichen; darüber bekommt jemand mehr, als er gibt. Klick → Profil.
 */
export function RaidScatter({
  points,
  xLabel,
  yLabel,
  label,
}: {
  points: { id: string; name: string; uuid: string; x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  label: string;
}) {
  const router = useRouter();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 400;
  const L = 56;
  const R = 16;
  const T = 16;
  const B = 40;
  const max = Math.max(1, ...points.map((p) => Math.max(p.x, p.y)));
  const s = (v: number) => Math.sqrt(Math.max(0, v) / max);
  const x = (v: number) => L + s(v) * (W - L - R);
  const y = (v: number) => H - B - s(v) * (H - T - B);
  const ticks = useMemo(() => {
    const out: number[] = [0];
    for (const f of [0.04, 0.2, 0.5, 1]) {
      const raw = max * f;
      const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
      const v = Math.round(raw / pow) * pow;
      if (v > 0 && !out.includes(v) && v <= max) out.push(v);
    }
    return out;
  }, [max]);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    let best = -1;
    let bd = 18 * 18;
    points.forEach((p, i) => {
      const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="ewc">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => h && router.push(`/spieler/${encodeURIComponent(h.id)}`)}
        style={{ cursor: h ? "pointer" : undefined }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="ewc__grid" />
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ewc__grid" />
            <text x={x(v)} y={H - B + 14} textAnchor="middle" className="ewc__tick">
              {num(v)}
            </text>
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="ewc__tick">
              {num(v)}
            </text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} className="ews__line" />
        <text x={x(max) - 4} y={y(max) + 14} textAnchor="end" className="ewc__tick">
          ausgeglichen
        </text>
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="ewc__tick ews__lbl">
          {xLabel} →
        </text>
        <text x={14} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(T + H - B) / 2})`} className="ewc__tick ews__lbl">
          {yLabel} →
        </text>
        {points.map((p, i) => (
          <image key={p.id} href={headUrl(p.uuid || undefined, 32, p.id)} x={x(p.x) - 8} y={y(p.y) - 8} width={16} height={16} className="ewo__head" opacity={hover === null || hover === i ? 1 : 0.55} />
        ))}
        {h && <circle cx={x(h.x)} cy={y(h.y)} r={11} className="ewo__hover" />}
      </svg>
      <p className="muted" role="status" style={{ minHeight: "1.4em" }}>
        {h ? (
          <>
            <b>{h.name}</b>: {xLabel} {num(h.x)} · {yLabel} {num(h.y)} · Klick öffnet das Profil
          </>
        ) : (
          "Überfahren zeigt den Spieler."
        )}
      </p>
    </div>
  );
}
