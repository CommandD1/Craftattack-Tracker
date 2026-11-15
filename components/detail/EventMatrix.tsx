"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { headUrl, num } from "@/lib/format";

/**
 * Häufigkeit einer Ereignis-Art bei allen Spielern, wenn alle Ereignisse gleich stark sind (z. B. Chat): Zeilen =
 * Spieler mit Kopf, Spalten = Tage, Kreisfläche = Anzahl an diesem Tag. Die Zelle dieses Ereignisses mit Ring.
 * Klick öffnet das erste Ereignis des Spielers an diesem Tag.
 */
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);

export function EventMatrix({
  players,
  days,
  cells,
  currentPlayer,
  currentDay,
  hrefBase,
  noun,
}: {
  /** [id, Name, UUID] */
  players: [string, string, string][];
  days: string[];
  /** [Spieler-Index, Tag-Index, Anzahl, erstes Ereignis] */
  cells: [number, number, number, string][];
  currentPlayer: string | null;
  currentDay: string;
  /** Detailseite: hrefBase + encodeURIComponent(id) */
  hrefBase: string;
  /** Wort für die Anzahl im Tooltip, z. B. „Chat-Nachrichten“ */
  noun: string;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const ROW = 22;
  const L = 150;
  const T = 26;
  const R = 10;
  const colW = Math.max(14, Math.min(28, 760 / Math.max(1, days.length)));
  const W = L + days.length * colW + R;
  const H = T + players.length * ROW + 6;
  const max = useMemo(() => Math.max(1, ...cells.map((c) => c[2])), [cells]);
  const r = (n: number) => 2 + Math.sqrt(n / max) * (Math.min(colW, ROW) / 2 - 2);
  const every = Math.max(1, Math.ceil(days.length / 16));
  const cx = (d: number) => L + d * colW + colW / 2;
  const cy = (p: number) => T + p * ROW + ROW / 2;
  const h = hover !== null ? cells[hover] : null;
  return (
    <div className="ewc">
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", minWidth: Math.min(W, 520) }} role="img" aria-label={`${noun} je Spieler und Tag`} onPointerLeave={() => setHover(null)}>
          {days.map((d, i) =>
            i % every === 0 ? (
              <text key={d} x={cx(i)} y={T - 10} textAnchor="middle" className="ewc__tick">
                {dayFmt.format(noon(d))}
              </text>
            ) : null,
          )}
          {players.map(([id, name, uuid], i) => (
            <g key={id}>
              {i % 2 === 0 && <rect x={0} y={T + i * ROW} width={W} height={ROW} className="ewm__band" />}
              <image href={headUrl(uuid || undefined, 32, id)} x={4} y={cy(i) - 8} width={16} height={16} className="ewo__head" />
              <text x={26} y={cy(i) + 4} className={id === currentPlayer ? "ewm__name ewm__name--cur" : "ewm__name"}>
                {name.length > 16 ? `${name.slice(0, 15)}…` : name}
              </text>
            </g>
          ))}
          {cells.map(([p, d, n], k) => {
            const isCur = players[p]?.[0] === currentPlayer && days[d] === currentDay;
            return (
              <g key={k} onPointerEnter={() => setHover(k)} onClick={() => router.push(`${hrefBase}${encodeURIComponent(cells[k][3])}`)} style={{ cursor: "pointer" }}>
                <rect x={cx(d) - colW / 2} y={cy(p) - ROW / 2} width={colW} height={ROW} fill="transparent" />
                <circle cx={cx(d)} cy={cy(p)} r={r(n)} className={isCur ? "ewm__dot ewm__dot--cur" : "ewm__dot"} />
                {isCur && <circle cx={cx(d)} cy={cy(p)} r={r(n) + 4} className="ewo__ring" />}
                {hover === k && <circle cx={cx(d)} cy={cy(p)} r={r(n) + 3} className="ewo__hover" />}
              </g>
            );
          })}
        </svg>
      </div>
      {h && (
        <p className="muted" role="status" style={{ marginTop: 6 }}>
          <b>{players[h[0]][1]}</b> · {num(h[2])} {noun} am {longFmt.format(noon(days[h[1]]))} · Klick öffnet das erste davon
        </p>
      )}
    </div>
  );
}
