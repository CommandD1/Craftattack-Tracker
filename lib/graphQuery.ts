import { boardValue, num } from "./format";
import { GROUP_TONE, METRIC_TONE } from "./statTone";
import { EXTRA_STATS, EXTRA_STAT_KEYS, FORMATTERS, type ExtraMetric, type StatGroup } from "./playerStats";

/* ---------- Konfiguration ---------- */

type BaseMetric = "onlineCount" | "liveCount" | "viewers" | "playtimeSeconds" | "afkSeconds" | "afkMobsSeconds" | "afkBlocksSeconds" | "deaths" | "diamonds" | "blocksBroken" | "mobsKilled" | "distance" | "damageDealt" | "totemsUsed" | "foodEaten" | "followers" | "twitchSubs" | "online";
export type Metric = BaseMetric | ExtraMetric;

interface MetricMeta {
  label: string;
  /** Gibt es die Kennzahl pro Spieler? Sonst nur für den Server. */
  perPlayer: boolean;
  /** Zähler, der nur steigt (Treppenlinie, Zuwachs sinnvoll) */
  counter: boolean;
  format: (v: number) => string;
  hint?: string;
  /** Farbton der Kachel in der Auswahl */
  tone: string;
  /** Icon-Name aus `Icon` */
  icon: string;
  /** Rubrik in der Auswahl; Server-Kennzahlen haben eine eigene */
  group: StatGroup | "server";
}

const EXTRA_HINT = "Verlauf beginnt mit der Erfassung über die Einzelstatistik der API";

const BASE_METRICS: Record<BaseMetric, MetricMeta> = {
  onlineCount: { label: "Spieler online", perPlayer: false, counter: false, format: num, tone: METRIC_TONE.onlineCount, icon: "users", group: "server" },
  liveCount: { label: "Streams live", perPlayer: false, counter: false, format: num, tone: METRIC_TONE.liveCount, icon: "twitch", group: "server" },
  playtimeSeconds: { label: "Spielzeit", perPlayer: true, counter: true, format: (v) => boardValue("playtimeSeconds", v), tone: METRIC_TONE.playtimeSeconds, icon: "clock", group: "allgemein" },
  online: { label: "Online (ja/nein)", perPlayer: true, counter: false, format: (v) => (v >= 1 ? "online" : "offline"), hint: "Ohne Spieler: Anzahl online", tone: METRIC_TONE.online, icon: "login", group: "allgemein" },
  viewers: { label: "Zuschauer", perPlayer: true, counter: false, format: num, hint: "Ohne Spieler: Summe aller Streams", tone: METRIC_TONE.viewers, icon: "eye", group: "allgemein" },
  followers: { label: "Follower", perPlayer: true, counter: true, format: num, hint: "Kumulierte neue Twitch-Follower während aufeinanderfolgender Messungen auf dem Server", tone: METRIC_TONE.followers, icon: "users", group: "allgemein" },
  twitchSubs: { label: "Twitch Subs", perPlayer: true, counter: true, format: num, hint: "Abos, die eingegangen sind, während der Streamer auf dem Server online war", tone: METRIC_TONE.twitchSubs, icon: "gift", group: "allgemein" },
  diamonds: { label: "Diamanten", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.diamonds, icon: "diamond", group: "abbau" },
  blocksBroken: { label: "Blöcke abgebaut", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.blocksBroken, icon: "pickaxe", group: "abbau" },
  deaths: { label: "Tode", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.deaths, icon: "skull", group: "kampf" },
  mobsKilled: { label: "Mobs", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.mobsKilled, icon: "sword", group: "kampf" },
  damageDealt: { label: "Schaden", perPlayer: true, counter: true, format: (v) => boardValue("damageDealt", v), hint: "Ausgeteilter Schaden in Herzen", tone: METRIC_TONE.damageDealt, icon: "heart", group: "kampf" },
  totemsUsed: { label: "Totems", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.totemsUsed, icon: "totem", group: "kampf" },
  distance: { label: "Strecke", perPlayer: true, counter: true, format: (v) => boardValue("distance", v), tone: METRIC_TONE.distance, icon: "boots", group: "bewegung" },
  foodEaten: { label: "Essen", perPlayer: true, counter: true, format: num, tone: METRIC_TONE.foodEaten, icon: "food", group: "items" },
  afkSeconds: { label: "AFK-Zeit", perPlayer: true, counter: true, format: (v) => boardValue("playtimeSeconds", v), hint: "AFK = online, aber ≥ 20 Min keine Bewegung; aus dem Spielerverlauf berechnet", tone: METRIC_TONE.afkSeconds, icon: "clock", group: "afk" },
  afkMobsSeconds: { label: "AFK: Mobs farmen", perPlayer: true, counter: true, format: (v) => boardValue("playtimeSeconds", v), hint: "AFK-Zeit, in der trotzdem ≥ 10 Mobs pro Minute gestorben sind (Mob-Farm)", tone: METRIC_TONE.afkMobsSeconds, icon: "sword", group: "afk" },
  afkBlocksSeconds: { label: "AFK: Blöcke farmen", perPlayer: true, counter: true, format: (v) => boardValue("playtimeSeconds", v), hint: "AFK-Zeit, in der trotzdem ≥ 10 Blöcke pro Minute abgebaut wurden (Block-Farm)", tone: METRIC_TONE.afkBlocksSeconds, icon: "pickaxe", group: "afk" },
};

