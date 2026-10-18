import Link from "next/link";
import { BOARD_KEYS, type BoardKey, type EventType, type TrackerEvent } from "@/lib/types";
import { EVENT_META, eventBadge } from "@/lib/events";
import { headUrl, time } from "@/lib/format";
import { BOARD_ICON, EVENT_ICON, Icon } from "./Icons";

const dayFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Berlin",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

function combineGiftSubscriptions(events: TrackerEvent[]): TrackerEvent[] {
  const combined: TrackerEvent[] = [];
  const giftIndexes = new Map<string, number>();

  for (const event of events) {
    const giver = event.meta?.giftGiverPlayerId;
    if (event.type !== "subscription_gift" || typeof giver !== "string") {
      combined.push(event);
      continue;
    }

    const key = JSON.stringify([
      event.player,
      event.meta?.channel,
      event.meta?.streamStartedAt,
      giver,
      Math.floor(Date.parse(event.at) / 60_000),
    ]);
    const existingIndex = giftIndexes.get(key);
    if (existingIndex === undefined) {
      giftIndexes.set(key, combined.length);
      combined.push(event);
      continue;
    }

    const existing = combined[existingIndex];
    const delta = (existing.delta ?? 0) + (event.delta ?? 0);
    combined[existingIndex] = {
      ...existing,
      delta,
      value: (existing.value ?? 0) + (event.value ?? event.delta ?? 0),
      meta: { ...existing.meta, giftCount: delta },
    };
  }

  return combined;
}

/** Ereignisse ohne Spieler: das Typ-Icon ersetzt den Kopf */
const SERVER_TYPES = new Set<EventType>(["server_online", "server_offline", "tracker_start", "record"]);

/** Kurzer Zusatz rechts neben dem Wert, nur wenn er woanders nicht steht */
function detail(e: TrackerEvent): string | null {
  switch (e.type) {
    case "stream_start":
    case "stream_title":
      return e.meta?.title ? String(e.meta.title) : null;
    case "record":
      return e.meta?.label ? String(e.meta.label) : null;
    case "server_online":
      return "Server online";
    case "server_offline":
      return "Server offline";
    case "tracker_start":
      return "Tracker gestartet";
    case "first_join":
      return "Neu";
    case "death":
      return typeof e.meta?.killerName === "string"
        ? `Von ${e.meta.killerName}`
        : e.meta?.unknown
          ? "unbekannt"
          : e.meta?.inferred
            ? "zugeordnet"
            : null;
    case "achievement":
      return typeof e.meta?.title === "string" ? e.meta.title : null;
    // Zähler: die kleinen Icons sind nicht eindeutig, daher ein Wort dazu
    case "diamonds":
      return "Diamanten";
    case "blocksBroken":
      return "Blöcke abgebaut";
    case "mobsKilled":
      return "Mobs";
    case "distance":
      return "gelaufen";
    case "damageDealt":
      return "Schaden verursacht";
    case "totemsUsed":
      return "Totems benutzt";
    case "foodEaten":
      return "Essen gegessen";
    case "afk_start":
      return "AFK";
    case "afk_mobs_start":
      return "AFK Mobs";
    case "afk_mobs_end":
      return "AFK Mobs Ende";
    case "afk_blocks_start":
      return "AFK Blöcke";
    case "afk_blocks_end":
      return "AFK Blöcke Ende";
    default:
      return null;
  }
}

