import type { StoredSession } from "@/lib/store";
import type { RankHistory, RankKey, Span } from "@/lib/analytics";
import { RANK_KEYS } from "@/lib/analytics";
import { duration, num } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { BOARD_ICON, Icon } from "./Icons";
import { EXTRA_HISTORY_KEYS, EXTRA_STATS, STAT_GROUPS } from "@/lib/playerStats";

const LABEL: Record<RankKey, string> = { deaths: "Friedhof", diamonds: "Diamantenbank", blocksBroken: "Abrissbirne", mobsKilled: "Monsterjäger", distance: "Weltenbummler" };
const TONE: Record<RankKey, string> = { deaths: "redstone", diamonds: "diamond", blocksBroken: "gold", mobsKilled: "grass", distance: "pink" };
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Wochentag (0 = Montag) und Stunde in Berlin für einen Zeitpunkt */
const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short", hour: "numeric", hourCycle: "h23" });
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function cellOf(ms: number): [number, number] {
  const parts = partsFmt.formatToParts(new Date(ms));
  const d = DOW[parts.find((p) => p.type === "weekday")?.value ?? "Mon"] ?? 0;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return [d, h];
}

/** Online-Minuten je Wochentag × Stunde aus Zeitspannen (in 10-Minuten-Schritten abgetastet) */
function heat(spans: { start: string | number; end: string | number | null }[], now: number): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const STEP = 10 * 60_000;
  for (const s of spans) {
    const a = typeof s.start === "number" ? s.start : Date.parse(s.start);
    const b = s.end === null ? now : typeof s.end === "number" ? s.end : Date.parse(s.end);
    for (let t = a; t < b; t += STEP) {
      const [d, h] = cellOf(t);
      grid[d][h] += Math.min(STEP, b - t) / 60_000;
    }
  }
  return grid;
}

