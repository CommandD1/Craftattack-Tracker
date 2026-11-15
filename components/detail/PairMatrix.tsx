"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { headUrl, num } from "@/lib/format";

/**
 * „Wer → wen“ bei Ereignissen mit zwei Spielern: Zeilen = Gebende (schreiben, raiden, schenken, töten), Spalten =
 * Bekommende, Kreisfläche = Anzahl. Rechts die Summe je Gebendem, unten je Bekommendem. Das Paar dieses Ereignisses
 * mit Ring, die Gegenrichtung gestrichelt. Klick öffnet das neueste Ereignis des Paars.
 */
const N = 14;

export function PairMatrix({
  matrix,
  names,
  giver,
  receiver,
  hrefBase,
  noun,
}: {
  /** [Gebender, Bekommender, Anzahl, neuestes Ereignis] */
  matrix: [string, string, number, string][];
  /** id → [Name, UUID] */
  names: Record<string, [string, string]>;
  giver: string;
  receiver: string;
  hrefBase: string;
  noun: string;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const { rows, cols, cell, rowSum, colSum, max } = useMemo(() => {
    const rowSum = new Map<string, number>();
    const colSum = new Map<string, number>();
    for (const [g, r, n] of matrix) {
      rowSum.set(g, (rowSum.get(g) ?? 0) + n);
      colSum.set(r, (colSum.get(r) ?? 0) + n);
    }
    const top = (m: Map<string, number>, must: string[]) => {
      const list = [...m.keys()].sort((a, b) => m.get(b)! - m.get(a)!).slice(0, N);
      for (const x of must) if (m.has(x) && !list.includes(x)) list.push(x);
      return list;
    };
    const rows = top(rowSum, [giver, receiver]);
    const cols = top(colSum, [receiver, giver]);
    const cell = new Map(matrix.map(([g, r, n, last]) => [`${g}|${r}`, { n, last }]));
    let max = 1;
    for (const g of rows) for (const r of cols) max = Math.max(max, cell.get(`${g}|${r}`)?.n ?? 0);
    return { rows, cols, cell, rowSum, colSum, max };
  }, [matrix, giver, receiver]);
  const C = 30;
  const L = 150;
  const T = 34;
  const W = L + cols.length * C + 70;
  const H = T + rows.length * C + 34;
  const x = (i: number) => L + i * C + C / 2;
  const y = (i: number) => T + i * C + C / 2;
  const rad = (n: number) => 2.5 + Math.sqrt(n / max) * (C / 2 - 3);
  const name = (id: string) => names[id]?.[0] ?? id;
  const h = hover ? hover.split("|") : null;
  const hc = hover ? cell.get(hover) : null;
  return (
    <div className="ewc">
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", minWidth: Math.min(W, 520) }} role="img" aria-label={`${noun}: wer an wen`} onPointerLeave={() => setHover(null)}>
          <text x={L - 8} y={T - 14} textAnchor="end" className="ewc__tick">
            von ↓ · an →
          </text>
          {cols.map((r, i) => (
            <g key={r}>
              <title>{name(r)}</title>
              <image href={headUrl(names[r]?.[1] || undefined, 32, r)} x={x(i) - 9} y={T - 26} width={18} height={18} className="ewo__head" />
              {r === receiver && <rect x={x(i) - C / 2} y={T} width={C} height={rows.length * C} className="ewp__col" />}
              <text x={x(i)} y={T + rows.length * C + 16} textAnchor="middle" className="ewc__tick">
                {num(colSum.get(r) ?? 0)}
              </text>
            </g>
          ))}
          <text x={L - 8} y={T + rows.length * C + 16} textAnchor="end" className="ewc__tick">
            bekommen
          </text>
          <text x={L + cols.length * C + 10} y={T - 14} className="ewc__tick">
            gegeben
          </text>
          {rows.map((g, j) => (
            <g key={g}>
              {g === giver && <rect x={0} y={T + j * C} width={L + cols.length * C} height={C} className="ewp__row" />}
              <image href={headUrl(names[g]?.[1] || undefined, 32, g)} x={4} y={y(j) - 8} width={16} height={16} className="ewo__head" />
              <text x={26} y={y(j) + 4} className={g === giver || g === receiver ? "ewm__name ewm__name--cur" : "ewm__name"}>
                {name(g).length > 15 ? `${name(g).slice(0, 14)}…` : name(g)}
              </text>
              <text x={L + cols.length * C + 10} y={y(j) + 4} className="ewc__tick">
                {num(rowSum.get(g) ?? 0)}
              </text>
              {cols.map((r, i) => {
                const k = `${g}|${r}`;
                const c = cell.get(k);
                if (!c || g === r) return null;
                const isCur = g === giver && r === receiver;
                const isRev = g === receiver && r === giver;
                return (
                  <g key={k} onPointerEnter={() => setHover(k)} onClick={() => router.push(`${hrefBase}${encodeURIComponent(c.last)}`)} style={{ cursor: "pointer" }}>
                    <rect x={x(i) - C / 2} y={y(j) - C / 2} width={C} height={C} fill="transparent" />
                    <circle cx={x(i)} cy={y(j)} r={rad(c.n)} className={isCur ? "ewm__dot ewm__dot--cur" : "ewm__dot"} />
                    {isCur && <circle cx={x(i)} cy={y(j)} r={rad(c.n) + 4} className="ewo__ring" />}
                    {isRev && <circle cx={x(i)} cy={y(j)} r={rad(c.n) + 4} className="ewo__ring ewp__rev" />}
                    {hover === k && <circle cx={x(i)} cy={y(j)} r={rad(c.n) + 3} className="ewo__hover" />}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <p className="muted" role="status" style={{ marginTop: 6, minHeight: "1.4em" }}>
        {h && hc ? (
          <>
            <b>{name(h[0])}</b> → <b>{name(h[1])}</b>: {num(hc.n)} {noun} · Klick öffnet das neueste
          </>
        ) : (
          "Überfahren zeigt das Paar, Klick öffnet das neueste Ereignis der beiden."
        )}
      </p>
    </div>
  );
}
