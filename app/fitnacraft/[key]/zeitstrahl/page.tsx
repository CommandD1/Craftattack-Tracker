import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { DayPicker } from "@/components/DayPicker";
import { Timelapse } from "@/components/Timelapse";
import { GanttLiveSegment } from "@/components/GanttLiveSegment";
import { DayStackChart } from "@/components/ViewerCharts";
import { Head } from "@/components/Head";
import { nextBerlinMidnight } from "@/lib/berlin";
import type { Timelapse as TimelapseData, TimelapseFrame } from "@/lib/analytics";
import { fcBase, fcData, fcGate, who, type FcData } from "@/lib/fitnacraft";
import { duration, num, time } from "@/lib/format";
import { FcHead, fcPlayerHref } from "../../_components/FcNav";

export const metadata: Metadata = { title: "Zeitstrahl" };

const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const STATE_LABEL: Record<string, string> = { "1": "auf FitnaCraft", "2": "auf CraftAttack", "3": "live mit anderem Inhalt" };

/** Abschnitte gleichen Zustands aus der 5-Minuten-Spur eines Spielers im Bereich [from, to) */
function runs(d: FcData, id: string, from: number, to: number): { a: number; b: number; s: string }[] {
  const st = d.track.states[id];
  if (!st) return [];
  const out: { a: number; b: number; s: string }[] = [];
  const i0 = Math.max(0, Math.floor((from - d.track.start) / d.track.step));
  const i1 = Math.min(st.length, Math.ceil((to - d.track.start) / d.track.step));
  for (let i = i0; i < i1; i++) {
    const s = st[i];
    if (s === "0") continue;
    const a = Math.max(from, d.track.start + i * d.track.step);
    const b = Math.min(to, a + d.track.step);
    const last = out[out.length - 1];
    if (last && last.s === s && last.b >= a) last.b = b;
    else out.push({ a, b, s });
  }
  return out;
}

