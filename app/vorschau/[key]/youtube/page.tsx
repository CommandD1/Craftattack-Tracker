import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { Head } from "@/components/Head";
import { loadTracker } from "@/lib/data";
import { num } from "@/lib/format";
import { previewGate } from "@/lib/preview";
import { getYoutubeInsights, type YtDay } from "@/lib/youtubeInsights";
import "./youtube.css";

export const metadata: Metadata = { title: "YouTube" };

const DEATH_DAY = "2026-11-01";
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
const short = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const long = (d: string) => dayLong.format(new Date(`${d}T12:00:00Z`));
const h = (s: number) => `${(s / 3600).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: s > 0 && s < 36_000 ? 1 : 0 })} h`;
const factor = (f: number) => `×${f.toLocaleString("de-DE", { maximumFractionDigits: f >= 10 ? 0 : 1, minimumFractionDigits: f >= 10 ? 0 : 1 })}`;

/** Tagesverlauf: Uploads gestapelt (Balken), Twitch-Zuschauer Ø und Spieler online (Linien, je eigene Skala) */
function DayChart({ days }: { days: YtDay[] }) {
  const W = 1000;
  const H = 300;
  const top = 16;
  const bottom = 28;
  const ch = H - top - bottom;
  const n = days.length;
  const bw = W / n;
  const maxUp = Math.max(1, ...days.map((d) => d.video + d.short + d.livestream));
  const maxView = Math.max(1, ...days.map((d) => d.viewersAvg ?? 0));
  const maxOn = Math.max(1, ...days.map((d) => d.onlineMax ?? 0));
  const y = (v: number, max: number) => top + ch - (v / (max * 1.05)) * ch;
  const line = (get: (d: YtDay) => number | null, max: number) =>
    days
      .map((d, i) => ({ v: get(d), x: i * bw + bw / 2 }))
      .filter((p) => p.v !== null)
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${y(p.v!, max).toFixed(1)}`)
      .join("");
  const death = days.findIndex((d) => d.day === DEATH_DAY);
  return (
    <figure className="yt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CraftAttack-Uploads auf YouTube pro Tag neben Twitch-Zuschauern und Spielern online">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} className="yt-chart__grid" x1={0} x2={W} y1={y(maxUp * f, maxUp)} y2={y(maxUp * f, maxUp)} />
        ))}
        {days.map((d, i) => {
          const x = i * bw + bw * 0.15;
          const w = bw * 0.7;
          let acc = 0;
          const seg = (v: number, cls: string) => {
            if (!v) return null;
            const y0 = y(acc + v, maxUp);
            const y1 = y(acc, maxUp);
            acc += v;
            return <rect key={cls} className={cls} x={x} y={y0} width={w} height={Math.max(0, y1 - y0)} />;
          };
          return (
            <g key={d.day}>
              <title>{`${long(d.day)}: ${d.video} Videos, ${d.short} Shorts, ${d.livestream} Livestreams · ${num(d.views)} Aufrufe · Twitch Ø ${num(d.viewersAvg ?? 0)} Zuschauer · bis ${num(d.onlineMax ?? 0)} Spieler online`}</title>
              {seg(d.video, "yt-chart__video")}
              {seg(d.short, "yt-chart__short")}
              {seg(d.livestream, "yt-chart__live")}
              <rect x={i * bw} y={top} width={bw} height={ch} fill="transparent" />
            </g>
          );
        })}
        <path className="yt-chart__viewers" d={line((d) => d.viewersAvg, maxView)} />
        <path className="yt-chart__online" d={line((d) => d.onlineMax, maxOn)} />
        {death >= 0 && (
          <g>
            <line className="yt-chart__death" x1={death * bw} x2={death * bw} y1={top} y2={top + ch} />
            <text className="yt-chart__label" x={death * bw + 6} y={top + 12}>
              Todestag 1.11.
            </text>
          </g>
        )}
        {days.map((d, i) =>
          i % 7 === 0 ? (
            <text key={d.day} className="yt-chart__axis" x={i * bw + bw / 2} y={H - 8} textAnchor="middle">
              {short(d.day)}
            </text>
          ) : null,
        )}
        <text className="yt-chart__axis" x={4} y={y(maxUp, maxUp) - 4}>
          {num(maxUp)} Uploads
        </text>
      </svg>
      <figcaption className="yt-legend">
        <span><i className="yt-chart__video" /> Videos</span>
        <span><i className="yt-chart__short" /> Shorts</span>
        <span><i className="yt-chart__live" /> YouTube-Livestreams</span>
        <span><i className="yt-legend__line yt-legend__line--viewers" /> Twitch-Zuschauer Ø (eigene Skala, max. {num(maxView)})</span>
        <span><i className="yt-legend__line yt-legend__line--online" /> Spieler online, Tageshöchstwert (eigene Skala, max. {num(maxOn)})</span>
      </figcaption>
    </figure>
  );
}

async function Inner(props: PageProps<"/vorschau/[key]/youtube">) {
  await previewGate(props.params);
  const [ins, { state }] = await Promise.all([getYoutubeInsights(), loadTracker()]);
  const name = (id: string) => state.players[id]?.name ?? id;
  const who = (id: string) => (
    <Link className="yt-who" href={`/spieler/${encodeURIComponent(id)}`}>
      <Head id={id} uuid={state.players[id]?.uuid} name={name(id)} size={24} decorative /> <span>{name(id)}</span>
    </Link>
  );
  const season = ins.days.filter((d) => d.day >= "2026-10-10");
  const before = season.filter((d) => d.day < DEATH_DAY);
  const after = season.filter((d) => d.day >= DEATH_DAY);
  const per = (a: YtDay[]) => (a.length ? a.reduce((s, d) => s + d.video + d.short + d.livestream, 0) / a.length : 0);
  const peak = [...season].sort((a, b) => b.video + b.short + b.livestream - (a.video + a.short + a.livestream))[0];
  const medianBonus = ins.bonus.length ? [...ins.bonus].sort((a, b) => a.factor - b.factor)[Math.floor(ins.bonus.length / 2)].factor : null;
  const ytOnly = ins.live.filter((r) => r.youtubeOnlyS > 0);
  // Alle, die auf YouTube live waren, nach YouTube-Zeit; Twitch daneben
  const liveTop = ins.live.filter((r) => r.youtubeS > 0).sort((a, b) => b.youtubeS - a.youtubeS);
  const maxLive = Math.max(1, ...liveTop.map((r) => r.twitchS + r.youtubeOnlyS));
  const twitchAll = ins.live.reduce((s, r) => s + r.twitchS, 0);

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Vorschau · YouTube</p>
          <h1 className="t-1">YouTube</h1>
          <p>
            Was die Teilnehmer zu CraftAttack 14 auf YouTube hochgeladen haben, neben Twitch und dem Server. Nur Kanäle, die die Teilnehmer selbst verlinken; Zahlen
            von der offiziellen YouTube-Schnittstelle, alle 6 Stunden aktualisiert.
          </p>
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="yt-verlauf">
        <div className="wrap">
          <h2 className="t-2" id="yt-verlauf">
            YouTube neben Twitch
          </h2>
          <p className="yt-lead">
            Bis zum 31.10. kamen im Schnitt <strong>{per(before).toLocaleString("de-DE", { maximumFractionDigits: 1 })}</strong> CraftAttack-Uploads am Tag, ab dem
            Todestag noch <strong>{per(after).toLocaleString("de-DE", { maximumFractionDigits: 1 })}</strong>
            {peak ? (
              <>
                {" "}
                · am meisten am {long(peak.day)} ({num(peak.video + peak.short + peak.livestream)})
              </>
            ) : null}
            .
          </p>
          <DayChart days={ins.days} />
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="yt-bonus">
        <div className="wrap">
          <h2 className="t-2" id="yt-bonus">
            Hat sich CraftAttack auf YouTube gelohnt?
          </h2>
          <p className="yt-lead">
            Typische Aufrufe (Median) der CraftAttack-Videos gegen die übrigen Videos desselben Creators seit Staffelbeginn, nur normale Videos (keine Shorts und
            Livestreams), mindestens fünf je Seite.
            {medianBonus !== null && <> Im Mittel holte CraftAttack {factor(medianBonus)} so viele Aufrufe.</>}
          </p>
          <div className="yt-scroll">
            <table className="yt-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th className="yt-num">CraftAttack</th>
                  <th className="yt-num">Andere</th>
                  <th className="yt-num">Faktor</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {ins.bonus.map((r) => (
                  <tr key={r.player}>
                    <td>{who(r.player)}</td>
                    <td className="yt-num">
                      {num(Math.round(r.caMedian))} <small>({r.ca} Videos)</small>
                    </td>
                    <td className="yt-num">
                      {num(Math.round(r.otherMedian))} <small>({r.other})</small>
                    </td>
                    <td className="yt-num">
                      <strong data-up={r.factor >= 1 ? "" : undefined}>{factor(r.factor)}</strong>
                    </td>
                    <td className="yt-factor">
                      {/* Log-Skala um 1: links weniger, rechts mehr als die anderen Videos */}
                      {(() => {
                        const f = Math.max(-1, Math.min(1, Math.log10(r.factor) / 1.3));
                        return (
                          <span>
                            <i style={{ left: `${50 + Math.min(0, f) * 50}%`, width: `${Math.abs(f) * 50}%` }} data-up={f >= 0 ? "" : undefined} />
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="yt-live">
        <div className="wrap">
          <h2 className="t-2" id="yt-live">
            Live-Zeit auf beiden Plattformen
          </h2>
          <p className="yt-lead">
            {num(liveTop.length)} Spieler waren seit Staffelbeginn auch auf YouTube live, {num(ytOnly.length)} davon zeitweise nur dort, zusammen{" "}
            {h(ytOnly.reduce((s, r) => s + r.youtubeOnlyS, 0))} ohne gleichzeitigen Twitch-Stream. Zum Vergleich: alle Spieler zusammen {h(twitchAll)} auf Twitch (laut
            Tracker). Nur Livestreams, die auf YouTube als Video geblieben sind.
          </p>
          <div className="yt-scroll">
            <table className="yt-table">
              <thead>
                <tr>
                  <th>Spieler</th>
                  <th className="yt-num">Twitch</th>
                  <th className="yt-num">YouTube</th>
                  <th className="yt-num">nur YouTube</th>
                  <th className="yt-num">Gesamt</th>
                  <th className="yt-num">Anteil nur YouTube</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {liveTop.map((r) => (
                  <tr key={r.player} data-yt={r.youtubeOnlyS > 0 ? "" : undefined}>
                    <td>{who(r.player)}</td>
                    <td className="yt-num">{h(r.twitchS)}</td>
                    <td className="yt-num">{r.youtubeS > 0 ? `${h(r.youtubeS)} · ${r.youtubeStreams}×` : "–"}</td>
                    <td className="yt-num">{r.youtubeOnlyS > 0 ? h(r.youtubeOnlyS) : "–"}</td>
                    <td className="yt-num">
                      <strong>{h(r.twitchS + r.youtubeOnlyS)}</strong>
                    </td>
                    <td className="yt-num">{r.twitchS + r.youtubeOnlyS > 0 ? `${Math.round((r.youtubeOnlyS / (r.twitchS + r.youtubeOnlyS)) * 100)} %` : "–"}</td>
                    <td className="yt-stack">
                      <span className="yt-stack__tw" style={{ width: `${(r.twitchS / maxLive) * 100}%` }} />
                      <span className="yt-stack__yt" style={{ width: `${(r.youtubeOnlyS / maxLive) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="yt-lead">
            <i className="yt-key yt-key--tw" /> Twitch <i className="yt-key yt-key--yt" /> nur YouTube
          </p>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/youtube">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="YouTube" />}>
      <Inner {...props} />
    </Suspense>
  );
}
