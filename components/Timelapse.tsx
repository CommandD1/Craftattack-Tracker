"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Timelapse as TimelapseData } from "@/lib/analytics";
import { headUrl, num } from "@/lib/format";

const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const SPEEDS = [
  { label: "1×", ms: 500 },
  { label: "3×", ms: 170 },
  { label: "8×", ms: 60 },
];

/**
 * Der Tag im Schnelldurchlauf. Köpfe: grün = auf dem Server, gelb gestreift = auf dem Server, aber AFK,
 * lila Ring = live auf Twitch (mit grünem/gelbem Kern: dabei auf dem Server; mit grauem Kern: nur Stream).
 */
export function Timelapse({ data }: { data: TimelapseData }) {
  const { frames, players } = data;
  const firstActive = Math.max(
    0,
    frames.findIndex((f) => f.online.length > 0),
  );
  const [i, setI] = useState(firstActive);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setI((cur) => {
        if (cur >= frames.length - 1) {
          setPlaying(false);
          return cur;
        }
        const next = cur + 1;
        const f = frames[next];
        if (f.messages.length) setLog((l) => [...f.messages.map((text) => ({ at: f.at, text })), ...l].slice(0, 8));
        return next;
      });
    }, SPEEDS[speed].ms);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, frames]);

  const f = frames[i];
  const online = useMemo(() => new Set(f?.online ?? []), [f]);
  const live = useMemo(() => new Set(f?.live ?? []), [f]);
  const afk = useMemo(() => new Set(f?.afk ?? []), [f]);
  const liveOnServer = f ? f.live.filter((k) => online.has(k)).length : 0;

  if (!frames.length) return <p className="st-online__empty">Für diesen Tag liegen keine Daten vor.</p>;

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (i >= frames.length - 1) {
      setI(0);
      setLog([]);
    }
    setPlaying(true);
  };

  return (
    <div className="zr">
      <div className="zr__bar">
        <span className="zr__clock num">{tf.format(new Date(f.at))}</span>
        <span className="tag" data-tone="grass">
          {num(f.online.length)} online
        </span>
        {f.afk.length > 0 && (
          <span className="tag" data-tone="gold" title="Auf dem Server, aber seit mindestens fünf Minuten keine Bewegung">
            {num(f.afk.length)} AFK
          </span>
        )}
        <span className="tag" data-tone="twitch" title="Live auf Twitch · davon auf dem Server">
          {num(f.live.length)} live{f.live.length > 0 ? ` · ${num(liveOnServer)} auf dem Server` : ""}
        </span>
        <span className="tag" data-tone="amethyst">
          {f.viewers !== null ? `${num(f.viewers)} Zuschauer` : "– Zuschauer"}
        </span>
        <span className="tag" data-tone="redstone">
          {f.deaths !== null ? `${num(f.deaths)} Tode` : "– Tode"}
        </span>
        <span className="zr__controls">
          <button type="button" className="btn btn--small" data-tone="gold" onClick={togglePlay} aria-pressed={playing}>
            {playing ? "❚❚ Pause" : i >= frames.length - 1 ? "↻ Nochmal" : "▶ Abspielen"}
          </button>
          <select className="zr__speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Geschwindigkeit">
            {SPEEDS.map((s, k) => (
              <option key={s.label} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <input
        className="zr__pos"
        type="range"
        min={0}
        max={frames.length - 1}
        value={i}
        aria-label="Uhrzeit"
        aria-valuetext={tf.format(new Date(f.at))}
        onChange={(e) => {
          setPlaying(false);
          setI(Number(e.target.value));
        }}
      />
      <div className="zr__axis num" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}</span>
        ))}
      </div>
      {players.length === 0 ? (
        <p className="st-online__empty">An diesem Tag war niemand online.</p>
      ) : (
        <>
          <ul className="legend zr__legend" aria-label="Legende">
            <li>
              <i style={{ background: "var(--grass)" }} /> auf dem Server
            </li>
            <li>
              <i className="legend__afk" /> auf dem Server, AFK
            </li>
            <li>
              <i className="zr__legend-live" /> live, auf dem Server
            </li>
            <li>
              <i className="zr__legend-live zr__legend-live--off" /> live, nicht auf dem Server
            </li>
          </ul>
          <ul className="zr__heads" aria-label="Spieler">
            {players.map((p, k) => {
              const isOn = online.has(k);
              const isLive = live.has(k);
              const isAfk = afk.has(k);
              const state = isLive && isOn ? (isAfk ? "live, auf dem Server, AFK" : "live, auf dem Server") : isLive ? "live, nicht auf dem Server" : isAfk ? "auf dem Server, AFK" : isOn ? "auf dem Server" : "";
              return (
                <li key={p.id} data-on={isOn ? "true" : undefined} data-afk={isAfk ? "true" : undefined} data-live={isLive ? "true" : undefined}>
                  <Link href={`/spieler/${encodeURIComponent(p.id)}`} title={`${p.name}${state ? ` · ${state}` : ""}`}>
                    <img src={headUrl(p.uuid, 40, p.id)} alt={p.name} width={40} height={40} loading="lazy" decoding="async" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ol className="zr__log" aria-live="polite" aria-label="Meldungen">
        {log.length === 0 && !playing && f.messages.length > 0
          ? f.messages.map((m, k) => (
              <li key={k}>
                <span className="num muted">{tf.format(new Date(f.at))}</span> {m}
              </li>
            ))
          : log.map((m, k) => (
              <li key={`${m.at}-${k}`}>
                <span className="num muted">{tf.format(new Date(m.at))}</span> {m.text}
              </li>
            ))}
      </ol>
    </div>
  );
}
