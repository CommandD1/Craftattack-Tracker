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

/** Kopf und Name eines Spielers als Link */
function Who({ id, name, uuid, role }: { id: string; name: string; uuid: string | undefined; role: "from" | "to" }) {
  return (
    <Link className="chat__who" data-role={role} href={`/spieler/${encodeURIComponent(id)}`}>
      <img className="chat__head" src={headUrl(uuid, 32, id)} alt="" width={20} height={20} loading="lazy" />
      <span className="chat__name">{name}</span>
    </Link>
  );
}

/**
 * Nachrichten von Spielern in Twitch-Chats anderer Spieler, nach Tagen gruppiert.
 * Jede Zeile zeigt Absender → Empfänger (Kanal) mit Kopf und Namen, darunter die Nachricht.
 */
export function ChatFeed({
  messages,
  uuidOf,
  nameOf = (id) => id,
  now,
  empty,
  label,
}: {
  messages: TwitchChatMessage[];
  /** Spieler-ID → Minecraft-UUID für den Kopf */
  uuidOf: (id: string) => string | undefined;
  /** Spieler-ID → Anzeigename (für „geteilt mit …") */
  nameOf?: (id: string) => string;
  now: number;
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
            {day.items.map((m) => (
              <li key={m.id} className="chat__msg">
                <p className="chat__route">
                  <Who id={m.senderId} name={m.senderName} uuid={uuidOf(m.senderId)} role="from" />
                  {/* Pfeil als SVG: die Pixel-Schrift hat kein „→" */}
                  <svg className="chat__arrow" viewBox="0 0 16 10" width={14} height={9} role="img" aria-label="schreibt im Chat von">
                    <path d="M0 4h11V1l5 4-5 4V6H0z" fill="currentColor" />
                  </svg>
                  <Who id={m.channelId} name={m.channelName} uuid={uuidOf(m.channelId)} role="to" />
                  {m.sharedWith && m.sharedWith.length > 0 && (
                    <span className="chat__shared" title={`Geteilter Chat: erschien auch bei ${m.sharedWith.map(nameOf).join(", ")}`}>
                      <span className="chat__shared-label">geteilt</span>
                      {m.sharedWith.slice(0, 4).map((id) => (
                        <Link key={id} href={`/spieler/${encodeURIComponent(id)}`} aria-label={`auch bei ${nameOf(id)}`}>
                          <img className="chat__head chat__head--small" src={headUrl(uuidOf(id), 32, id)} alt="" width={16} height={16} loading="lazy" />
                        </Link>
                      ))}
                    </span>
                  )}
                  <time className="chat__time" dateTime={m.at} title={dateTime(m.at)}>
                    {ago(m.at, now)}
                  </time>
                </p>
                <p className="chat__text">{m.message}</p>
              </li>
            ))}
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
