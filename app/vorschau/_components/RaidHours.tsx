"use client";

import { useState } from "react";
import { num } from "@/lib/format";

/**
 * Raids je Tageszeit (Berlin), gestapelt: in die eigene Gruppe, aus der Gruppe heraus, an nicht erfasste Kanäle.
 * Darunter die Raid-Rate: Raids ÷ Stream-Enden, bei denen jemand Erfasstes live war (also geraidet werden konnte).
 */
export function RaidHours({ hours }: { hours: { h: number; inGroup: number; outGroup: number; external: number; viewers: number; ends: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 230;
  const L = 40;
  const R = 8;
  const T = 10;
  const B = 58;
  const max = Math.max(1, ...hours.map((x) => x.inGroup + x.outGroup + x.external));
  const cw = (W - L - R) / 24;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const rate = (x: (typeof hours)[number]) => (x.ends ? (x.inGroup + x.outGroup) / x.ends : null);
  const maxRate = Math.max(0.01, ...hours.map((x) => rate(x) ?? 0));
  const h = hover !== null ? hours[hover] : null;
  const seg = (x0: number, a: number, b: number, cls: string, key: string) =>
    b > a ? <rect key={key} x={x0 + 2} y={y(b)} width={cw - 4} height={Math.max(1, y(a) - y(b))} rx={2} className={cls} /> : null;
  return (
    <div className="ewc">
      <ul className="legend" style={{ marginBottom: 6 }}>
        <li>
          <i style={{ background: "var(--mig-c1, #2a78d6)" }} /> in die eigene Gruppe
        </li>
        <li>
          <i style={{ background: "var(--mig-c2, #eb6834)" }} /> aus der Gruppe heraus
        </li>
        {hours.some((x) => x.external > 0) && (
          <li>
            <i style={{ background: "var(--mig-c0, #b5b3ad)" }} /> an nicht erfasste Kanäle
          </li>
        )}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Raids je Tageszeit" onPointerLeave={() => setHover(null)}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="ewc__grid" />
        <text x={L - 6} y={y(max) + 4} textAnchor="end" className="ewc__tick">
          {num(max)}
        </text>
        {hours.map((x, i) => {
          const x0 = L + i * cw;
          const a = x.inGroup;
          const b = a + x.outGroup;
          const c = b + x.external;
          const r = rate(x);
          return (
            <g key={x.h} onPointerEnter={() => setHover(i)}>
              <rect x={x0} y={T} width={cw} height={H - T} fill="transparent" />
              {seg(x0, 0, a, "rh__in", "a")}
              {seg(x0, a, b, "rh__out", "b")}
              {seg(x0, b, c, "rh__ext", "c")}
              {r !== null && <rect x={x0 + 4} y={H - 30} width={cw - 8} height={Math.max(1, (r / maxRate) * 16)} transform={`translate(0 ${16 - Math.max(1, (r / maxRate) * 16)})`} className="rh__rate" />}
              {hover === i && <rect x={x0} y={T} width={cw} height={H - B - T} className="rh__hover" />}
              {i % 3 === 0 && (
                <text x={x0 + cw / 2} y={H - 38} textAnchor="middle" className="ewc__tick">
                  {String(x.h).padStart(2, "0")}
                </text>
              )}
            </g>
          );
        })}
        <text x={L - 6} y={H - 17} textAnchor="end" className="ewc__tick">
          Rate
        </text>
      </svg>
      <p className="muted" role="status" style={{ minHeight: "1.4em" }}>
        {h ? (
          <>
            <b>
              {String(h.h).padStart(2, "0")}–{String((h.h + 1) % 24).padStart(2, "0")} Uhr
            </b>
            : {num(h.inGroup + h.outGroup + h.external)} Raids ({num(h.inGroup)} in die Gruppe, {num(h.outGroup)} heraus{h.external ? `, ${num(h.external)} nach außen` : ""}) · ⌀{" "}
            {num((h.viewers || 0) / Math.max(1, h.inGroup + h.outGroup + h.external))} Zuschauer · Rate{" "}
            {rate(h) !== null ? `${Math.round(rate(h)! * 100)} %` : "–"} von {num(h.ends)} Stream-Enden mit Gelegenheit
          </>
        ) : (
          "Überfahren zeigt die Stunde. Die kleinen Balken unten: Anteil der Stream-Enden, die mit einem Raid an Erfasste endeten."
        )}
      </p>
    </div>
  );
}
