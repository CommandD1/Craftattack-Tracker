import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeletons";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { getFullBoard, getTwitchSubscriptionBoard } from "@/lib/store";
import { getAfkBoard, getAfkRanksBefore, getBoardRanksBefore, getExtraRanksBefore, getFollowerRanksBefore, getTopRanksBefore, getTrackedRanksBefore } from "@/lib/analytics";
import { BOARD_KEYS, type AfkKind, type BoardKey, type PlayerState } from "@/lib/types";
import { ago, boardValue, duration, num } from "@/lib/format";
import { BoardValue } from "@/components/BoardValue";
import { Icon } from "@/components/Icons";
import { playtimeOf } from "@/lib/playtime";
import { Head } from "@/components/Head";
import { EXTRA_STATS, FORMATTERS, type ExtraStatKey } from "@/lib/playerStats";
import {
  LEADERBOARDS,
  LEADERBOARD_GROUPS,
  LEADERBOARD_KEYS,
  TOP_CATEGORIES,
  boardHref,
  isLeaderboardKey,
  itemBoardMeta,
  itemHref,
  itemRanking,
  restRanking,
  parseItemParam,
  topCategoryLabel,
  type LeaderboardKey,
  type LeaderboardMeta,
  type TopCategory,
} from "@/lib/leaderboards";

export const metadata: Metadata = { title: "Bestenlisten" };

type Key = Exclude<LeaderboardKey, "top">;
const AFK_KEYS = ["afk", "afkmobs", "afkblocks"] as const;
const isAfkKey = (k: string): k is (typeof AFK_KEYS)[number] => (AFK_KEYS as readonly string[]).includes(k);
const afkKindOf = (k: string): AfkKind | undefined => (k === "afkmobs" ? "mobs" : k === "afkblocks" ? "blocks" : undefined);
const isBoardKey = (k: string): k is BoardKey => (BOARD_KEYS as readonly string[]).includes(k);
const isExtraKey = (k: string): k is ExtraStatKey => k in EXTRA_STATS;
const isRestKey = (k: string): k is `rest-${TopCategory}` => k.startsWith("rest-");
const restCategory = (k: `rest-${TopCategory}`) => k.slice("rest-".length) as TopCategory;

/** Vergleichszeitraum für die ▲/▼-Anzeige */
const SPANS = {
  "1h": { hours: 1, label: "1 Stunde" },
  "6h": { hours: 6, label: "6 Stunden" },
  "12h": { hours: 12, label: "12 Stunden" },
  "24h": { hours: 24, label: "24 Stunden" },
  "7d": { hours: 168, label: "7 Tagen" },
} as const;
type Span = keyof typeof SPANS;

/** Alle Blöcke, Mobs und Tiere aus den Top-10-Listen der Spieler, je Kategorie nach Anzahl Spieler sortiert */
function itemOptions(players: PlayerState[]) {
  const out = new Map<TopCategory, { key: string; name: string; players: number }[]>();
  for (const c of TOP_CATEGORIES) {
    const items = new Map<string, { key: string; name: string; players: number }>();
    for (const p of players) {
      for (const e of p.detail?.tops[c] ?? []) {
        const it = items.get(e.key) ?? items.set(e.key, { key: e.key, name: e.name, players: 0 }).get(e.key)!;
        it.players += 1;
      }
    }
    out.set(c, [...items.values()].sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, "de")));
  }
  return out;
}

type Row = {
  id: string;
  name: string;
  uuid: string;
  value: number;
  at: string | null;
  online: boolean;
  afkNow?: boolean;
  playtimeSource?: ReturnType<typeof playtimeOf>["source"];
  /** Zusatz rechts neben dem Namen */
  note?: string;
};

