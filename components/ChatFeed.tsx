import Link from "next/link";
import type { TwitchChatMessage } from "@/lib/store";
import { ago, dateTime, headUrl } from "@/lib/format";

const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

function dayLabel(iso: string, now: number) {
  const key = keyFmt.format(new Date(iso));
  if (key === keyFmt.format(new Date(now))) return "Heute";
  if (key === keyFmt.format(new Date(now - 24 * 3600_000))) return "Gestern";
  return dayFmt.format(new Date(iso));
}

/**
 * Nachrichten von Spielern in Twitch-Chats anderer Spieler, nach Tagen gruppiert.
 * `show` blendet die Seite aus, die im Kontext schon klar ist (im Profil: der Spieler selbst).
 */
export function ChatFeed({
  messages,
  uuidOf,
  now,
  show = "both",
  empty,
  label,
}: {
  messages: TwitchChatMessage[];
  /** Spieler-ID → Minecraft-UUID für den Kopf */
  uuidOf: (id: string) => string | undefined;
  now: number;
  /** "both": Absender und Kanal, "channel": nur der Kanal (Absender bekannt), "sender": nur der Absender */
  show?: "both" | "channel" | "sender";
  empty: string;
  label: string;
}) {
  if (messages.length === 0) return <p className="muted chat__empty">{empty}</p>;
  const days: { label: string; items: TwitchChatMessage[] }[] = [];
  for (const m of messages) {
    const l = dayLabel(m.at, now);
    const last = days[days.length - 1];
    if (last?.label === l) last.items.push(m);
    else days.push({ label: l, items: [m] });
  }
  return (
    <ol className="chat" aria-label={label}>
      {days.map((day) => (
        <li key={day.label} className="chat__day">
          <p className="chat__daylabel">{day.label}</p>
          <ol className="chat__list">
            {day.items.map((m) => {
              const avatarId = show === "channel" ? m.channelId : m.senderId;
              return (
                <li key={m.id} className="chat__msg">
                  <img className="chat__head" src={headUrl(uuidOf(avatarId), 32, avatarId)} alt="" width={28} height={28} loading="lazy" />
                  <div className="chat__body">
                    <p className="chat__meta">
                      {show !== "channel" && (
                        <Link className="chat__who" href={`/spieler/${encodeURIComponent(m.senderId)}`}>
                          {m.senderName}
                        </Link>
                      )}
                      {show !== "sender" && (
                        <>
                          <span className="chat__in">{show === "channel" ? "im Chat von" : "bei"}</span>
                          <Link className="chat__chan" href={`/spieler/${encodeURIComponent(m.channelId)}`}>
                            {m.channelName}
                          </Link>
                        </>
                      )}
                      <time className="chat__time" dateTime={m.at} title={dateTime(m.at)}>
                        {ago(m.at, now)}
                      </time>
                    </p>
                    <p className="chat__text">{m.message}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/** Häufigste Chat-Partner als Chips mit Anzahl */
export function ChatPartners({ partners, label }: { partners: { id: string; name: string; count: number }[]; label: string }) {
  if (partners.length === 0) return null;
  return (
    <ul className="chat__partners" aria-label={label}>
      {partners.map((p) => (
        <li key={p.id}>
          <Link className="tag" href={`/spieler/${encodeURIComponent(p.id)}`}>
            {p.name} <span className="num">{p.count}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