export function PlayerActivity({
  id,
  sessions,
  afk,
  ranks,
  now,
}: {
  id: string;
  /** Nur die Sessions dieses Spielers */
  sessions: StoredSession[];
  /** AFK-Phasen dieses Spielers (Teil der Sessions) */
  afk: Span[];
  ranks: RankHistory;
  now: number;
}) {
  const afkGrid = heat(afk.map(([a, b]) => ({ start: a, end: b })), now);
  const afkTotal = afkGrid.flat().reduce((s, v) => s + v, 0);
  /* ---- Rang-Verlauf ---- */
  const mine = ranks.players[id];
  const rankCharts = RANK_KEYS.map((k) => {
    const series = mine?.[k] ?? [];
    const points = ranks.buckets.map((at, i) => ({ at: new Date(at).toISOString(), v: series[i] ?? null })).filter((p): p is { at: string; v: number } => p.v !== null);
    const best = points.length ? Math.min(...points.map((p) => p.v)) : null;
    const worst = points.length ? Math.max(...points.map((p) => p.v)) : null;
    const nowRank = points.length ? points[points.length - 1].v : null;
    return { k, points, best, worst, nowRank };
  });
  const hasRanks = rankCharts.some((c) => c.points.length >= 2);
  // Zusatzwerte: kompakt als Tabelle nach Rubriken, standardmäßig eingeklappt
  const mineExtra = ranks.extra?.[id] ?? {};
  const extraCharts = EXTRA_HISTORY_KEYS.map((k) => {
    const series = mineExtra[k] ?? [];
    const points = ranks.buckets.map((at, i) => ({ at: new Date(at).toISOString(), v: series[i] ?? null })).filter((p): p is { at: string; v: number } => p.v !== null);
    return { k, points, best: points.length ? Math.min(...points.map((p) => p.v)) : null, nowRank: points.length ? points[points.length - 1].v : null };
  }).filter((c) => c.points.length > 0);
  const extraGroups = STAT_GROUPS.map((g) => ({ ...g, charts: extraCharts.filter((c) => EXTRA_STATS[c.k].group === g.key) })).filter((g) => g.charts.length > 0);

  /* ---- Heatmap ---- */
  const grid = heat(sessions, now);
  const max = Math.max(1, ...grid.flat());
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0));
  const byDay = grid.map((row) => row.reduce((s, v) => s + v, 0));
  const total = byDay.reduce((s, v) => s + v, 0);
  // Typische Spielzeit: zusammenhängender Stundenblock, der ~60 % der Online-Zeit enthält (kleinster Block)
  let typical: [number, number] | null = null;
  if (total > 0) {
    let bestLen = 25;
    for (let start = 0; start < 24; start++) {
      let acc = 0;
      for (let len = 1; len <= 24; len++) {
        acc += byHour[(start + len - 1) % 24];
        if (acc >= total * 0.6) {
          if (len < bestLen) {
            bestLen = len;
            typical = [start, (start + len) % 24];
          }
          break;
        }
      }
    }
  }
  const topDay = total > 0 ? byDay.indexOf(Math.max(...byDay)) : null;

  return (
    <section className="block block--tight" data-tone="paper" aria-labelledby="act-h">
      <div className="wrap">
        <h2 className="sr-only" id="act-h">
          Rang-Verlauf und Aktivität
        </h2>
        <div className="grid" style={{ "--min": "300px", "--gap": "24px" } as React.CSSProperties}>
          {/* Rang-Verlauf */}
          <div className="box" data-tone="white" style={{ gridColumn: "span 2" }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              Rang-Verlauf
            </p>
            <p className="muted" style={{ fontSize: ".875rem", marginBottom: 12 }}>
              Platz unter allen vom Tracker erfassten Spielern, alle {ranks.bucketMinutes >= 60 ? `${Math.round(ranks.bucketMinutes / 60)} Std` : `${ranks.bucketMinutes} Min`} neu berechnet. Oben ist besser.
            </p>
            {!hasRanks ? (
              <p className="muted">Noch zu wenig Verlauf.</p>
            ) : (
              <div className="rankgrid">
                {rankCharts.map((c) => {
                  const IconCmp = Icon[BOARD_ICON[c.k]];
                  return (
                    <div key={c.k} className="rankcard" data-tone={TONE[c.k]}>
                      <div className="rankcard__head">
                        <span className="rankcard__icon">
                          <IconCmp aria-hidden="true" />
                        </span>
                        <span className="rankcard__label">{LABEL[c.k]}</span>
                        <span className="rankcard__now num">{c.nowRank === null ? "–" : `#${c.nowRank}`}</span>
                      </div>
                      {c.points.length >= 2 ? <Sparkline points={c.points} width={320} height={56} kind="rank" invert label={`Platz ${LABEL[c.k]}`} /> : <p className="muted">–</p>}
                      <p className="rankcard__foot num">
                        {c.best !== null && c.worst !== null ? (
                          <>
                            Bester #{c.best} · Schlechtester #{c.worst}
                          </>
                        ) : (
                          "–"
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            {extraGroups.length > 0 && (
              <details className="rankmore">
                <summary>
                  Weitere Ränge <span className="muted num">({extraCharts.length})</span>
                </summary>
                <div className="rankmore__body">
                  {extraGroups.map((g) => (
                    <div key={g.key} className="rankmore__group">
                      <p className="rankmore__label">{g.label}</p>
                      <ul className="rankmore__rows">
                        {g.charts.map((c) => (
                          <li key={c.k} className="rankmore__row">
                            <span className="rankmore__name">{EXTRA_STATS[c.k].label}</span>
                            <span className="rankmore__spark">
                              {c.points.length >= 2 ? <Sparkline points={c.points} width={160} height={28} kind="rank" invert label={`Platz ${EXTRA_STATS[c.k].label}`} /> : <span className="muted">–</span>}
                            </span>
                            <span className="rankmore__now num" data-top={c.nowRank !== null && c.nowRank <= 3 ? "true" : undefined}>
                              {c.nowRank === null ? "–" : `#${c.nowRank}`}
                            </span>
                            <span className="rankmore__best muted num">{c.best === null ? "" : `bester #${c.best}`}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Heatmap */}
          <div className="box" data-tone="white">
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              Wann online
            </p>
            {total === 0 ? (
              <p className="muted" style={{ fontSize: ".875rem" }}>
                Noch keine Online-Zeit gemessen.
              </p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: ".875rem", marginBottom: 12 }}>
                  {typical ? `Meist zwischen ${typical[0]} und ${typical[1] === 0 ? 24 : typical[1]} Uhr` : ""}
                  {topDay !== null ? `, stärkster Tag ${DAYS[topDay]}` : ""}. Insgesamt {duration(total * 60)} seit Tracker-Start
                  {afkTotal > 0 ? `, davon ${duration(afkTotal * 60)} AFK` : ""}. Je gelber ein Feld, desto größer der AFK-Anteil.
                </p>
                <div className="heat" role="img" aria-label="Online-Zeit nach Wochentag und Uhrzeit">
                  <span />
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="heat__h">
                      {h % 6 === 0 ? h : ""}
                    </span>
                  ))}
                  {grid.map((row, d) => (
                    <div key={d} className="heat__row">
                      <span className="heat__d">{DAYS[d]}</span>
                      {row.map((v, h) => {
                        const afkMin = Math.min(v, afkGrid[d][h]);
                        const share = v > 0 ? afkMin / v : 0;
                        return (
                          <span
                            key={h}
                            className="heat__c tip"
                            style={{ "--a": v > 0 ? 0.15 + 0.85 * (v / max) : 0, "--afk": share } as React.CSSProperties}
                            data-tip={`${DAYS[d]} ${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} Uhr · ${v > 0 ? `${num(Math.round(v))} Min online${afkMin >= 1 ? ` · davon ${num(Math.round(afkMin))} Min AFK` : ""}` : "nie"}`}
                            tabIndex={0}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
