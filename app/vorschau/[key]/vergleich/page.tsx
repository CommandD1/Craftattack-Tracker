import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { Head } from "@/components/Head";
import { PlayerSearch } from "@/components/PlayerSearch";
import { EventFeed } from "@/components/EventFeed";
import { TraitBadges, clock } from "@/components/Rhythm";
import { previewGate } from "@/lib/preview";
import { loadTracker } from "@/lib/data";
import { EVENT_META } from "@/lib/events";
import { duration, num, skinUrl } from "@/lib/format";
import { graphHref, type Metric } from "@/lib/graphQuery";
import { getComparison, suggestedPairs, type CompareData, type CompareRow } from "@/lib/playerCompare";
import type { Rhythm } from "@/lib/rhythm";
import "./vergleich.css";

export const metadata: Metadata = { title: "Spielervergleich" };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const dec = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
const one = (sp: Record<string, string | string[] | undefined>, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.toLowerCase().trim() || "";
};

async function Inner(props: PageProps<"/vorschau/[key]/vergleich">) {
  const root = await previewGate(props.params);
  const sp = await props.searchParams;
  const ida = one(sp, "a");
  const idb = one(sp, "b");
  const { state } = await loadTracker();
  const players = Object.values(state.players)
    .map((p) => ({ id: p.id, name: p.name, uuid: p.uuid, online: p.online, alias: p.twitchLogin }))
    .sort((x, y) => x.name.localeCompare(y.name, "de"));
  const nameOf = (id: string) => state.players[id]?.name ?? id;
  const data = ida && idb ? await getComparison(ida, idb) : null;
  const base = `${root}/vergleich`;
  const pairHref = (a: string, b: string) => `${base}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Vorschau · Spieler</p>
          <h1 className="t-1">Spielervergleich</h1>
          <p className="lead">Zwei Spieler Kopf an Kopf: Statistiken, Spielrhythmus und was sie miteinander verbindet.</p>
          <form className="cmp-pick" action={base} method="get">
            <PlayerSearch name="a" defaultValue={ida} label="Spieler 1" players={players} />
            <span className="cmp-pick__vs" aria-hidden="true">
              gegen
            </span>
            <PlayerSearch name="b" defaultValue={idb} label="Spieler 2" players={players} />
            <button className="btn" data-tone="gold" type="submit">
              Vergleichen
            </button>
            {data && (
              <Link className="btn btn--small" data-tone="white" href={pairHref(idb, ida)} title="Seiten tauschen">
                ⇄ Tauschen
              </Link>
            )}
          </form>
        </div>
      </section>

      {!data ? (
        <Start bad={Boolean(ida && idb)} pairs={await suggestedPairs()} nameOf={nameOf} uuidOf={(id) => state.players[id]?.uuid} hrefOf={pairHref} />
      ) : (
        <Compare d={data} nameOf={nameOf} uuidOf={(id) => state.players[id]?.uuid} />
      )}
    </>
  );
}

function Start({
  bad,
  pairs,
  nameOf,
  uuidOf,
  hrefOf,
}: {
  bad: boolean;
  pairs: { a: string; b: string; points: number }[];
  nameOf: (id: string) => string;
  uuidOf: (id: string) => string | undefined;
  hrefOf: (a: string, b: string) => string;
}) {
  return (
    <section className="block" data-tone="paper">
      <div className="wrap stack">
        {bad && <p className="box" data-tone="redstone">Diese zwei Spieler lassen sich nicht vergleichen (unbekannt oder zweimal derselbe).</p>}
        <h2 className="t-3">Starke Paare</h2>
        <p className="muted">Die engsten Verbindungen im Netz – oder oben zwei beliebige Spieler wählen.</p>
        <ul className="cmp-pairs">
          {pairs.map((p) => (
            <li key={`${p.a}|${p.b}`}>
              <Link className="box cmp-pair" data-tone="white" href={hrefOf(p.a, p.b)}>
                <span className="cmp-pair__in">
                <Head id={p.a} uuid={uuidOf(p.a)} name={nameOf(p.a)} size={28} src={32} decorative />
                <span>{nameOf(p.a)}</span>
                <span className="muted">&</span>
                <Head id={p.b} uuid={uuidOf(p.b)} name={nameOf(p.b)} size={28} src={32} decorative />
                <span>{nameOf(p.b)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Compare({ d, nameOf, uuidOf }: { d: CompareData; nameOf: (id: string) => string; uuidOf: (id: string) => string | undefined }) {
  const { a, b } = d;
  const rows = d.groups.flatMap((g) => g.rows);
  const moreA = rows.filter((r) => r.a !== null && r.b !== null && r.a > r.b).length;
  const moreB = rows.filter((r) => r.a !== null && r.b !== null && r.b > r.a).length;
  return (
    <>
      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <div className="cmp-head">
            <PlayerCard p={a} side="a" />
            <div className="cmp-head__mid">
              <p className="cmp-score num">
                <span data-side="a">{moreA}</span>
                <span className="muted">:</span>
                <span data-side="b">{moreB}</span>
              </p>
              <p className="muted cmp-score__note">Kennzahlen, bei denen einer vorne liegt (gleich oder fehlend zählt nicht)</p>
            </div>
            <PlayerCard p={b} side="b" />
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap stack">
          <div className="section-head">
            <h2 className="t-3">Kopf an Kopf</h2>
            <p className="muted">
              Unter jedem Wert: je Stunde Spielzeit ({dec(d.hoursA)} Std bzw. {dec(d.hoursB)} Std). Klick auf eine Kennzahl öffnet beide im Graphen.
            </p>
          </div>
          <div className="cmp-groups">
            {d.groups.map((g) => (
              <div key={g.key} className="box cmp-group" data-tone="white">
                <h3 className="eyebrow">{g.label}</h3>
                <ul className="cmp-rows">
                  {g.rows.map((r) => (
                    <StatRow key={r.key} r={r} d={d} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <RhythmSection d={d} />
      <TogetherSection d={d} nameOf={nameOf} uuidOf={uuidOf} />
    </>
  );
}

function PlayerCard({ p, side }: { p: CompareData["a"]; side: "a" | "b" }) {
  return (
    <Link className="cmp-card" data-side={side} href={`/spieler/${encodeURIComponent(p.id)}`}>
      <img className="cmp-card__skin" src={skinUrl(p.uuid, 256, p.id)} alt="" width={110} height={122} />
      <span className="cmp-card__name t-2">{p.name}</span>
      <span className="cmp-card__tags">
        {p.online ? (
          <span className="tag" data-tone="grass">
            <span className="dot" /> Online
          </span>
        ) : (
          <span className="tag" data-tone="paper">
            Offline
          </span>
        )}
        {p.live && (
          <span className="tag" data-tone="twitch">
            Live · {num(p.live.viewers)}
          </span>
        )}
      </span>
    </Link>
  );
}

function StatRow({ r, d }: { r: CompareRow; d: CompareData }) {
  const va = r.a ?? 0;
  const vb = r.b ?? 0;
  const sum = va + vb;
  const shareA = sum > 0 ? va / sum : 0.5;
  const lead = r.a === null || r.b === null || r.a === r.b ? null : r.a > r.b ? "a" : "b";
  const factor = lead && Math.min(va, vb) > 0 ? Math.max(va, vb) / Math.min(va, vb) : null;
  // Seltene Zähler (Tode, Totems) je 10 bzw. 100 Std, sonst stünde dort „0 / Std“
  const ph = (v: number | null, hours: number) => {
    if (!r.perHour || v === null || v === 0 || hours < 1) return null;
    const rate = v / hours;
    const per = rate >= 1 ? 1 : rate >= 0.1 ? 10 : 100;
    return `${r.show(rate * per)} / ${per === 1 ? "" : `${per} `}Std`;
  };
  const rank = (n: number | null | undefined) => (n ? <span className="cmp-rank">#{n}</span> : null);
  const label = r.metric ? (
    <Link href={graphHref(r.metric as Metric, [d.a.id, d.b.id])} title={r.hint ?? `${r.label} von beiden im Graphen öffnen`}>
      {r.label} <span aria-hidden="true">↗</span>
    </Link>
  ) : (
    <span title={r.hint}>{r.label}</span>
  );
  return (
    <li className="cmp-row" data-lead={lead ?? undefined}>
      <span className="cmp-row__val num" data-side="a">
        {rank(r.rankA)}
        <strong>{r.a !== null ? r.show(r.a) : "–"}</strong>
        <small className="muted">{ph(r.a, d.hoursA)}</small>
      </span>
      <span className="cmp-row__mid">
        <span className="cmp-row__label">{label}</span>
        <span className="cmp-bar" aria-hidden="true">
          <span style={{ width: `${shareA * 100}%` }} data-side="a" />
          <span style={{ width: `${(1 - shareA) * 100}%` }} data-side="b" />
        </span>
        {factor !== null && factor >= 1.05 && <small className="muted">{factor >= 10 ? `${num(factor)}×` : `${dec(factor)}×`}</small>}
      </span>
      <span className="cmp-row__val num" data-side="b">
        <strong>{r.b !== null ? r.show(r.b) : "–"}</strong>
        {rank(r.rankB)}
        <small className="muted">{ph(r.b, d.hoursB)}</small>
      </span>
    </li>
  );
}

/** Tagesprofil beider Spieler übereinander: Anteil der Online-Zeit je Stunde */
function HourCompare({ a, b, nameA, nameB }: { a: Rhythm; b: Rhythm; nameA: string; nameB: string }) {
  const sa = a.hours.reduce((s, v) => s + v, 0) || 1;
  const sb = b.hours.reduce((s, v) => s + v, 0) || 1;
  const na = a.hours.map((v) => v / sa);
  const nb = b.hours.map((v) => v / sb);
  const max = Math.max(...na, ...nb, 0.01);
  const W = 480;
  const H = 120;
  const x = (h: number) => (h / 24) * W;
  const y = (v: number) => H - (v / max) * (H - 8);
  const path = (vals: number[]) => vals.map((v, h) => `${h ? "L" : "M"}${x(h + 0.5).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="cmp-hours">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Tagesprofil von ${nameA} und ${nameB}`}>
        <rect x={0} y={0} width={x(6)} height={H} className="cmp-hours__night" />
        {nb.map((v, h) => (
          <rect key={`o${h}`} x={x(h) + 1} y={y(Math.min(v, na[h]))} width={W / 24 - 2} height={H - y(Math.min(v, na[h]))} className="cmp-hours__both">
            <title>{`${h}–${h + 1} Uhr: ${nameA} ${pct(na[h])}, ${nameB} ${pct(v)}`}</title>
          </rect>
        ))}
        <path d={path(na)} className="cmp-hours__line" data-side="a" />
        <path d={path(nb)} className="cmp-hours__line" data-side="b" />
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={x(h) + 2} y={H + 14} className="cmp-hours__tick">
            {h} Uhr
          </text>
        ))}
      </svg>
      <figcaption className="muted">Linien: Anteil der eigenen Online-Zeit je Stunde · Fläche: gemeinsamer Teil</figcaption>
    </figure>
  );
}

function RhythmSection({ d }: { d: CompareData }) {
  const { rhythmA: ra, rhythmB: rb } = d;
  if (!ra || !rb) return null;
  const items: { label: string; a: string; b: string }[] = [
    { label: "Spieltyp", a: "", b: "" },
    { label: "Online je aktivem Tag", a: duration(ra.minutesPerDay * 60), b: duration(rb.minutesPerDay * 60) },
    { label: "Typische Session (Median)", a: duration(ra.medianSession * 60), b: duration(rb.medianSession * 60) },
    { label: "Aktive Tage", a: `${num(ra.activeDays)} von ${num(ra.spanDays)}`, b: `${num(rb.activeDays)} von ${num(rb.spanDays)}` },
    { label: "Erster Login meist", a: ra.typicalStart !== null ? clock(ra.typicalStart) : "–", b: rb.typicalStart !== null ? clock(rb.typicalStart) : "–" },
    { label: "Stärkste Stunde", a: `${ra.peakHour}–${ra.peakHour + 1} Uhr`, b: `${rb.peakHour}–${rb.peakHour + 1} Uhr` },
    { label: "Wochenende", a: pct(ra.weekend), b: pct(rb.weekend) },
    { label: "Davon live", a: ra.liveShare !== null ? pct(ra.liveShare) : "streamt nicht", b: rb.liveShare !== null ? pct(rb.liveShare) : "streamt nicht" },
  ];
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <div className="section-head">
          <h2 className="t-3">Rhythmus</h2>
          {d.hourSimilarity !== null && (
            <p className="tag" data-tone="gold" title="Wie stark sich die Tagesprofile decken: 100 % = beide verteilen ihre Spielzeit gleich über den Tag">
              Tagesprofile decken sich zu {pct(d.hourSimilarity)}
            </p>
          )}
        </div>
        <div className="cmp-two">
          <HourCompare a={ra} b={rb} nameA={d.a.name} nameB={d.b.name} />
          <table className="cmp-table">
            <thead>
              <tr>
                <th />
                <th data-side="a">{d.a.name}</th>
                <th data-side="b">{d.b.name}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.label}>
                  <th scope="row">{it.label}</th>
                  {it.label === "Spieltyp" ? (
                    <>
                      <td>
                        <TraitBadges traits={ra.traits} max={2} />
                      </td>
                      <td>
                        <TraitBadges traits={rb.traits} max={2} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{it.a}</td>
                      <td className="num">{it.b}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const PAIR_VERB: Partial<Record<string, string>> = {
  raid: "Raids",
  death: "Kills",
  subscription_gift: "geschenkte Subs",
  chat: "Chat-Nachrichten (Auszug)",
};

function TogetherSection({ d, nameOf, uuidOf }: { d: CompareData; nameOf: (id: string) => string; uuidOf: (id: string) => string | undefined }) {
  const { a, b, together: t, link } = d;
  const types = [...new Set(d.pairEvents.map((p) => p.type))].filter((ty) => ty !== "chat");
  const countOf = (ty: string, side: "a" | "b") => d.pairEvents.find((p) => p.type === ty && p.from === side)?.count ?? 0;
  const dirRows: { label: string; ab: string; ba: string }[] = [
    { label: "Raids", ab: num(link.raidsAB), ba: num(link.raidsBA) },
    { label: "Chat-Nachrichten beim anderen", ab: num(link.msgsAB), ba: num(link.msgsBA) },
    { label: "Im Stream-Titel genannt", ab: link.titleAB ? duration(link.titleAB) : "–", ba: link.titleBA ? duration(link.titleBA) : "–" },
    ...types.filter((ty) => ty !== "raid").map((ty) => ({ label: PAIR_VERB[ty] ?? EVENT_META[ty].label, ab: num(countOf(ty, "a")), ba: num(countOf(ty, "b")) })),
  ];
  return (
    <section className="block" data-tone="paper">
      <div className="wrap stack">
        <h2 className="t-3">Miteinander</h2>
        <dl className="grid st-figs">
          <div className="box st-fig" data-tone="white">
            <dt>Gemeinsam online</dt>
            <dd className="num">{t.seconds > 0 ? duration(t.seconds) : "–"}</dd>
            <p className="muted cmp-fig__note">
              {t.sessions > 0 ? `in ${num(t.sessions)} Sessions von ${a.name}` : "Nie gleichzeitig gesehen"}
              {t.now ? " · gerade beide online" : ""}
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Anteil der Online-Zeit</dt>
            <dd className="num">
              {pct(t.shareA)} <span className="muted">/</span> {pct(t.shareB)}
            </dd>
            <p className="muted cmp-fig__note">
              So viel seiner Zeit war der andere dabei ({a.name} / {b.name})
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Platz als Mitspieler</dt>
            <dd className="num">
              {t.placeInA ? `#${t.placeInA}` : "–"} <span className="muted">/</span> {t.placeInB ? `#${t.placeInB}` : "–"}
            </dd>
            <p className="muted cmp-fig__note">
              {b.name} bei {a.name} / {a.name} bei {b.name}, nach gemeinsamer Zeit
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Im Netz</dt>
            <dd className="num">{d.hops === null ? "nicht verbunden" : d.hops === 1 ? "direkt" : `${d.hops} Schritte`}</dd>
            <p className="muted cmp-fig__note">
              {d.sameGroup === null ? "Nicht beide in einer Gruppe" : d.sameGroup ? "Gleiche Gruppe" : "Verschiedene Gruppen"}
              {link.chats > 0 ? ` · ${num(link.chats)}× geteilter Chat (${duration(link.chatSeconds)})` : ""}
            </p>
          </div>
        </dl>
        {d.hops !== null && d.hops > 1 && (
          <p className="cmp-path">
            Weg im Netz:{" "}
            {d.path.map((id, i) => (
              <span key={id}>
                {i > 0 && <span className="muted"> → </span>}
                <Link href={`/spieler/${encodeURIComponent(id)}`} className="cmp-path__who">
                  <Head id={id} uuid={uuidOf(id)} name={nameOf(id)} size={20} src={32} decorative /> {nameOf(id)}
                </Link>
              </span>
            ))}
          </p>
        )}
        <div className="cmp-two">
          <table className="cmp-table box" data-tone="white">
            <thead>
              <tr>
                <th />
                <th data-side="a">
                  {a.name} → {b.name}
                </th>
                <th data-side="b">
                  {b.name} → {a.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {dirRows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="num">{r.ab}</td>
                  <td className="num">{r.ba}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="box" data-tone="white">
            <h3 className="eyebrow">Zwischen beiden</h3>
            <div className="cmp-feed">
              <EventFeed events={d.recent} empty="Noch keine Raids, Kills, Geschenke oder Nachrichten zwischen beiden erfasst." />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/vergleich">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Spielervergleich" figs={0} />}>
      <Inner {...props} />
    </Suspense>
  );
}
