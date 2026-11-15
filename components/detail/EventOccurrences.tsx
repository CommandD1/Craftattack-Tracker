"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { distance, duration, headUrl, hearts, num } from "@/lib/format";

/**
 * Wann es dieselbe Art sonst gab, über die ganze Staffel: x = Zeit, y = Stärke (Wurzel-Skala, damit Ausreißer die
 * übrigen nicht plattdrücken). Beim Spieler als Punkte, bei allen mit Kopf des Spielers als Marke (die stärksten),
 * dieses Ereignis mit Ring. Überfahren zeigt Wert und Zeit, Klick öffnet die Seite des anderen Ereignisses.
 */
type Format = "num" | "distance" | "duration" | "hearts" | "rank" | "nth";
// Rang: Stärke = 4 − Platz (lib/eventDetail.ts), angezeigt als Platz
const FMT: Record<Format, (v: number) => string> = { num, distance, duration, hearts: (v) => `${hearts(v)} Herzen`, rank: (v) => `Platz ${Math.round(4 - v)}`, nth: (v) => `als ${Math.round(v)}.` };
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });
const tipFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/** Wie viele der stärksten bei „alle“ als Kopf erscheinen */
const HEADS = 60;

export function EventOccurrences({
  points,
  ids,
  who,
  current,
  hrefBase,
  format = "num",
  label,
  heads = false,
  maxHeads = HEADS,
}: {
  /** [Zeitpunkt ms, Stärke, Index in `who` oder -1, Index in `ids`] */
  points: [number, number, number, number][];
  ids: string[];
  /** [id, Name, UUID] */
  who: [string, string, string][];
  current: string;
  /** Detailseite: hrefBase + encodeURIComponent(id) */
  hrefBase: string;
  format?: Format;
  label: string;
  /** Köpfe statt Punkte (alle Spieler) */
  heads?: boolean;
  /** Höchstens so viele Köpfe (die stärksten), der Rest als Punkte */
  maxHeads?: number;
}) {
  const router = useRouter();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = FMT[format];
  const W = 900;
  const H = 260;
  const L = 64;
  const R = 16;
  const T = 18;
  const B = 26;
  const ts = points.map((p) => p[0]);
  const t0 = Math.min(...ts) - 6 * 3600_000;
  const t1 = Math.max(...ts) + 6 * 3600_000;
  const max = Math.max(1, ...points.map((p) => p[1]));
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.sqrt(Math.max(0, v) / max)) * (H - T - B);
  // Achse: runde Werte, auf der Wurzel-Skala verteilt
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (const f of [0.05, 0.25, 0.5, 1]) {
      const raw = max * f;
      const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
      const v = Math.round(raw / pow) * pow;
      if (v > 0 && !out.includes(v) && v <= max) out.push(v);
    }
    return out;
  }, [max]);
  // Tage als dünne Linien, Beschriftung je nach Länge
  const days = useMemo(() => {
    const out: number[] = [];
    let last = "";
    for (let t = t0; t <= t1; t += 3600_000) {
      const k = dayKey.format(t);
      if (k !== last && new Date(t).getUTCMinutes() === 0) {
        out.push(t);
        last = k;
      }
    }
    return out;
  }, [t0, t1]);
  const every = Math.max(1, Math.ceil(days.length / 10));
  const strongest = useMemo(() => new Set([...points].sort((a, b) => b[1] - a[1]).slice(0, maxHeads).map((p) => p[3])), [points, maxHeads]);
  const cur = points.find((p) => ids[p[3]] === current);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    let best = -1;
    let bd = 22 * 22;
    points.forEach((p, i) => {
      const d = (x(p[0]) - px) ** 2 + (y(p[1]) - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };
  const h = hover !== null ? points[hover] : null;
  const open = (p: [number, number, number, number]) => router.push(`${hrefBase}${encodeURIComponent(ids[p[3]])}`);
  // Schwache zuerst zeichnen, damit die Köpfe oben liegen
  const order = [...points].sort((a, b) => a[1] - b[1]);
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
        onClick={() => h && ids[h[3]] !== current && open(h)}
        style={{ cursor: h && ids[h[3]] !== current ? "pointer" : undefined }}
      >
        {days.map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="ewc__grid" opacity={0.6} />
            {i % every === 0 && (
              <text x={x(t)} y={H - 8} textAnchor="middle" className="ewc__tick">
                {dayFmt.format(t + 12 * 3600_000)}
              </text>
            )}
          </g>
        ))}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ewc__grid" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="ewc__tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {order.map((p) => {
          const isCur = ids[p[3]] === current;
          const w = p[2] >= 0 ? who[p[2]] : null;
          if (heads && w && strongest.has(p[3]) && !isCur) {
            return <image key={p[3]} href={headUrl(w[2] || undefined, 32, w[0])} x={x(p[0]) - 8} y={y(p[1]) - 8} width={16} height={16} className="ewo__head" />;
          }
          return isCur ? null : <circle key={p[3]} cx={x(p[0])} cy={y(p[1])} r={heads ? 2.5 : 3.5} className={heads ? "ewo__dot ewo__dot--faint" : "ewo__dot"} />;
        })}
        {cur && (
          <g>
            {heads && cur[2] >= 0 ? (
              <image href={headUrl(who[cur[2]][2] || undefined, 64, who[cur[2]][0])} x={x(cur[0]) - 12} y={y(cur[1]) - 12} width={24} height={24} />
            ) : (
              <circle cx={x(cur[0])} cy={y(cur[1])} r={5} className="ewo__dot ewo__dot--cur" />
            )}
            <circle cx={x(cur[0])} cy={y(cur[1])} r={heads ? 16 : 10} className="ewo__ring" />
          </g>
        )}
        {h && <circle cx={x(h[0])} cy={y(h[1])} r={heads ? 11 : 7} className="ewo__hover" />}
      </svg>
      {h && (
        <div className="ewc__tip" style={{ left: `${(x(h[0]) / W) * 100}%` }} role="status">
          {h[2] >= 0 && <b>{who[h[2]][1]} · </b>}
          <b>{fmt(h[1])}</b> · {tipFmt.format(h[0])}
          {ids[h[3]] === current ? " · dieses Ereignis" : " · Klick öffnet es"}
        </div>
      )}
    </div>
  );
}