/** Kompakte Kachel für ein Ereignis. Der volle Satz steht im Tooltip. */
export function EventTile({ e, showPlayer = true }: { e: TrackerEvent; showPlayer?: boolean }) {
  const meta = EVENT_META[e.type];
  const IconCmp = Icon[EVENT_ICON[e.type]];
  const sub = meta.sub?.(e);
  const text = meta.text(e);
  const sentence = [e.player ? `${e.playerName ?? e.player} ${text}` : text, sub].filter(Boolean).join(" · ");
  const badge = e.type === "stream_title" ? null : eventBadge(e);
  const info = detail(e);
  const vod = typeof e.meta?.vodUrl === "string" ? e.meta.vodUrl : null;
  const liveUrl = typeof e.meta?.liveUrl === "string" ? e.meta.liveUrl : null;
  const link = liveUrl ? { href: liveUrl, title: "Läuft gerade – Stream auf Twitch ansehen", live: true } : vod ? { href: vod, title: e.type === "death" ? "Diesen Moment im VOD ansehen" : "Aufzeichnung auf Twitch ansehen", live: false } : null;
  const withHead = Boolean(e.player) && !SERVER_TYPES.has(e.type);
  const offServer = e.type === "stream_start" && e.meta?.onServer === false;
  // Rang / Meilenstein: statt des Listennamens nur das Icon der Liste (Name steht im Tooltip)
  const board = (e.type === "rank" || e.type === "milestone") && BOARD_KEYS.includes(e.meta?.board as BoardKey) ? (e.meta!.board as BoardKey) : null;
  const BoardIcon = board ? Icon[BOARD_ICON[board]] : null;

  return (
    <li className="tile" data-tone={meta.tone} data-type={e.type} title={`${time(e.at)} · ${sentence}`}>
      {withHead && showPlayer ? (
        <Link className="tile__head" href={`/spieler/${encodeURIComponent(e.player!)}`} aria-label={e.playerName ?? e.player}>
          <img src={headUrl(e.uuid, 32, e.player)} alt="" width={32} height={32} loading="lazy" decoding="async" />
        </Link>
      ) : null}
      {e.type === "subscription_gift" && showPlayer && typeof e.meta?.giftGiverPlayerId === "string" && (
        <Link
          className="tile__head tile__head--gift"
          href={`/spieler/${encodeURIComponent(e.meta.giftGiverPlayerId)}`}
          aria-label={`Geschenk von ${String(e.meta.giftGiverName ?? e.meta.giftGiverPlayerId)}`}
          title={`Geschenk von ${String(e.meta.giftGiverName ?? e.meta.giftGiverPlayerId)}`}
        >
          <img
            src={headUrl(typeof e.meta.giftGiverUuid === "string" ? e.meta.giftGiverUuid : undefined, 32, e.meta.giftGiverPlayerId)}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
          />
        </Link>
      )}
      {e.type === "raid" && showPlayer && typeof e.meta?.raidTargetPlayerId === "string" && (
        <Link
          className="tile__head tile__head--raid-target"
          href={`/spieler/${encodeURIComponent(e.meta.raidTargetPlayerId)}`}
          aria-label={`Raid-Ziel: ${String(e.meta.raidTargetName ?? e.meta.raidTargetPlayerId)}`}
          title={`Raid-Ziel: ${String(e.meta.raidTargetName ?? e.meta.raidTargetPlayerId)}`}
        >
          <img
            src={headUrl(typeof e.meta.raidTargetUuid === "string" ? e.meta.raidTargetUuid : undefined, 32, e.meta.raidTargetPlayerId)}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
          />
        </Link>
      )}
      <Link className="tile__icon" data-tone={meta.tone} href={`/ereignisse?t=${e.type}`} aria-label={meta.label} title={`Nur „${meta.label}“ zeigen`}>
        <IconCmp aria-hidden="true" />
      </Link>
      {badge && <span className="tile__val num">{badge}</span>}
      {info && <span className="tile__info">{info}</span>}
      {BoardIcon && (
        <span className="tile__board" title={e.meta?.label ? String(e.meta.label) : undefined}>
          <BoardIcon aria-hidden="true" />
        </span>
      )}
      {offServer && (
        <span className="tile__flag" title="Nicht auf dem Server">
          ⌂
        </span>
      )}
      {link && (
        <a className="tile__link" href={link.href} target="_blank" rel="noopener" title={link.title} aria-label={link.title}>
          {link.live ? <span className="dot dot--live" /> : <Icon.twitch aria-hidden="true" />}
        </a>
      )}
      <span className="sr-only">{sentence}</span>
    </li>
  );
}

/** Feed: links die Minute, rechts alle Ereignisse dieser Minute als Kacheln. */
export function EventFeed({
  events,
  showPlayer = true,
  empty = "Noch nichts passiert. Der Tracker braucht erst zwei Abfragen, um Unterschiede zu sehen.",
  getTimeState,
}: {
  events: TrackerEvent[];
  showPlayer?: boolean;
  empty?: string;
  getTimeState?: (at: string) => { server: boolean; live: boolean; href?: string };
}) {
  if (events.length === 0) return <p className="st-online__empty">{empty}</p>;
  const visibleEvents = combineGiftSubscriptions(events);
  const out: React.ReactNode[] = [];
  let lastDay = "";
  let lastMin = "";
  let bucket: TrackerEvent[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    const first = bucket[0];
    const timeState = getTimeState?.(first.at);
    const presence = timeState ? (timeState.server && timeState.live ? "both" : timeState.server ? "server" : timeState.live ? "live" : "none") : undefined;
    const timeTitle = timeState
      ? `${timeState.server ? "Auf dem Server" : "Nicht auf dem Server"} · ${timeState.live ? "Live auf Twitch" : "Nicht live"}${timeState.href ? " · Im VOD ansehen" : ""}`
      : undefined;
    out.push(
      <li key={`m-${first.id}`} className="feed__min">
        {timeState?.href ? (
          <a className="feed__time" data-presence={presence} href={timeState.href} target="_blank" rel="noopener noreferrer" title={timeTitle} aria-label={`${time(first.at)} · ${timeTitle}`}>
            {time(first.at)}
          </a>
        ) : (
          <time className="feed__time" data-presence={presence} dateTime={first.at} title={timeTitle}>
            {time(first.at)}
          </time>
        )}
        <ul className="tiles">
          {bucket.map((e) => (
            <EventTile key={e.id} e={e} showPlayer={showPlayer} />
          ))}
        </ul>
      </li>,
    );
    bucket = [];
  };
  for (const e of visibleEvents) {
    const d = new Date(e.at);
    const k = dayKey.format(d);
    const m = `${k} ${time(e.at)}`;
    if (m !== lastMin) {
      flush();
      lastMin = m;
    }
    if (k !== lastDay) {
      lastDay = k;
      out.push(
        <li key={`day-${k}`} className="feed__day" aria-hidden="true">
          {dayFmt.format(d)}
        </li>,
      );
    }
    bucket.push(e);
  }
  flush();
  return <ol className="feed">{out}</ol>;
}