async function Timeline(props: PageProps<"/fitnacraft/[key]/zeitstrahl">) {
  const key = await fcGate(props.params);
  const sp = await props.searchParams;
  const d = await fcData();
  const base = fcBase(key);
  const fcDays = d.days.filter((x) => x.fcPlayers > 0).map((x) => x.day);
  const best = d.days.reduce((m, x) => (x.fcVh > m.fcVh ? x : m), d.days[0]).day;
  const day = typeof sp.tag === "string" && fcDays.includes(sp.tag) ? sp.tag : best;
  const from = nextBerlinMidnight(Date.parse(`${day}T12:00:00Z`) - 86_400_000);
  const to = nextBerlinMidnight(Date.parse(`${day}T12:00:00Z`));
  const span = to - from;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
  const edge = (a: number, b: number) => ((pct(a) + pct(b)) / 2 > 72 ? "right" : (pct(a) + pct(b)) / 2 < 18 ? "left" : undefined);
  const fmtSpan = (a: number, b: number) => `${time(new Date(a).toISOString())}–${time(new Date(b).toISOString())}`;

  const rows = d.players
    .map((p) => {
      const r = runs(d, p.id, from, to);
      const fcSec = r.filter((x) => x.s === "1").reduce((s, x) => s + (x.b - x.a) / 1000, 0);
      return { p, r, fcSec };
    })
    .filter((x) => x.fcSec > 0)
    .sort((a, b) => b.fcSec - a.fcSec);
  const total = rows.reduce((s, r) => s + r.fcSec, 0);

  // Zeitraffer: „online“ = auf FitnaCraft, Ring = live (auch woanders)
  const tlPlayers = rows.map((r) => ({ id: r.p.id, name: r.p.name, uuid: r.p.uuid }));
  const step = d.track.step;
  const frames: TimelapseFrame[] = [];
  const startEvents = d.feed.filter((f) => f.at >= from && f.at < to && (f.t === "start" || f.t === "end" || f.t === "raid"));
  for (let t = from; t < to; t += step) {
    const i = Math.floor((t - d.track.start) / step);
    const online: number[] = [];
    const live: number[] = [];
    rows.forEach((r, k) => {
      const s = d.track.states[r.p.id]?.[i] ?? "0";
      if (s === "1") online.push(k);
      if (s !== "0") live.push(k);
    });
    const bi = Math.floor((t - d.bins.start) / d.bins.step);
    const messages = startEvents
      .filter((f) => f.at >= t && f.at < t + step)
      .map((f) => ({
        player: who(d, f.p),
        killer: null,
        text: f.t === "start" ? "geht auf FitnaCraft live" : f.t === "end" ? `beendet FitnaCraft nach ${duration(f.n)}` : `raidet ${f.t === "raid" ? (f.toName ?? "?") : ""}`,
      }));
    frames.push({ at: t, online, live, afk: [], afkMobs: [], afkBlocks: [], deaths: null, viewers: d.bins.fc[bi] ?? null, messages });
  }
  const di = fcDays.indexOf(day);
  const lapse: TimelapseData = {
    nav: { day, prev: fcDays[di - 1] ?? null, next: fcDays[di + 1] ?? null, firstDay: fcDays[0], today: fcDays[fcDays.length - 1], from, to, dataFrom: null },
    stepMinutes: 5,
    players: tlPlayers,
    frames,
  };

  // Zuschauer je Streamer, gestapelt (die 7 größten einzeln, der Rest als „Andere“)
  const times = Array.from({ length: Math.round(span / step) }, (_, k) => from + k * step);
  const viewerSeries = rows.map((r) => {
    const values = times.map(() => 0);
    for (const s of d.sessions) {
      if (s.p !== r.p.id || s.b < from || s.a > to) continue;
      s.v.forEach((v, k) => {
        const idx = Math.floor((s.a + k * step - from) / step);
        if (idx >= 0 && idx < values.length) values[idx] = Math.max(values[idx], v);
      });
    }
    return { id: r.p.id, name: r.p.name, values };
  });
  viewerSeries.sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
  const top = viewerSeries.slice(0, 7);
  const rest = viewerSeries.slice(7);
  const stack = rest.length ? [...top, { id: "", name: "Andere", values: times.map((_, k) => rest.reduce((s, x) => s + x.values[k], 0)) }] : top;

  const hrefs = Object.fromEntries(fcDays.map((x) => [x, `${base}/zeitstrahl?tag=${x}`]));
  return (
    <>
      <FcHead k={key} d={d} tab="/zeitstrahl" title="Zeitstrahl">
        <p>Wer an einem Tag wann auf FitnaCraft war – im Zeitraffer, als Balken und als Zuschauerkurve.</p>
      </FcHead>
      <section className="block block--tight mig" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2 className="t-2">{dayLong.format(from + 12 * 3600_000)}</h2>
              <p className="muted num" style={{ marginTop: 8 }}>
                {num(rows.length)} Spieler · {duration(total)} auf FitnaCraft zusammen · Spitze {num(Math.max(0, ...frames.map((f) => f.online.length)))} gleichzeitig
              </p>
            </div>
            <DayPicker hrefs={hrefs} day={day} today={fcDays[fcDays.length - 1]} />
          </div>

          <div className="box" data-tone="white" style={{ marginBottom: 24 }}>
            <div className="stat-card__head">
              <h3 className="t-3">Zeitraffer</h3>
              <p className="muted">Alle fünf Minuten ein Bild. Hell = auf FitnaCraft, lila Ring = live auf Twitch (blasser Kopf: gerade woanders).</p>
            </div>
            <Timelapse data={lapse} />
          </div>

          <div className="box" data-tone="white" id="balken" style={{ marginBottom: 24 }}>
            <div className="stat-card__head">
              <h3 className="t-3">Wer war wann da</h3>
              <p className="muted">Ein Klick auf den lila Balken öffnet das VOD an dieser Stelle (solange es noch existiert).</p>
            </div>
            <ul className="legend" style={{ marginBottom: 12 }}>
              <li>
                <i style={{ background: "var(--presence)" }} /> auf FitnaCraft
              </li>
              <li>
                <i style={{ background: "var(--mig-c2)" }} /> auf CraftAttack
              </li>
              <li>
                <i style={{ background: "var(--twitch)" }} /> live auf Twitch
              </li>
            </ul>
            <div className="gantt" role="table" aria-label="FitnaCraft-Zeiten pro Spieler">
              <div className="gantt__row gantt__head" role="row">
                <span />
                <div className="gantt__axis num" aria-hidden="true">
                  {HOURS.map((h) => (
                    <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <span className="gantt__sum muted">FitnaCraft</span>
              </div>
              {rows.map(({ p, r, fcSec }) => {
                const liveRuns: { a: number; b: number }[] = [];
                for (const x of r) {
                  const last = liveRuns[liveRuns.length - 1];
                  if (last && last.b >= x.a) last.b = x.b;
                  else liveRuns.push({ a: x.a, b: x.b });
                }
                return (
                  <div className="gantt__row" role="row" key={p.id}>
                    <Link className="gantt__name" href={fcPlayerHref(key, p.id)} role="rowheader">
                      <Head id={p.id} uuid={p.uuid} name={p.name} size={24} decorative />
                      <span>{p.name}</span>
                    </Link>
                    <div className="gantt__track" role="cell">
                      {r
                        .filter((x) => x.s === "1" || x.s === "2")
                        .map((x, k) => (
                          <span
                            key={`o${k}`}
                            className={`gantt__on tip${x.s === "2" ? " fc-ca" : ""}`}
                            style={{ left: `${pct(x.a)}%`, width: `${Math.max(0.3, pct(x.b) - pct(x.a))}%` }}
                            data-edge={edge(x.a, x.b)}
                            data-tip={`${p.name} · ${STATE_LABEL[x.s]} ${fmtSpan(x.a, x.b)} · ${duration((x.b - x.a) / 1000)}`}
                            tabIndex={0}
                          />
                        ))}
                      {liveRuns.map((x, k) => {
                        const s = d.sessions.find((s) => s.p === p.id && s.vodId && s.a <= x.b && x.a <= s.b);
                        const offset = s && s.vodOffset !== null ? s.vodOffset + Math.round((x.a - s.a) / 1000) : null;
                        return (
                          <GanttLiveSegment
                            key={`l${k}`}
                            vodId={s && offset !== null && offset >= 0 ? s.vodId : null}
                            startOffset={offset !== null && offset >= 0 ? offset : null}
                            start={x.a}
                            end={x.b}
                            style={{ left: `${pct(x.a)}%`, width: `${Math.max(0.3, pct(x.b) - pct(x.a))}%` }}
                            edge={edge(x.a, x.b)}
                            tip={`${p.name} · live ${fmtSpan(x.a, x.b)} · ${duration((x.b - x.a) / 1000)}`}
                          />
                        );
                      })}
                    </div>
                    <span className="gantt__sum num" role="cell">
                      {duration(fcSec)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="box" data-tone="white">
            <div className="stat-card__head">
              <h3 className="t-3">Zuschauer auf FitnaCraft</h3>
              <p className="muted">Höchste Zuschauerzahl je 5 Minuten, gestapelt nach Streamer.</p>
            </div>
            <DayStackChart times={times} covered={times.map(() => true)} series={stack} />
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/zeitstrahl">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Zeitstrahl" />}>
      <Timeline {...props} />
    </Suspense>
  );
}
