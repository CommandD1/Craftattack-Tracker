"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLORS,
  MAX_METRICS,
  METRICS,
  METRIC_KEYS,
  RANGES,
  RANK_KEYS,
  RASTER,
  itemMetric,
  metaOf,
  parseItemMetric,
  rankMetric,
  rankOfMetric,
  toSearch,
  valueOfRank,
  type GraphQuery,
  type ItemOptions,
  type Metric,
  type MetricMeta,
  type PlayerOption,
} from "@/lib/graphQuery";
import { LEADERBOARDS, type TopCategory } from "@/lib/leaderboards";
import { STAT_GROUPS } from "@/lib/playerStats";
import { Head } from "./Head";
import { ItemPicker } from "./ItemPicker";

/** Reiter der Kennzahl-Auswahl: Server, die Spieler-Rubriken, Ränge und einzelne Blöcke/Mobs */
const PICKER_TABS = [{ key: "server", label: "Server" }, ...STAT_GROUPS, { key: "rang", label: "Ränge" }, { key: "einzeln", label: "Einzeln" }] as const;
type PickerTab = (typeof PICKER_TABS)[number]["key"];

/** `datetime-local`-Wert (lokale Zeit des Browsers) → Millisekunden */
const localMs = (s: string) => (s ? Date.parse(s) : NaN);

/** Zeitraum-Parameter der API aus der Auswahl */
function rangeParams(q: Pick<GraphQuery, "zeit" | "von" | "bis" | "raster">, now: number, p: URLSearchParams) {
  const r = RANGES.find((x) => x.key === q.zeit);
  if (q.zeit === "eigen") {
    const a = localMs(q.von);
    const b = localMs(q.bis);
    if (Number.isFinite(a)) p.set("von", String(a));
    if (Number.isFinite(b)) p.set("bis", String(b));
  } else if (r?.ms) {
    p.set("von", String(now - r.ms));
  }
  if (q.raster !== "auto") p.set("raster", q.raster);
}

function apiUrl(q: GraphQuery, metric: Metric, players: string[], now: number) {
  const p = new URLSearchParams();
  p.set("metric", metric);
  if (players.length) p.set("spieler", players.join(","));
  rangeParams(q, now, p);
  return `/api/series?${p}`;
}

/** So lange gilt eine geladene Zeitreihe als frisch; danach wird sie bei der nächsten Änderung neu geholt */
const CACHE_TTL_MS = 2 * 60_000;

/** Geladene Linien eines Teils (eine Kennzahl für einen Spieler bzw. für Summe/beste fünf) */
interface CacheEntry {
  lines: ApiLine[];
  bucketMinutes: number;
  at: number;
}

/** Zeitraum im Cache-Schlüssel: relative Zeiträume über ihren Namen, damit „24 Std“ nicht ständig neu lädt */
const rangeKey = (q: GraphQuery) => [q.zeit === "eigen" ? `${q.von}~${q.bis}` : q.zeit, q.raster].join(":");

/**
 * Datenteile einer Auswahl: je Kennzahl ein Teil pro gewähltem Spieler, sonst einer für Summe bzw. beste fünf.
 * Einheit/% und Stand/Zuwachs gehören nicht dazu – sie ändern nur die Darstellung.
 */
function partsOf(q: GraphQuery, meta: (m: Metric) => MetricMeta): { metric: Metric; player: string | null; key: string }[] {
  const range = rangeKey(q);
  return q.metrics.flatMap((metric): { metric: Metric; player: string | null; key: string }[] =>
    meta(metric).perPlayer && q.spieler.length
      ? q.spieler.map((player) => ({ metric, player, key: `${metric}@${player}@${range}` }))
      : [{ metric, player: null, key: `${metric}@*@${range}` }],
  );
}

/** Zuwachs je Bündel aus dem Stand (wie der Server: Differenz zum vorigen Punkt, nie negativ) */
function toDelta(points: { at: string; v: number }[]) {
  return points.slice(1).map((p, i) => ({ at: p.at, v: Math.max(0, p.v - points[i].v) }));
}

