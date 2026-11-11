import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { ShowMore } from "@/components/ShowMore";
import { Head } from "@/components/Head";
import { fcBase, fcData, fcGate, who, type FcData, type FcFeedItem } from "@/lib/fitnacraft";
import { duration, num, time } from "@/lib/format";
import { FcHead, fcPlayerHref } from "../../_components/FcNav";

export const metadata: Metadata = { title: "Ereignisse" };

const TYPES: { key: string; label: string; types: FcFeedItem["t"][] }[] = [
  { key: "alle", label: "Alle", types: ["start", "end", "title", "raid", "gift", "cheer", "follow", "clip", "shared"] },
  { key: "streams", label: "Start & Ende", types: ["start", "end"] },
  { key: "titel", label: "Titel", types: ["title"] },
  { key: "raids", label: "Raids", types: ["raid"] },
  { key: "geld", label: "Geschenkte Abos & Bits", types: ["gift", "cheer"] },
  { key: "clips", label: "Clips", types: ["clip"] },
  { key: "geteilt", label: "Geteilter Chat", types: ["shared"] },
];
const ICON: Record<FcFeedItem["t"], string> = { start: "▶", end: "■", title: "✎", raid: "➜", gift: "🎁", cheer: "💎", follow: "＋", clip: "🎬", shared: "⇄" };
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

function text(d: FcData, f: FcFeedItem) {
  const n = (id: string | null) => who(d, id)?.name ?? id ?? "?";
  switch (f.t) {
    case "start":
      return (
        <>
          geht auf FitnaCraft live:{" "}
          {f.url ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer">
              „{f.v}“
            </a>
          ) : (
            `„${f.v}“`
          )}
        </>
      );
    case "end":
      return `beendet FitnaCraft nach ${duration(f.n)} (Spitze ${num(f.peak)} Zuschauer)`;
    case "title":
      return `neuer Titel: „${f.v}“`;
    case "raid":
      return `raidet ${f.toName ?? n(f.to)}${f.n ? ` mit ${num(f.n)} Zuschauern` : ""}`;
    case "gift":
      return `bekommt ${num(f.n)} Abos geschenkt${f.by ? ` von ${f.by}` : ""}`;
    case "cheer":
      return `bekommt ${num(f.n)} Bits${f.by ? ` von ${f.by}` : ""}`;
    case "follow":
      return `Follower-Schub${f.n ? `: +${num(f.n)}` : ""}`;
    case "clip":
      return (
        <>
          Clip{" "}
          <a href={f.url} target="_blank" rel="noopener noreferrer">
            „{f.v}“
          </a>{" "}
          ({num(f.n)} Aufrufe)
        </>
      );
    case "shared":
      return `geteilter Chat mit ${f.ps.filter((x) => x !== f.p).map(n).join(", ")}`;
  }
}

async function Feed(props: PageProps<"/fitnacraft/[key]/ereignisse">) {
  const key = await fcGate(props.params);
  const sp = await props.searchParams;
  const d = await fcData();
  const base = fcBase(key);
  const filter = TYPES.find((t) => t.key === sp.typ) ?? TYPES[0];
  const spieler = typeof sp.spieler === "string" ? sp.spieler : null;
  const items = d.feed.filter((f) => filter.types.includes(f.t) && (!spieler || f.p === spieler));
  const LIMIT = 500;
  const byDay = new Map<string, FcFeedItem[]>();
  for (const f of items.slice(0, LIMIT)) {
    const k = dayKey.format(f.at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(f);
  }
  const href = (typ: string, sp2: string | null) => {
    const q = new URLSearchParams();
    if (typ !== "alle") q.set("typ", typ);
    if (sp2) q.set("spieler", sp2);
    const s = q.toString();
    return `${base}/ereignisse${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <FcHead k={key} d={d} tab="/ereignisse" title="Ereignisse">
        <p>Alles, was auf Twitch rund um FitnaCraft passiert ist: Starts, Titel, Raids, große Abo-Geschenke und Cheers, geteilte Chats und die meistgesehenen Clips.</p>
      </FcHead>
      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <ul className="filters" aria-label="Art">
            {TYPES.map((t) => (
              <li key={t.key}>
                <Link className="tag" href={href(t.key, spieler)} aria-current={t.key === filter.key ? "true" : undefined}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="filters" aria-label="Spieler">
            <li>
              <Link className="tag" href={href(filter.key, null)} aria-current={!spieler ? "true" : undefined}>
                Alle Spieler
              </Link>
            </li>
            {d.players.map((p) => (
              <li key={p.id}>
                <Link className="tag" href={href(filter.key, p.id)} aria-current={spieler === p.id ? "true" : undefined}>
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
          <div className="box" data-tone="white">
            <p className="muted">
              {num(items.length)} Ereignisse{items.length > LIMIT ? ` – die neuesten ${LIMIT} stehen hier, ältere über die Filter` : ""}. Geschenke ab 10 Abos, Cheers ab 1.000 Bits.
            </p>
            <ShowMore height={1400} label="Ereignisse">
              {[...byDay].map(([day, list]) => (
                <div key={day}>
                  <h3 className="t-3 fc-feed__day">{dayFmt.format(Date.parse(`${day}T12:00:00Z`))}</h3>
                  <ul className="fc-feed">
                    {list.map((f, i) => {
                      const w = who(d, f.p);
                      return (
                        <li key={`${f.at}-${f.t}-${i}`}>
                          <span className="num muted">{time(new Date(f.at).toISOString())}</span>
                          <span>
                            <span aria-hidden="true">{ICON[f.t]}</span>{" "}
                            {w && (
                              <Link className="fc-who" href={fcPlayerHref(key, w.id)}>
                                <Head id={w.id} uuid={w.uuid} name={w.name} size={18} decorative /> <b>{w.name}</b>
                              </Link>
                            )}{" "}
                            {text(d, f)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </ShowMore>
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/ereignisse">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Ereignisse" />}>
      <Feed {...props} />
    </Suspense>
  );
}
