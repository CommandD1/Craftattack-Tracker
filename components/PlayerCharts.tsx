"use client";

import { useState } from "react";
import type { PlayerPoint } from "@/lib/types";
import { boardValue, num } from "@/lib/format";
import { Sparkline } from "./Sparkline";

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

/** Vom Tracker gemessene Online-Zeit als Verlauf: Zeit zwischen zwei Messpunkten zählt, wenn der Spieler beim ersten online war. */
function trackedSeries(points: PlayerPoint[]) {
  const out: { at: string; v: number }[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i - 1].online) acc += (Date.parse(points[i].at) - Date.parse(points[i - 1].at)) / 1000;
    out.push({ at: points[i].at, v: Math.round(acc) });
  }
  return out;
}

function Chart({ points, k, label, tone, format }: { points: PlayerPoint[]; k: Key; label: string; tone: string; format: (v: number) => string }) {
  let data = points.filter((p) => p[k] !== null).map((p) => ({ at: p.at, v: p[k] as number }));
  // Spielzeit gibt es von der API nur für die Top 10 – sonst die Tracker-Online-Zeit zeigen
  const fromTracker = k === "playtimeSeconds" && data.length < 2 && points.length >= 2;
  if (fromTracker) data = trackedSeries(points);
  const current = data.length ? format(data[data.length - 1].v) : "–";
  let body: React.ReactNode;
  if (data.length < 2) {
    body = <p className="chart__empty">{data.length === 0 ? "Noch keine Daten." : "Erst ein Messpunkt, Graph folgt."}</p>;
  } else {
    const t0 = Date.parse(data[0].at);
    const t1 = Date.parse(data[data.length - 1].at);
    const max = Math.max(...data.map((d) => d.v));
    body = (
      <>
        <Sparkline points={data} width={320} height={90} format={format} step={k !== "viewers"} label={label} />
        <div className="chart__axis">
          <span>{t1 - t0 > 36e5 * 20 ? df.format(t0) : tf.format(t0)}</span>
          <span className="chart__max">max {format(max)}</span>
          <span>{tf.format(t1)}</span>
        </div>
      </>
    );
  }
  return (
    <div className="box chart" data-tone={tone}>
      <div className="chart__head">
        <span className="eyebrow">
          {label}
          {fromTracker && <span className="muted"> · Tracker</span>}
        </span>
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
            Messpunkte für {name}: {num(points.length)}. Aufgezeichnet wird, sobald sich ein Wert ändert, sonst alle 5 Minuten. Mit der Maus über
            die Kurve fahren zeigt Zeitpunkt und Wert.
          </p>
        </div>
      )}
    </div>
  );
}