function suggestionsUrl(q: GraphQuery, metric: Metric, now: number) {
  const p = new URLSearchParams();
  p.set("metric", metric);
  rangeParams(q, now, p);
  if (q.modus === "zuwachs" && metaOf(metric).counter) p.set("modus", "zuwachs");
  return `/api/series/suggestions?${p}`;
}

interface ApiLine {
  id: string;
  name: string;
  points: { at: string; v: number }[];
}

/** Eine gezeichnete Linie: Kennzahl × Spieler (bzw. Server/Alle) */
interface Line extends ApiLine {
  metric: Metric;
  meta: MetricMeta;
  color: string;
  format: (v: number) => string;
}

/* ---------- Chart ---------- */

const tf = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const df = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Berlin" });
const dtf = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/**
 * Weiche Kurve durch alle Punkte (monotone kubische Interpolation wie d3 curveMonotoneX):
 * schwingt nicht über, bleibt also bei Zählern immer zwischen den echten Werten.
 */
function smoothPath(pts: (readonly [number, number])[]) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-9, xs[i + 1] - xs[i]));
    m.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
    }
  }
  t.push(m[n - 2]);
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(xs[i] + h).toFixed(1)},${(ys[i] + t[i] * h).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)},${(ys[i + 1] - t[i + 1] * h).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

/**
 * Teilt eine Linie an Datenlücken (z. B. Tracker aus): Abstand über dem Dreifachen des üblichen Abstands,
 * mindestens 15 Min. Dort bleibt der Graph leer, statt eine Schräge über die fehlende Zeit zu ziehen.
 */
function splitAtGaps<T extends { at: string }>(points: T[]): T[][] {
  if (points.length < 3) return [points];
  const steps = points.slice(1).map((p, i) => Date.parse(p.at) - Date.parse(points[i].at)).sort((a, b) => a - b);
  const limit = Math.max(15 * 60_000, steps[Math.floor(steps.length / 2)] * 3);
  const parts: T[][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    if (Date.parse(points[i].at) - Date.parse(points[i - 1].at) > limit) parts.push([]);
    parts[parts.length - 1].push(points[i]);
  }
  return parts;
}

/** „Schöne“ Achsenschritte */
function niceStep(max: number, ticks: number) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}


/**
 * Mehrere Linien in einem Chart. Haben alle Kennzahlen dieselbe Einheit (z. B. Blöcke), gibt es eine echte
 * Y-Achse in dieser Einheit; Ränge stehen dabei umgedreht (Platz 1 oben). Bei verschiedenen Einheiten oder auf
 * Wunsch (`percent`) wird jede Kennzahl auf ihr eigenes Maximum skaliert (0–100 %). Echte Werte zeigen Tooltip und Legende.
 */
