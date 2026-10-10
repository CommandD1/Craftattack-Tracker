import Link from "next/link";
import type { TrackerEvent } from "@/lib/types";
import { EVENT_META } from "@/lib/events";
import { headUrl, time } from "@/lib/format";
import { EVENT_ICON, Icon } from "./Icons";

const dayFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Berlin",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

export function EventRow({ e, showPlayer = true }: { e: TrackerEvent; showPlayer?: boolean }) {
  const meta = EVENT_META[e.type];
  const IconCmp = Icon[EVENT_ICON[e.type]];
  const sub = meta.sub?.(e);
  const whereLabel = e.where === "twitch" ? "Twitch" : e.where === "server" ? "Server" : "Tracker";
  const text = meta.text(e);
  const showHead = e.player && e.uuid;
  return (
    <li className="ev">
      <span className="ev__icon" data-tone={meta.tone} title={meta.label}>
        {showHead && e.type !== "death" ? (
          <img src={headUrl(e.uuid, 44)} alt="" width={44} height={44} loading="lazy" decoding="async" />
        ) : (
          <IconCmp aria-hidden="true" />
        )}
      </span>
      <div className="ev__body">
        <p className="ev__text">
          {e.player && showPlayer ? (
            <>
              <Link href={`/spieler/${encodeURIComponent(e.player)}`}>{e.playerName ?? e.player}</Link> {text}
            </>
          ) : (
            text
          )}
        </p>
        {sub && (
          <p className="ev__sub" title={sub}>
            {sub}
          </p>
        )}
      </div>
      <div className="ev__time">
        <time dateTime={e.at}>{time(e.at)}</time>
        <span className="ev__where">{whereLabel}</span>
      </div>
    </li>
  );
}

export function EventFeed({
  events,
  showPlayer = true,
  empty = "Noch nichts passiert. Der Tracker braucht erst zwei Abfragen, um Unterschiede zu sehen.",
}: {
  events: TrackerEvent[];
  showPlayer?: boolean;
  empty?: string;
}) {
  if (events.length === 0) return <p className="st-online__empty">{empty}</p>;
  const out: React.ReactNode[] = [];
  let lastDay = "";
  for (const e of events) {
    const k = dayKey.format(new Date(e.at));
    if (k !== lastDay) {
      lastDay = k;
      out.push(
        <li key={`day-${k}`} className="feed__day" aria-hidden="true">
          {dayFmt.format(new Date(e.at))}
        </li>,
      );
    }
    out.push(<EventRow key={e.id} e={e} showPlayer={showPlayer} />);
  }
  return <ol className="feed">{out}</ol>;
}