const EXTRA_METRIC_META = Object.fromEntries(
  EXTRA_STAT_KEYS.map((k) => {
    const x = EXTRA_STATS[k];
    const meta: MetricMeta = { label: x.label, perPlayer: true, counter: true, format: FORMATTERS[x.format], hint: EXTRA_HINT, tone: GROUP_TONE[x.group], icon: x.icon, group: x.group };
    return [x.metric, meta];
  }),
) as Record<ExtraMetric, MetricMeta>;

export const METRICS: Record<Metric, MetricMeta> = { ...BASE_METRICS, ...EXTRA_METRIC_META };
export const METRIC_KEYS = Object.keys(METRICS) as Metric[];

export const RANGES: { key: string; label: string; ms: number | null }[] = [
  { key: "1h", label: "1 Std", ms: 3600_000 },
  { key: "6h", label: "6 Std", ms: 6 * 3600_000 },
  { key: "24h", label: "24 Std", ms: 24 * 3600_000 },
  { key: "3d", label: "3 Tage", ms: 3 * 24 * 3600_000 },
  { key: "7d", label: "7 Tage", ms: 7 * 24 * 3600_000 },
  { key: "alle", label: "Alles", ms: null },
  { key: "eigen", label: "Eigener", ms: null },
];
export const RASTER: { key: string; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "1", label: "1 Min" },
  { key: "5", label: "5 Min" },
  { key: "15", label: "15 Min" },
  { key: "60", label: "1 Std" },
  { key: "360", label: "6 Std" },
  { key: "1440", label: "1 Tag" },
];
export const COLORS = ["var(--ink)", "#9146ff", "#ff6452", "#1f9e8f", "#2f9a1f", "#d9a300", "#d35fb3", "#ff7a00", "#2b7bd1", "#8a5a3b", "#4f1a6d", "#6d6d6d"];

export interface PlayerOption {
  id: string;
  name: string;
}

export const MAX_METRICS = 6;

export interface GraphQuery {
  /** Mindestens eine Kennzahl; mehrere werden gemeinsam gezeichnet */
  metrics: Metric[];
  spieler: string[];
  zeit: string;
  von: string;
  bis: string;
  raster: string;
  modus: "wert" | "zuwachs";
}

/** Query-Parameter → Konfiguration (auch serverseitig nutzbar) */
export function parseGraphQuery(sp: Record<string, string | string[] | undefined>): GraphQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const metrics = [...new Set(s("metric").split(",").map((x) => x.trim()))].filter((x): x is Metric => METRIC_KEYS.includes(x as Metric)).slice(0, MAX_METRICS);
  return {
    metrics: metrics.length ? metrics : ["onlineCount"],
    spieler: s("spieler").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    zeit: RANGES.some((r) => r.key === s("zeit")) ? s("zeit") : "24h",
    von: s("von"),
    bis: s("bis"),
    raster: RASTER.some((r) => r.key === s("raster")) ? s("raster") : "auto",
    modus: s("modus") === "zuwachs" ? "zuwachs" : "wert",
  };
}

export function toSearch(q: GraphQuery) {
  const p = new URLSearchParams();
  p.set("metric", q.metrics.join(","));
  if (q.spieler.length) p.set("spieler", q.spieler.join(","));
  if (q.zeit !== "24h") p.set("zeit", q.zeit);
  if (q.zeit === "eigen") {
    if (q.von) p.set("von", q.von);
    if (q.bis) p.set("bis", q.bis);
  }
  if (q.raster !== "auto") p.set("raster", q.raster);
  if (q.modus !== "wert") p.set("modus", q.modus);
  return p;
}
