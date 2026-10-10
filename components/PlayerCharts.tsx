"use client";

import { useState } from "react";
import type { PlayerPoint } from "@/lib/types";
import { boardValue, num } from "@/lib/format";

type Key = Exclude<keyof PlayerPoint, "at" | "online">;

const SERIES: { key: Key; label: string; tone: string; format: (v: number) => string }[] = [
  { key: "viewers", label: "Zuschauer", tone: "twitch", format: num },
  { key: "playtimeSeconds", label: "Spielzeit", tone: "sky", format: (v) => boardValue("playtimeSeconds", v) },
  { key: "deaths", label: "Tode", tone: "redstone", format: num },
  { key: "diamonds", label: "Diamanten", tone: "diamond", format: num },
  { key: "blocksBroken", label: "Blöcke", tone: "gold", format: num },
  { key: "mobsKilled", label: "Mobs", tone: "grass", format: num },
  { key: "distance", label: "Strecke", tone: "pink", format: (v) => boardValue("distance", v) },
];

const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const df = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

function Chart({ points, k, label, tone, format }: { points: PlayerPoint[]; k: Key; label: string; tone: string; format: (v: number) => string }) {
  const data = points.filter((p) => p[k] !== null).map((p) => ({ t: Date.parse(p.at), v: p[k] as number }));
  const W = 320;
  const H = 90;
  const pad = 4;
  let body: React.ReactNode;
  if (data.length < 2) {
    body = <p className="chart__empty">{data.length === 0 ? "Noch keine Daten." : "Erst ein Messpunkt, Graph folgt."}</p>;
  } else {
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const max = Math.max(1, ...data.map((d) => d.v));
    const min = Math.min(...data.map((d) => d.v));
    const range = Math.max(1, max - min);
    const x = (t: number) => ((t - t0) / span) * W;
    const y = (v: number) => pad + (1 - (v - min) / range) * (H - pad * 2);
    // Zähler sind Treppen, Zuschauer eine Linie
    const step = k !== "viewers";
    let d = `M${x(data[0].t).toFixed(1)},${y(data[0].v).toFixed(1)}`;
    for (let i = 1; i < data.length; i++) {
      const px = x(data[i].t).toFixed(1);
      const py = y(data[i].v).toFixed(1);
      d += step ? ` H${px} V${py}` : ` L${px},${py}`;
    }
    const last = data[data.length - 1];
    body = (
      <>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`${label} im Zeitverlauf`} role="img">
          <line x1="0" x2={W} y1={pad} y2={pad} className="chart__grid" />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="chart__grid" />
          <path d={`${d} V${H} H0 Z`} className="spark__area" />
          <path d={d} className="spark__line" vectorEffect="non-scaling-stroke" />
          <circle cx={x(last.t)} cy={y(last.v)} r="4" className="spark__dot" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="chart__axis">
          <span>{span > 36e5 * 20 ? df.format(t0) : tf.format(t0)}</span>
          <span className="chart__max">max {format(max)}</span>
          <span>{tf.format(t1)}</span>
        </div>
      </>
    );
  }
  const current = data.length ? format(data[data.length - 1].v) : "–";
  return (
    <div className="box chart" data-tone={tone}>
      <div className="chart__head">
        <span className="eyebrow">{label}</span>
        <span className="num chart__val">{current}</span>
      </div>
      {body}
    </div>
  );
}

export function PlayerCharts({ points, name }: { points: PlayerPoint[]; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="charts">
      <button type="button" className="btn btn--small" data-tone={open ? "ink" : "gold"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Graphen ausblenden" : "Alle Zahlen als Graph"}
      </button>
      {open && (
        <div className="grid charts__grid" style={{ marginTop: 16 }}>
          {SERIES.map((s) => (
            <Chart key={s.key} points={points} k={s.key} label={s.label} tone={s.tone} format={s.format} />
          ))}
          <p className="muted" style={{ gridColumn: "1 / -1", fontSize: ".9375rem" }}>
            Messpunkte für {name}: {num(points.length)}. Aufgezeichnet wird, sobald sich ein Wert ändert, sonst alle 5 Minuten.
          </p>
        </div>
      )}
    </div>
  );
}