function MultiChart({ lines, hidden, dataKey, percent }: { lines: Line[]; hidden: Set<string>; dataKey: string; percent: boolean }) {
  const W = 1000;
  const H = 300;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null); // Zeitpunkt (ms)

  const visible = lines.filter((l) => !hidden.has(l.id) && l.points.length > 0);
  const all = visible.flatMap((l) => l.points);
  if (all.length === 0) return <p className="chart__empty">Keine Daten für diese Auswahl.</p>;

  const units = new Set(visible.map((l) => l.meta.unit));
  const normalized = percent || units.size > 1;
  const invert = !normalized && visible.every((l) => l.meta.invert);

  const t0 = Math.min(...all.map((p) => Date.parse(p.at)));
  const t1 = Math.max(...all.map((p) => Date.parse(p.at)));
  const span = Math.max(1, t1 - t0);

  // Maximum je Kennzahl (für die Prozent-Skalierung) bzw. gesamt (für die Achse)
  const maxOf = new Map<Metric, number>();
  for (const l of visible) maxOf.set(l.metric, Math.max(maxOf.get(l.metric) ?? 0, ...l.points.map((p) => p.v)));
  const vmax = Math.max(...maxOf.values());
  // Rang-Achse: Platz 1 oben, ganzzahlige Schritte
  const ystep = normalized ? 25 : invert ? Math.max(1, Math.round(niceStep(Math.max(vmax - 1, 1), 4))) : niceStep(Math.max(vmax, 1), 4);
  const ymax = normalized ? 100 : invert ? 1 + Math.max(ystep, Math.ceil((vmax - 1) / ystep) * ystep) : Math.max(ystep, Math.ceil(vmax / ystep) * ystep);
  const ymin = invert ? 1 : 0;
  const x = (t: number) => ((t - t0) / span) * W;
  const scaled = (l: Line, v: number) => {
    if (!normalized) return v;
    const max = Math.max(1e-9, maxOf.get(l.metric) ?? 1);
    // Rang in Prozent: bester Platz = 100 %
    return l.meta.invert ? (1 - (v - 1) / Math.max(1, max - 1)) * 100 : (v / max) * 100;
  };
  const yOf = (v: number) => (invert ? ((v - ymin) / (ymax - ymin)) * H : H - ((v - ymin) / (ymax - ymin)) * H);
  const y = (l: Line, v: number) => yOf(scaled(l, v));

  const paths = lines
    .filter((l) => l.points.length > 0)
    .map((l) => {
      const d = splitAtGaps(l.points)
        .map((part) => smoothPath(part.map((p) => [x(Date.parse(p.at)), y(l, p.v)] as const)))
        .join(" ");
      return { id: l.id, d, color: l.color, off: hidden.has(l.id) };
    });

  const yTicks: number[] = [];
  for (let v = ymin; v <= ymax + 1e-9; v += ystep) yTicks.push(v);
  const axisFormat = normalized ? (v: number) => `${Math.round(v)} %` : visible[0].format;
  const xTicks = 6;
  const multiDay = span > 36e5 * 20;
  const xLabel = (t: number) => (multiDay ? `${df.format(t)} ${tf.format(t)}` : tf.format(t));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setHover(t0 + ((e.clientX - rect.left) / rect.width) * span);
  };

  // Werte je Linie zum Hover-Zeitpunkt (nächster Messpunkt)
  const tip =
    hover === null
      ? null
      : visible.map((l) => {
          let best = -1;
          let bestD = Infinity;
          for (let i = 0; i < l.points.length; i++) {
            const d = Math.abs(Date.parse(l.points[i].at) - hover);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          return { line: l, p: best >= 0 ? l.points[best] : null };
        });
  const firstHit = tip?.find((t) => t.p)?.p;
  const tipT = firstHit ? Date.parse(firstHit.at) : hover;
  const tipLeft = tipT === null ? 0 : (tipT - t0) / span;

  return (
    <div className="gb-chart">
      <div className="gb-chart__y" aria-hidden="true" data-invert={invert || undefined}>
        {(invert ? yTicks : [...yTicks].reverse()).map((v) => (
          <span key={`${dataKey}:${v}`} className="gb-chart__ylabel">
            {axisFormat(v)}
          </span>
        ))}
      </div>
      <div className="gb-chart__plot">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="gb-chart__svg"
          role="img"
          aria-label="Graph"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((v) => (
            <line key={v} x1={0} x2={W} y1={yOf(v)} y2={yOf(v)} className="gb-chart__grid" vectorEffect="non-scaling-stroke" />
          ))}
          {/* key = Daten-Identität: bei neuen Daten wird die Gruppe neu eingeblendet (Einzeichnen von links nach rechts) */}
          <g key={dataKey} className="gb-chart__lines">
            {paths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                className="gb-chart__line"
                data-off={p.off || undefined}
                fill="none"
                stroke={p.color}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {tip && tipT !== null && (
            <>
              <line x1={x(tipT)} x2={x(tipT)} y1={0} y2={H} className="spark__cursor" vectorEffect="non-scaling-stroke" />
              {tip.map(
                (t) =>
                  t.p && <circle key={t.line.id} cx={x(Date.parse(t.p.at))} cy={y(t.line, t.p.v)} r={5} fill={t.line.color} stroke="var(--line)" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
              )}
            </>
          )}
        </svg>
        {tip && tipT !== null && (
          <div className="gb-chart__tip" style={{ left: `${tipLeft * 100}%`, transform: `translateX(${tipLeft > 0.7 ? "-100%" : tipLeft < 0.3 ? "0" : "-50%"})` }} role="status">
            <span className="gb-chart__tip-time">{dtf.format(tipT)} Uhr</span>
            {tip.map((t) => (
              <span key={t.line.id} className="gb-chart__tip-row">
                <i style={{ background: t.line.color }} />
                <span className="gb-chart__tip-name">{t.line.name}</span>
                <span className="num">{t.p ? t.line.format(t.p.v) : "–"}</span>
              </span>
            ))}
          </div>
        )}
        <div className="chart__axis gb-chart__x">
          {Array.from({ length: xTicks + 1 }, (_, i) => (
            <span key={i}>{xLabel(t0 + (span * i) / xTicks)}</span>
          ))}
        </div>
        {normalized && (
          <p className="muted gb-chart__note">
            {units.size > 1 ? "Verschiedene Einheiten: " : ""}jede Kennzahl ist auf ihr eigenes Maximum skaliert (100 %). Echte Werte zeigen Tooltip und Legende.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Auswahl + Laden ---------- */

export function GraphBuilder({ players, initial, items }: { players: PlayerOption[]; initial: GraphQuery; items: ItemOptions }) {
  const [q, setQ] = useState<GraphQuery>(initial);
  const [search, setSearch] = useState("");
  const [playersOpen, setPlayersOpen] = useState(false);
  const [picker, setPicker] = useState<PickerTab | null>(null);
  const [metricSearch, setMetricSearch] = useState("");
  const [playerScores, setPlayerScores] = useState<{ key: string; scores: Record<string, number>; error?: string } | null>(null);
  // Geladene Teile (siehe `partsOf`); Darstellung entsteht daraus ohne neue Abfrage
  const [cache, setCache] = useState<Map<string, CacheEntry>>(() => new Map());
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  // Zuletzt vollständig gezeigte Auswahl: bleibt sichtbar, bis die neue komplett geladen ist
  const [shownQ, setShownQ] = useState<GraphQuery | null>(null);
  const inflight = useRef(new Set<string>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const nameOf = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const itemNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [c, list] of Object.entries(items)) for (const o of list ?? []) m.set(`${c}|${o.key}`, o.name);
    return m;
  }, [items]);
  const meta = useMemo(() => (m: Metric) => metaOf(m, (c, k) => itemNames.get(`${c}|${k}`)), [itemNames]);

  const metas = q.metrics.map(meta);
  const anyPerPlayer = metas.some((m) => m.perPlayer);
  const anyCounter = metas.some((m) => m.counter);
  const multi = q.metrics.length > 1;
  const mixedUnits = new Set(metas.map((m) => m.unit)).size > 1;
  // Sortierung der Spieler-Vorschläge nach einer normalen Kennzahl (Ränge und Einzel-Items haben keine Gesamtwertung)
  const playerMetrics = q.metrics.filter((m): m is keyof typeof METRICS => m in METRICS && METRICS[m as keyof typeof METRICS].perPlayer);
  const rankingMetric = (q.modus === "zuwachs" && playerMetrics.find((m) => METRICS[m].counter)) || playerMetrics[0];
  const rankingKey = rankingMetric ? [rankingMetric, q.zeit, q.von, q.bis, q.raster, q.modus].join(":") : "";
  const currentScores = playerScores?.key === rankingKey && !playerScores.error ? playerScores.scores : null;

  // Reihenfolge der Vorschläge erst holen, wenn die Spielersuche offen ist (und nur einmal je Auswahl)
  const wantScores = playersOpen || search !== "";
  useEffect(() => {
    if (!rankingMetric || !wantScores || playerScores?.key === rankingKey) return;
    const ctrl = new AbortController();
    fetch(suggestionsUrl(q, rankingMetric, Date.now()), { signal: ctrl.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`);
        return (await response.json()) as { scores: Record<string, number> };
      })
      .then(({ scores }) => setPlayerScores({ key: rankingKey, scores }))
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setPlayerScores({ key: rankingKey, scores: {}, error: e.message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rankingKey fasst alle relevanten Teile von q zusammen
  }, [rankingMetric, rankingKey, wantScores]);

  // URL mitführen, damit die Auswahl teilbar ist
  useEffect(() => {
    const s = toSearch(q).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [q]);

  const dataKey = [q.metrics.join(","), q.spieler.join(","), rangeKey(q)].join("|");
  const parts = useMemo(() => partsOf(q, meta), [q, meta]);
  const isReady = (x: GraphQuery) => partsOf(x, meta).every((p) => cache.has(p.key));
  const ready = isReady(q);
  const viewQ = ready ? q : shownQ && isReady(shownQ) ? shownQ : null;
  const loading = !ready;
  const error = !ready && loadError?.key === dataKey ? loadError.message : null;

  // Nur fehlende oder veraltete Teile laden, je Kennzahl in einer Abfrage. Nicht abbrechen: auch Ergebnisse einer
  // inzwischen geänderten Auswahl landen im Cache (z. B. beim schnellen Hin- und Herschalten).
  useEffect(() => {
    const now = Date.now();
    const todo = new Map<Metric, { players: string[]; keys: string[] }>();
    for (const p of parts) {
      const hit = cache.get(p.key);
      if (inflight.current.has(p.key) || (hit && now - hit.at < CACHE_TTL_MS)) continue;
      const job = todo.get(p.metric) ?? { players: [], keys: [] };
      if (p.player) job.players.push(p.player);
      job.keys.push(p.key);
      todo.set(p.metric, job);
    }
    for (const [metric, job] of todo) {
      job.keys.forEach((k) => inflight.current.add(k));
      fetch(apiUrl(q, metric, job.players, now))
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
          return (await r.json()) as { series: ApiLine[]; bucketMinutes: number };
        })
        .then(({ series, bucketMinutes }) =>
          setCache((prev) => {
            const next = new Map(prev);
            const at = Date.now();
            if (job.players.length) job.players.forEach((id, i) => next.set(job.keys[i], { lines: series.filter((l) => l.id === id), bucketMinutes, at }));
            else next.set(job.keys[0], { lines: series, bucketMinutes, at });
            return next;
          }),
        )
        .catch((e: Error) => setLoadError({ key: dataKey, message: e.message }))
        .finally(() => job.keys.forEach((k) => inflight.current.delete(k)));
    }
  }, [parts, cache, q, dataKey]);

  // Linien aus dem Cache; Einheit/% und Stand/Zuwachs gelten sofort, auch für das noch stehende alte Bild
  const view = useMemo(() => {
    if (!viewQ) return null;
    const vq: GraphQuery = { ...viewQ, achse: q.achse, modus: q.modus };
    const lines: Line[] = [];
    let bucketMinutes = 0;
    for (const metric of vq.metrics) {
      const m = meta(metric);
      const entries = partsOf({ ...vq, metrics: [metric] }, meta).map((p) => cache.get(p.key)!);
      const series = entries.flatMap((e) => e.lines);
      bucketMinutes = Math.max(bucketMinutes, ...entries.map((e) => e.bucketMinutes));
      const delta = vq.modus === "zuwachs" && m.counter;
      for (const s of series) {
        lines.push({
          ...s,
          points: delta ? toDelta(s.points) : s.points,
          id: `${metric}:${s.id}`,
          name: vq.metrics.length === 1 ? s.name : series.length > 1 || vq.spieler.length || m.needsPlayers ? `${m.label} · ${s.name}` : m.label,
          metric,
          meta: m,
          color: metric === "twitchSubs" && series.length === 1 ? "var(--twitch)" : COLORS[lines.length % COLORS.length],
          format: m.format,
        });
      }
    }
    return { q: vq, lines, bucketMinutes, key: toSearch(vq).toString() };
  }, [viewQ, q.achse, q.modus, cache, meta]);
  const lines = view?.lines ?? [];

  const set = (patch: Partial<GraphQuery>) => {
    // Das aktuelle Bild bleibt stehen, bis die neue Auswahl geladen ist
    if (ready) setShownQ(q);
    setQ({ ...q, ...patch });
  };
  const toggleMetric = (m: Metric) => {
    if (q.metrics.includes(m)) {
      if (q.metrics.length > 1) set({ metrics: q.metrics.filter((x) => x !== m) });
    } else if (q.metrics.length < MAX_METRICS) {
      set({ metrics: [...q.metrics, m] });
    }
  };
  const togglePlayer = (id: string) =>
    set({ spieler: q.spieler.includes(id) ? q.spieler.filter((x) => x !== id) : q.spieler.length >= 12 ? q.spieler : [...q.spieler, id] });

  const suggestions = useMemo(() => {
    const s = search.trim().toLowerCase();
    return players
      .filter((p) => !q.spieler.includes(p.id) && (!s || p.name.toLowerCase().includes(s) || p.id.includes(s)))
      .sort((a, b) => (currentScores ? (currentScores[b.id] ?? 0) - (currentScores[a.id] ?? 0) : 0) || a.name.localeCompare(b.name, "de"))
      .slice(0, 10);
  }, [players, q.spieler, search, currentScores]);

  // Kennzahl-Auswahl: Suche über alle Reiter (außer Einzeln), sonst der gewählte Reiter
  const needle = metricSearch.trim().toLowerCase();
  const pickable: { m: Metric; label: string; tone: string; hint?: string }[] = useMemo(() => {
    const base = METRIC_KEYS.map((k) => ({ m: k as Metric, label: METRICS[k].label, tone: METRICS[k].tone, hint: METRICS[k].hint, group: METRICS[k].group as string }));
    const ranks = RANK_KEYS.map((k) => ({ m: rankMetric(k) as Metric, label: LEADERBOARDS[k].title, tone: LEADERBOARDS[k].tone, hint: `Platz in „${LEADERBOARDS[k].title}“ (${LEADERBOARDS[k].sub})`, group: "rang" }));
    return [...base, ...ranks]
      .filter((x) => (needle ? x.label.toLowerCase().includes(needle) || (x.hint ?? "").toLowerCase().includes(needle) : x.group === picker))
      .map(({ m, label, tone, hint }) => ({ m, label, tone, hint }));
  }, [needle, picker]);

  const latest = (l: Line) => (l.points.length ? l.format(l.points[l.points.length - 1].v) : "–");
  const best = (l: Line) => (l.points.length ? l.format(l.meta.invert ? Math.min(...l.points.map((p) => p.v)) : Math.max(...l.points.map((p) => p.v))) : "–");
  const total = (l: Line) => l.format(l.points.reduce((s, p) => s + p.v, 0));
  const bucket = view?.bucketMinutes;
  // Wert ↔ Platz: alle Kennzahlen mit Rang-Verlauf auf einmal umschalten
  const rankable = q.metrics.some((m) => rankOfMetric(m) || valueOfRank(m));
  const asRank = rankable && q.metrics.every((m) => !rankOfMetric(m));
  const switchRank = (toRank: boolean) =>
    set({ metrics: [...new Set(q.metrics.map((m) => (toRank ? rankOfMetric(m) : valueOfRank(m)) ?? m))] });
  const selectedItems = q.metrics.flatMap((m) => {
    const it = parseItemMetric(m);
    return it ? [`${it.category}|${it.key}`] : [];
  });

  return (
    <div className="gb" id="graph">
      <div className="box gb__form" data-tone="white">
        {/* Gewählte Kennzahlen; „+ Kennzahl“ öffnet die Auswahl */}
        <div className="gb__selected">
          {q.metrics.map((m, i) => {
            const mm = metas[i];
            return (
              <button key={m} type="button" className="gb__chip gb__chip--metric" data-tone="white" onClick={() => toggleMetric(m)} disabled={q.metrics.length === 1} title={mm.hint ?? "Entfernen"}>
                <span className="swatch" data-tone={mm.tone} aria-hidden="true" />
                {mm.label}
                {q.metrics.length > 1 && <span aria-hidden="true"> ×</span>}
              </button>
            );
          })}
          {q.metrics.length < MAX_METRICS && (
            <button type="button" className="gb__chip" data-tone={picker ? "ink" : "white"} aria-expanded={picker !== null} onClick={() => setPicker(picker ? null : "server")}>
              + Kennzahl
            </button>
          )}
          <span className="muted gb__hint">
            {q.metrics.length}/{MAX_METRICS}
          </span>
        </div>

        {picker && (
          <div className="gb__picker">
            <div className="gb__picker-bar">
              <div className="gb__tabs" role="tablist" aria-label="Rubrik">
                {PICKER_TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={!needle && picker === t.key} onClick={() => (setPicker(t.key), setMetricSearch(""))}>
                    {t.label}
                  </button>
                ))}
              </div>
              {picker !== "einzeln" && (
                <input type="search" placeholder="Kennzahl suchen …" value={metricSearch} onChange={(e) => setMetricSearch(e.target.value)} aria-label="Kennzahl suchen" />
              )}
              <button type="button" className="gb__close" onClick={() => setPicker(null)} aria-label="Auswahl schließen">
                ×
              </button>
            </div>
            {picker === "einzeln" && !needle ? (
              <ItemPicker options={items} selected={selectedItems} onPick={(c: TopCategory, k: string) => toggleMetric(itemMetric(c, k))} />
            ) : (
              <ul className="gb__chips" aria-label="Kennzahlen">
                {pickable.map((x) => {
                  const on = q.metrics.includes(x.m);
                  return (
                    <li key={x.m}>
                      <button type="button" className="gb__chip" data-tone={on ? "ink" : "white"} aria-pressed={on} disabled={!on && q.metrics.length >= MAX_METRICS} onClick={() => toggleMetric(x.m)} title={x.hint}>
                        <span className="swatch" data-tone={x.tone} aria-hidden="true" />
                        {x.label}
                      </button>
                    </li>
                  );
                })}
                {pickable.length === 0 && <li className="muted">Keine Kennzahl passt zu „{metricSearch}“.</li>}
              </ul>
            )}
          </div>
        )}

        {anyPerPlayer && (
          <div className="gb__line">
            <span className="eyebrow">Spieler</span>
            <ul className="gb__chips" aria-label="Ausgewählte Spieler">
              <li>
                <button type="button" className="gb__chip" data-tone={q.spieler.length === 0 ? "ink" : "white"} onClick={() => set({ spieler: [] })} title="Ohne Auswahl: Summe aller Spieler, bei Rängen und Einzel-Items die besten fünf">
                  {metas.some((m) => m.needsPlayers) && !metas.some((m) => m.perPlayer && !m.needsPlayers) ? "Beste 5" : "Alle"}
                </button>
              </li>
              {q.spieler.map((id) => (
                <li key={id}>
                  <button type="button" className="gb__chip gb__chip--head" data-tone="ink" onClick={() => togglePlayer(id)} aria-label={`${nameOf.get(id) ?? id} entfernen`}>
                    <Head id={id} name={nameOf.get(id) ?? id} size={20} src={32} decorative /> <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="gb__pick">
              <input
                type="search"
                placeholder="+ Spieler"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setPlayersOpen(true)}
                onBlur={() => setTimeout(() => setPlayersOpen(false), 150)}
                aria-label="Spieler suchen"
              />
              {(playersOpen || search) && (
                <ul className="gb__chips gb__suggest" aria-label="Vorschläge">
                  {suggestions.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="gb__chip" data-tone="white" onMouseDown={(e) => e.preventDefault()} onClick={() => togglePlayer(p.id)} disabled={q.spieler.length >= 12}>
                        <Head id={p.id} name={p.name} size={20} src={32} decorative /> {p.name}
                      </button>
                    </li>
                  ))}
                  {suggestions.length === 0 && <li className="muted">Niemand gefunden.</li>}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="gb__line gb__controls">
          <div className="gb__seg" role="group" aria-label="Zeitraum">
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={q.zeit === r.key} onClick={() => set({ zeit: r.key })}>
                {r.label}
              </button>
            ))}
          </div>
          {q.zeit === "eigen" && (
            <span className="gb__custom">
              <input type="datetime-local" value={q.von} onChange={(e) => set({ von: e.target.value })} aria-label="Von" />
              <input type="datetime-local" value={q.bis} onChange={(e) => set({ bis: e.target.value })} aria-label="Bis" />
            </span>
          )}
          <label className="gb__select">
            <span className="eyebrow">Raster</span>
            <select value={q.raster} onChange={(e) => set({ raster: e.target.value })}>
              {RASTER.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {anyCounter && (
            <div className="gb__seg" role="group" aria-label="Anzeige" title={q.modus === "zuwachs" && multi ? "Zuwachs gilt nur für Zähler, andere Kennzahlen zeigen den Stand" : undefined}>
              <button type="button" aria-pressed={q.modus === "wert"} onClick={() => set({ modus: "wert" })}>
                Stand
              </button>
              <button type="button" aria-pressed={q.modus === "zuwachs"} onClick={() => set({ modus: "zuwachs" })}>
                Zuwachs
              </button>
            </div>
          )}
          {rankable && (
            <div className="gb__seg" role="group" aria-label="Wert oder Platz" title="Alle Kennzahlen als Platz in ihrer Bestenliste zeigen">
              <button type="button" aria-pressed={!asRank} onClick={() => switchRank(false)}>
                Wert
              </button>
              <button type="button" aria-pressed={asRank} onClick={() => switchRank(true)}>
                Platz
              </button>
            </div>
          )}
          <div className="gb__seg" role="group" aria-label="Y-Achse" title={mixedUnits ? "Verschiedene Einheiten werden immer in Prozent gezeigt" : undefined}>
            <button type="button" aria-pressed={q.achse === "einheit" && !mixedUnits} disabled={mixedUnits} onClick={() => set({ achse: "einheit" })}>
              Einheit
            </button>
            <button type="button" aria-pressed={q.achse === "prozent" || mixedUnits} onClick={() => set({ achse: "prozent" })}>
              %
            </button>
          </div>
        </div>
      </div>

      <div className="box gb__chart" data-tone="white" aria-busy={loading}>
        <div className="chart__head">
          <span className="eyebrow">
            {(view?.q.metrics ?? q.metrics).map((m) => meta(m).label).join(" + ")}
            {q.modus === "zuwachs" && anyCounter && " · Zuwachs"}
            {bucket !== undefined && <span className="muted"> · {bucket >= 60 ? `${bucket / 60} Std` : `${bucket} Min`} je Punkt</span>}
          </span>
          {loading && !error && <span className="muted gb__loading">Lädt …</span>}
          {error && <span className="gb__loading">Fehler: {error}</span>}
        </div>
        {view ? (
          <MultiChart lines={lines} hidden={hidden} dataKey={view.key} percent={q.achse === "prozent"} />
        ) : (
          <p className="chart__empty">{error ? `Fehler: ${error}` : "Lädt …"}</p>
        )}
        {lines.length > 0 && (
          <ul className="gb__legend" aria-label="Legende">
            {lines.map((l) => {
              const off = hidden.has(l.id);
              const delta = q.modus === "zuwachs" && l.meta.counter;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    className="gb__legend-btn"
                    aria-pressed={!off}
                    onClick={() =>
                      setHidden((h) => {
                        const n = new Set(h);
                        if (n.has(l.id)) n.delete(l.id);
                        else n.add(l.id);
                        return n;
                      })
                    }
                  >
                    <i style={{ background: l.color }} />
                    <span className="gb__legend-name">{l.name}</span>
                    <span className="num">{delta ? `Σ ${total(l)}` : latest(l)}</span>
                    <span className="muted num">
                      {l.meta.invert ? "bester" : "max"} {best(l)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