async function Boards(props: PageProps<"/bestenlisten">) {
  const sp = await props.searchParams;
  const raw = typeof sp.liste === "string" ? sp.liste : "playtimeSeconds";
  const item = raw === "top" ? parseItemParam(typeof sp.item === "string" ? sp.item : undefined) : null;
  const key: Key | "top" = item ? "top" : isLeaderboardKey(raw) ? raw : "playtimeSeconds";
  const span: Span = typeof sp.seit === "string" && sp.seit in SPANS ? (sp.seit as Span) : "24h";
  const hours = SPANS[span].hours;
  // ▲▼ gibt es überall, wo der Tracker einen früheren Stand kennt (Twitch-Abos zählen erst seit der IRC-Erfassung)
  const hasMovement = key !== "twitchSubs";
  const [{ state, now }, ranksBefore]: [{ state: Awaited<ReturnType<typeof loadTracker>>["state"]; now: number }, Record<string, number>] = await Promise.all([
    loadTracker(),
    key === "tracked"
      ? getTrackedRanksBefore(hours)
      : isAfkKey(key)
        ? getAfkRanksBefore(hours, afkKindOf(key))
        : key === "followers"
          ? getFollowerRanksBefore(hours)
          : isBoardKey(key)
            ? getBoardRanksBefore(hours).then((r) => r[key] ?? {})
            : isExtraKey(key)
              ? getExtraRanksBefore(key, hours)
              : isRestKey(key)
                ? getTopRanksBefore(restCategory(key), hours)
                : key === "top" && item
                  ? getTopRanksBefore(item.category, hours, item.key)
                  : Promise.resolve({}),
  ]);
  const players = Object.values(state.players);
  const options = itemOptions(players);
  const itemName = item ? (options.get(item.category)?.find((o) => o.key === item.key)?.name ?? item.key) : "";
  const b: LeaderboardMeta = key === "top" ? itemBoardMeta(item!.category, itemName) : LEADERBOARDS[key];

  let rows: Row[];
  let fmt: (v: number) => string = num;
  if (key === "playtimeSeconds") {
    rows = players
      .map((p) => {
        const playtime = playtimeOf(p, now);
        return { id: p.id, name: p.name, uuid: p.uuid, value: playtime.seconds, at: null, online: p.online, playtimeSource: playtime.source };
      })
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "de"));
    fmt = (v) => boardValue("playtimeSeconds", v);
  } else if (isAfkKey(key)) {
    rows = (await getAfkBoard(afkKindOf(key))).map((r) => ({ ...r, at: null }));
    fmt = duration;
  } else if (key === "tracked") {
    rows = players
      .map((p) => ({
        id: p.id,
        name: p.name,
        uuid: p.uuid,
        value: p.trackedSeconds + (p.online && p.sessionStart ? (now - Date.parse(p.sessionStart)) / 1000 : 0),
        at: null,
        online: p.online,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);
    fmt = duration;
  } else if (key === "twitchSubs") {
    rows = await getTwitchSubscriptionBoard();
  } else if (key === "followers") {
    rows = await getFullBoard("followers");
  } else if (isBoardKey(key)) {
    rows = await getFullBoard(key);
    fmt = (v) => boardValue(key, v);
  } else if (isExtraKey(key)) {
    // Zusatzwerte: letzter Stand aus /api/player für jeden Spieler, den der Tracker je abgefragt hat
    rows = players
      .flatMap((p) => {
        const v = p.detail?.stats[key];
        return typeof v === "number" && v > 0 ? [{ id: p.id, name: p.name, uuid: p.uuid, value: v, at: p.detail!.fetchedAt, online: p.online }] : [];
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "de"));
    fmt = FORMATTERS[EXTRA_STATS[key].format];
  } else if (isRestKey(key)) {
    // Vielfalt: Gesamtwert minus Summe der eigenen Top 10
    rows = restRanking(players, restCategory(key)).map(({ player: p, rest, total }) => ({
      id: p.id,
      name: p.name,
      uuid: p.uuid,
      value: rest,
      at: p.detail!.fetchedAt,
      online: p.online,
      note: `${Math.round((rest / total) * 100)} % von ${num(total)}`,
    }));
  } else {
    // Einzelnes Item: nur Spieler, bei denen es in den eigenen Top 10 steht
    rows = itemRanking(players, item!.category, item!.key).map(({ player: p, count }) => ({
      id: p.id,
      name: p.name,
      uuid: p.uuid,
      value: count,
      at: p.detail!.fetchedAt,
      online: p.online,
    }));
  }
  const inApi = new Set((isBoardKey(key) ? (state.latest?.boards?.[key] ?? []) : []).map((e) => e.id));
  const IconCmp = Icon[b.icon as keyof typeof Icon] ?? Icon.trophy;
  // Zeitraum wechseln, ohne die gewählte Liste (bei Einzel-Items samt Item) zu verlieren
  const spanHref = (s: Span) =>
    key === "top" ? `${itemHref(item!.category, item!.key)}${s !== "24h" ? `&seit=${s}` : ""}` : boardHref(key, s);
  const meta = (e: Row) => {
    if (e.note) return e.note;
    if (isAfkKey(key)) return e.afkNow ? (key === "afk" ? "gerade AFK" : "farmt gerade") : "";
    if (key === "tracked") return e.online ? "läuft" : "";
    if (key === "playtimeSeconds") return inApi.has(e.id) ? "" : e.playtimeSource === "estimate" ? "geschätzt" : e.playtimeSource === "tracker" ? "Tracker" : "API-Wert";
    if (isBoardKey(key) && inApi.has(e.id)) return "";
    // Älter als eine Stunde: Stand dazuschreiben
    return e.at && now - Date.parse(e.at) > 3600_000 ? `Stand ${ago(e.at, now)}` : "";
  };

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Mehr als Top 10</p>
          <h1 className="t-1">Bestenlisten</h1>
          <p>
            Die API zeigt pro Spielstatistik nur zehn Namen. Der Tracker merkt sich aber jeden, der dort je aufgetaucht ist,
            mit seinem letzten bekannten Wert – auch für alle weiteren Werte aus den Spielerprofilen und einzelne Blöcke und Mobs.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="ev-filters">
            {LEADERBOARD_GROUPS.map((g) => {
              const keys = LEADERBOARD_KEYS.filter((k) => LEADERBOARDS[k].group === g.key);
              if (keys.length === 0) return null;
              return (
                <div key={g.key} className="ev-filters__row">
                  <p className="eyebrow">{g.label}</p>
                  <ul className="filters" aria-label={`Listen: ${g.label}`}>
                    {keys.map((k) => (
                      <li key={k}>
                        <Link className="tag" data-tone="white" aria-current={k === key ? "true" : undefined} href={boardHref(k, span)} title={LEADERBOARDS[k].sub}>
                          <span className="swatch" data-tone={LEADERBOARDS[k].tone} aria-hidden="true" />
                          {LEADERBOARDS[k].title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="ev-filters__row">
              <label className="eyebrow" htmlFor="item">
                Einzeln
              </label>
              <form className="ev-form" action="/bestenlisten" method="get">
              <input type="hidden" name="liste" value="top" />
              <select id="item" name="item" defaultValue={item ? `${item.category}|${item.key}` : ""}>
                <option value="" disabled>
                  Block, Mob oder Tier wählen …
                </option>
                {TOP_CATEGORIES.map((c) => (
                  <optgroup key={c} label={topCategoryLabel(c)}>
                    {(options.get(c) ?? []).map((o) => (
                      <option key={o.key} value={`${c}|${o.key}`}>
                        {o.name} ({num(o.players)})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button className="btn btn--small" data-tone="ink" type="submit">
                Zeigen
              </button>
              </form>
            </div>
          </div>
          {hasMovement && (
            <ul className="filters" aria-label="Vergleichszeitraum" style={{ marginTop: 8 }}>
              {(Object.keys(SPANS) as Span[]).map((sKey) => (
                <li key={sKey}>
                  <Link className="tag" data-tone={sKey === span ? undefined : "white"} aria-current={sKey === span ? "true" : undefined} href={spanHref(sKey)}>
                    ▲▼ vs. {SPANS[sKey].label}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <section className="box st-board" data-tone={b.tone} style={{ maxWidth: 760 }} aria-labelledby="fb-h">
            <header className="st-board__head">
              <span className="st-board__icon">
                <IconCmp aria-hidden="true" />
              </span>
              <div>
                <h2 className="t-3" id="fb-h">
                  {b.title} <span className="num">({num(rows.length)})</span>
                </h2>
                <p className="st-board__sub">{b.sub}</p>
              </div>
            </header>
            <ol className="st-board__list st-board__list--full">
              {rows.length === 0 ? (
                <li className="st-board__note">
                  Noch keiner. {key === "followers" ? "Die Liste füllt sich, sobald Follower-Zuwächse während Server-Sessions erfasst werden." : "Die Liste füllt sich, sobald Spieler in der API auftauchen."}
                </li>
              ) : (
                rows.map((e, i) => {
                  const before = ranksBefore[e.id];
                  const diff = before === undefined ? null : before - (i + 1);
                  const title = `Vor ${SPANS[span].label} Platz ${before}`;
                  return (
                    <li key={e.id}>
                      <Link className="st-board__row st-board__row--full" href={`/spieler/${encodeURIComponent(e.id)}`}>
                        <span className="st-board__rank num">{i + 1}</span>
                        <Head id={e.id} uuid={e.uuid} name={e.name} decorative />
                        <span className="st-board__name">
                          {e.name}
                          {e.online && <span className="dot" style={{ display: "inline-block", marginLeft: 8, verticalAlign: "middle" }} title="online" />}
                        </span>
                        <span className="st-board__meta">{meta(e)}</span>
                        <span className="st-board__val num">{key === "damageDealt" ? <BoardValue k={key} v={e.value} /> : fmt(e.value)}</span>
                        {!hasMovement ? (
                          <span className="st-board__mv" aria-hidden="true" />
                        ) : diff === null ? (
                          <span className="st-board__mv st-board__mv--new" title={`Vor ${SPANS[span].label} noch nicht erfasst`}>
                            neu
                          </span>
                        ) : diff > 0 ? (
                          <span className="st-board__mv st-board__mv--up num" title={title}>
                            ▲{diff}
                          </span>
                        ) : diff < 0 ? (
                          <span className="st-board__mv st-board__mv--down num" title={title}>
                            ▼{-diff}
                          </span>
                        ) : (
                          <span className="st-board__mv" aria-hidden="true" />
                        )}
                      </Link>
                    </li>
                  );
                })
              )}
            </ol>
          </section>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem", maxWidth: 760 }}>
            Bei den API-Listen ist der Wert der letzte, den der Tracker gesehen hat; der echte Wert kann inzwischen höher sein. Bei den Dauerzockern ist die Spielzeit außerhalb der API-Top-10 geschätzt oder die vom Tracker gemessene Online-Zeit. „Dauergäste“, „Standbilder“ und die AFK-Farmer misst der Tracker selbst, für alle. Weitere Werte, einzelne Blöcke und Mobs stammen aus den Spielerprofilen der API (nur Spieler, die der Tracker schon abgefragt hat; bei Blöcken und Mobs nur die eigenen Top 10). „Vielfalt“ ist der Gesamtwert ohne die eigenen Top 10. ▲▼ zeigt die Bewegung gegenüber dem Stand vor {SPANS[span].label}, „neu“ heißt: damals noch nicht in der Liste.
          </p>
        </div>
      </section>
    </>
  );
}

/** Öffnet sofort mit Überschrift und Platzhaltern; die Daten werden nachgestreamt. */
export default function Page(props: PageProps<"/bestenlisten">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Mehr als Top 10" title="Bestenlisten" />}>
      <Boards {...props} />
    </Suspense>
  );
}
