import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { getFullBoard } from "@/lib/store";
import { BOARD_KEYS, type BoardKey } from "@/lib/types";
import { ago, boardValue, duration, headUrl, num } from "@/lib/format";
import { BOARD_ICON, Icon } from "@/components/Icons";

// Kein Skeleton: die Seite wird komplett auf dem Server gerendert (SSR) und blockiert bis die Daten da sind.
export const instant = false;

export const metadata: Metadata = { title: "Bestenlisten" };

const BOARDS: Record<BoardKey | "tracked", { title: string; sub: string; tone: string }> = {
  playtimeSeconds: { title: "Dauerzocker", sub: "Spielzeit laut API", tone: "sky" },
  diamonds: { title: "Diamantenbank", sub: "Diamanten", tone: "diamond" },
  deaths: { title: "Friedhof", sub: "Tode", tone: "redstone" },
  blocksBroken: { title: "Abrissbirne", sub: "Abgebaute Blöcke", tone: "gold" },
  mobsKilled: { title: "Monsterjäger", sub: "Erledigte Mobs", tone: "grass" },
  distance: { title: "Weltenbummler", sub: "Gelaufene Strecke", tone: "pink" },
  tracked: { title: "Dauergäste", sub: "Online-Zeit laut Tracker, alle Spieler", tone: "lava" },
};
const KEYS = [...BOARD_KEYS, "tracked"] as const;
type Key = (typeof KEYS)[number];

export default async function Page(props: PageProps<"/bestenlisten">) {
  const sp = await props.searchParams;
  const raw = typeof sp.liste === "string" ? sp.liste : "playtimeSeconds";
  const key: Key = (KEYS as readonly string[]).includes(raw) ? (raw as Key) : "playtimeSeconds";
  const { state, now } = await loadTracker();
  const b = BOARDS[key];

  let rows: { id: string; name: string; uuid: string; value: number; at: string | null; online: boolean }[];
  if (key === "tracked") {
    rows = Object.values(state.players)
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
  } else {
    rows = await getFullBoard(key);
  }
  const inApi = new Set((key === "tracked" ? [] : state.latest?.boards?.[key] ?? []).map((e) => e.id));
  const fmt = (v: number) => (key === "tracked" ? duration(v) : boardValue(key, v));
  const IconCmp = key === "tracked" ? Icon.users : Icon[BOARD_ICON[key]];

  return (
    <>
      <section className="block page-head" data-tone={b.tone}>
        <div className="wrap">
          <p className="eyebrow">Mehr als Top 10</p>
          <h1 className="t-1">Bestenlisten</h1>
          <p>
            Die API zeigt pro Liste nur zehn Namen. Der Tracker merkt sich aber jeden, der dort je aufgetaucht ist,
            mit seinem letzten bekannten Wert. So wächst jede Liste mit der Zeit über die Top 10 hinaus.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <ul className="filters" aria-label="Liste wählen">
            {KEYS.map((k) => (
              <li key={k}>
                <Link className="tag" data-tone={k === key ? undefined : BOARDS[k].tone} aria-current={k === key ? "true" : undefined} href={k === "playtimeSeconds" ? "/bestenlisten" : `/bestenlisten?liste=${k}`}>
                  {BOARDS[k].title}
                </Link>
              </li>
            ))}
          </ul>

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
                <li className="st-board__note">Noch keiner. Die Liste füllt sich, sobald Spieler in der API auftauchen.</li>
              ) : (
                rows.map((e, i) => (
                  <li key={e.id}>
                    <Link className="st-board__row st-board__row--full" href={`/spieler/${encodeURIComponent(e.id)}`}>
                      <span className="st-board__rank num">{i + 1}</span>
                      <img className="head" src={headUrl(e.uuid, 28, e.id)} alt="" width={28} height={28} loading="lazy" />
                      <span className="st-board__name">
                        {e.name}
                        {e.online && <span className="dot" style={{ display: "inline-block", marginLeft: 8, verticalAlign: "middle" }} title="online" />}
                      </span>
                      <span className="st-board__meta">
                        {key === "tracked" ? (e.online ? "läuft" : "") : inApi.has(e.id) ? "aktuell" : e.at ? `Stand ${ago(e.at, now)}` : ""}
                      </span>
                      <span className="st-board__val num">{fmt(e.value)}</span>
                    </Link>
                  </li>
                ))
              )}
            </ol>
          </section>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem", maxWidth: 760 }}>
            „Aktuell“ heißt: steht gerade in der Top 10 der API. Bei allen anderen ist der Wert der letzte, den der
            Tracker gesehen hat, der echte Wert kann inzwischen höher sein. „Dauergäste“ misst der Tracker selbst, für alle.
          </p>
        </div>
      </section>
    </>
  );
}
