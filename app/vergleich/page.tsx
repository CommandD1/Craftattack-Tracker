import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { Head } from "@/components/Head";
import { Icon } from "@/components/Icons";
import { PlayerSearch } from "@/components/PlayerSearch";
import { EventFeed } from "@/components/EventFeed";
import { TraitBadges, clock } from "@/components/Rhythm";
import { loadTracker } from "@/lib/data";
import { compareHref } from "@/lib/compareHref";
import { EVENT_META } from "@/lib/events";
import { ROLE_LABEL } from "@/lib/groups";
import { duration, num, skinUrl } from "@/lib/format";
import { graphHref, type Metric } from "@/lib/graphQuery";
import { STRENGTH_MIN_HOURS, getComparison, leadOf, startData, type CompareData, type CompareRow, type Friend, type Strength, type ViewerSide } from "@/lib/playerCompare";
import type { Rhythm } from "@/lib/rhythm";
import { getThirdParties, type AudienceKind, type CircleKey, type CircleList } from "@/lib/thirdParties";
import "./vergleich.css";

export const metadata: Metadata = {
  title: "Spielervergleich",
  description: "Zwei CraftAttack-Spieler Kopf an Kopf: Statistiken, Rhythmus, Netz, gemeinsame Dritte, Zuschauer und Fortschritte.",
};

const pct = (v: number) => `${Math.round(v * 100)} %`;
const dec = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
const pctFine = (v: number) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: v < 0.1 ? 1 : 0 }).format(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.round(Math.abs(v) * 100)} %`;
const dayLabel = (d: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const one = (sp: Record<string, string | string[] | undefined>, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.toLowerCase().trim() || "";
};

/** Namen und Köpfe für alle Abschnitte */
interface Names {
  nameOf: (id: string) => string;
  uuidOf: (id: string) => string | undefined;
  /** Vergleich zweier Spieler auf dieser Seite */
  pair: (a: string, b: string) => string;
}

async function Inner(props: PageProps<"/vergleich">) {
  const sp = await props.searchParams;
  const ida = one(sp, "a");
  const idb = one(sp, "b");
  const { state } = await loadTracker();
  const players = Object.values(state.players)
    .map((p) => ({ id: p.id, name: p.name, uuid: p.uuid, online: p.online, alias: p.twitchLogin }))
    .sort((x, y) => x.name.localeCompare(y.name, "de"));
  const base = "/vergleich";
  const names: Names = {
    nameOf: (id) => state.players[id]?.name ?? id,
    uuidOf: (id) => state.players[id]?.uuid,
    pair: (a, b) => compareHref(a, b),
  };
  const data = ida && idb ? await getComparison(ida, idb) : null;

  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Spieler</p>
          <h1 className="t-1">Spielervergleich</h1>
          <p className="lead">Zwei Spieler Kopf an Kopf: was sie gleich und was sie unterschiedlich macht – Statistiken, Rhythmus, Netz, Zuschauer und Fortschritte.</p>
        </div>
        {/* Eigener Container: im Titel-Raster würden die Vorschläge der Suche die Beschreibung zusammendrücken */}
        <div className="wrap">
          <form className="cmp-pick" action={base} method="get">
            <div className="cmp-pick__field">
              <PlayerSearch name="a" defaultValue={ida} label="Spieler 1" players={players} />
            </div>
            <span className="cmp-pick__vs" aria-hidden="true">
              gegen
            </span>
            <div className="cmp-pick__field">
              <PlayerSearch name="b" defaultValue={idb} label="Spieler 2" players={players} />
            </div>
            <div className="cmp-pick__go">
              <button className="btn" data-tone="gold" type="submit">
                Vergleichen
              </button>
              {data && (
                <Link className="btn btn--small" data-tone="white" href={names.pair(idb, ida)} title="Seiten tauschen">
                  ⇄ Tauschen
                </Link>
              )}
            </div>
          </form>
        </div>
      </section>

      {!data ? <Start bad={Boolean(ida && idb)} focus={ida && !idb && state.players[ida] ? ida : undefined} names={names} /> : <Compare d={data} names={names} />}
    </>
  );
}

/* ------------------------------------------------------------------ Einstieg */

async function Start({ bad, focus, names }: { bad: boolean; focus?: string; names: Names }) {
  const { pairs, strongest, of } = await startData(8, focus);
  const top = strongest[0];
  return (
    <section className="block" data-tone="paper">
      <div className="wrap stack" style={{ "--stack": "28px" } as React.CSSProperties}>
        {bad && (
          <p className="box" data-tone="redstone">
            Diese zwei Spieler lassen sich nicht vergleichen (unbekannt oder zweimal derselbe).
          </p>
        )}
        <div className="cmp-two">
          <div className="box" data-tone="white">
            <h2 className="t-3 cmp-h">
              <Icon.crown width={22} height={22} aria-hidden="true" /> Stärkste Spieler
            </h2>
            <p className="muted cmp-note">
              Für jede Kennzahl zählt, wie viele Spieler man übertrifft; die Stärke ist der Schnitt darüber. Bei Toden, erlittenem Schaden, Totems und AFK zählt umgekehrt, wie viele man
              unterbietet. Nur Spieler ab {STRENGTH_MIN_HOURS} Std Spielzeit ({num(of)} Spieler).
            </p>
            <ol className="cmp-strong">
              {strongest.map((s, i) => (
                <li key={s.id}>
                  <span className="cmp-strong__place num">{s.place}</span>
                  <Head id={s.id} uuid={names.uuidOf(s.id)} name={names.nameOf(s.id)} size={28} src={32} decorative />
                  <span className="cmp-strong__who">
                    <Link href={`/spieler/${encodeURIComponent(s.id)}`}>{names.nameOf(s.id)}</Link>
                    <small className="muted">stärkste Kennzahl: {s.best.label}</small>
                  </span>
                  <span className="cmp-strong__bar" title={`Übertrifft im Schnitt ${pct(s.score)} der Spieler`}>
                    <span style={{ width: `${s.score * 100}%` }} />
                  </span>
                  <span className="num cmp-strong__score">{pct(s.score)}</span>
                  {focus ? (
                    s.id !== focus && (
                      <Link className="btn btn--small" data-tone="white" href={names.pair(focus, s.id)} title={`${names.nameOf(focus)} mit ${names.nameOf(s.id)} vergleichen`}>
                        Vergleichen
                      </Link>
                    )
                  ) : top && strongest.length > 1 && (
                    <Link
                      className="btn btn--small"
                      data-tone="white"
                      href={names.pair(s.id, i === 0 ? strongest[1].id : top.id)}
                      title={i === 0 ? "Mit Platz 2 vergleichen" : `Mit ${names.nameOf(top.id)} vergleichen`}
                    >
                      Vergleichen
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="box" data-tone="white">
            <h2 className="t-3 cmp-h">
              <Icon.users width={22} height={22} aria-hidden="true" /> {focus ? `Engste Verbindungen von ${names.nameOf(focus)}` : "Engste Paare"}
            </h2>
            <p className="muted cmp-note">
              {focus
                ? "Mit wem er im Netz am meisten zu tun hat (Raids, geteilte Chats, Titel, Chat-Nachrichten) – oder oben Spieler 2 wählen."
                : "Die stärksten Verbindungen im Netz (Raids, geteilte Chats, Titel, Chat-Nachrichten) – oder oben zwei beliebige Spieler wählen."}
            </p>
            {focus && !pairs.length && <p className="muted">Keine Verbindungen im Netz.</p>}
            <ul className="cmp-pairs">
              {pairs.map((p) => (
                <li key={`${p.a}|${p.b}`}>
                  <Link className="cmp-pair" href={names.pair(p.a, p.b)}>
                    <Head id={p.a} uuid={names.uuidOf(p.a)} name={names.nameOf(p.a)} size={24} src={32} decorative />
                    <span>{names.nameOf(p.a)}</span>
                    <span className="muted">&</span>
                    <Head id={p.b} uuid={names.uuidOf(p.b)} name={names.nameOf(p.b)} size={24} src={32} decorative />
                    <span>{names.nameOf(p.b)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Vergleich */

function Compare({ d, names }: { d: CompareData; names: Names }) {
  const { a, b } = d;
  const leads = d.groups.flatMap((g) => g.rows).map(leadOf);
  const moreA = leads.filter((x) => x === "a").length;
  const moreB = leads.filter((x) => x === "b").length;
  return (
    <>
      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <div className="cmp-head">
            <PlayerCard p={a} side="a" s={d.strengthA} of={d.strengthOf} />
            <div className="cmp-head__mid">
              <p className="cmp-score num">
                <span data-side="a">{moreA}</span>
                <span className="muted">:</span>
                <span data-side="b">{moreB}</span>
              </p>
              <p className="muted cmp-score__note">Kennzahlen, bei denen einer vorne liegt. Bei Toden, erlittenem Schaden, Totems und AFK gewinnt, wer weniger hat; Gleichstand und fehlende Werte zählen nicht.</p>
            </div>
            <PlayerCard p={b} side="b" s={d.strengthB} of={d.strengthOf} />
          </div>
        </div>
      </section>

      <InsightSection d={d} />

      <section className="block" data-tone="paper">
        <div className="wrap stack">
          <div className="section-head">
            <h2 className="t-3">Kopf an Kopf</h2>
            <p className="muted">
              Unter jedem Wert: je Stunde Spielzeit ({dec(d.hoursA)} bzw. {dec(d.hoursB)} Std). ↓ = weniger ist besser. Klick auf eine Kennzahl öffnet beide im Graphen.
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
      <NetworkSection d={d} names={names} />
      <Suspense fallback={null}>
        <ThirdSection d={d} names={names} />
      </Suspense>
      <ViewerSection d={d} names={names} />
      <AdvSection d={d} />
      <TogetherSection d={d} />
    </>
  );
}

function PlayerCard({ p, side, s, of }: { p: CompareData["a"]; side: "a" | "b"; s: Strength | null; of: number }) {
  return (
    <div className="cmp-card" data-side={side}>
      <Link href={`/spieler/${encodeURIComponent(p.id)}`} className="cmp-card__link">
        <img className="cmp-card__skin" src={skinUrl(p.uuid, 256, p.id)} alt="" width={110} height={122} />
        <span className="cmp-card__name t-2">{p.name}</span>
      </Link>
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
        {s && (
          <span className="tag" data-tone="gold" title={`Gesamtstärke: übertrifft im Schnitt ${pct(s.score)} der Spieler · stärkste Kennzahl ${s.best.label}`}>
            <Icon.crown width={14} height={14} aria-hidden="true" /> Stärke #{s.place} / {of}
          </span>
        )}
      </span>
    </div>
  );
}

function InsightSection({ d }: { d: CompareData }) {
  const same = d.insights.filter((i) => i.kind === "gleich").slice(0, 7);
  const diff = d.insights.filter((i) => i.kind === "anders").slice(0, 7);
  if (!same.length && !diff.length) return null;
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <h2 className="t-3">Gemeinsamkeiten und Unterschiede</h2>
        <p className="muted">Automatisch aus allen Abschnitten unten herausgesucht, das Auffälligste zuerst.</p>
        <div className="cmp-two">
          <div className="box cmp-ins" data-tone="paper" data-kind="gleich">
            <h3 className="eyebrow">Gleich</h3>
            <ul>{same.length ? same.map((i) => <li key={i.text}>{i.text}</li>) : <li className="muted">Nichts, was besonders auffällt.</li>}</ul>
          </div>
          <div className="box cmp-ins" data-tone="paper" data-kind="anders">
            <h3 className="eyebrow">Unterschiedlich</h3>
            <ul>{diff.length ? diff.map((i) => <li key={i.text}>{i.text}</li>) : <li className="muted">Nichts, was besonders auffällt.</li>}</ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatRow({ r, d }: { r: CompareRow; d: CompareData }) {
  const va = r.a ?? 0;
  const vb = r.b ?? 0;
  const sum = va + vb;
  const shareA = sum > 0 ? va / sum : 0.5;
  const lead = leadOf(r);
  const factor = r.a !== null && r.b !== null && r.a !== r.b && Math.min(va, vb) > 0 ? Math.max(va, vb) / Math.min(va, vb) : null;
  // Seltene Zähler (Tode, Totems) je 10 bzw. 100 Std, sonst stünde dort „0 / Std“
  const ph = (v: number | null, hours: number) => {
    if (!r.perHour || v === null || v === 0 || hours < 1) return null;
    const rate = v / hours;
    const per = rate >= 1 ? 1 : rate >= 0.1 ? 10 : rate >= 0.01 ? 100 : 1000;
    return `${r.show(rate * per)} / ${per === 1 ? "" : `${per} `}Std`;
  };
  const rank = (n: number | null | undefined) => (n ? <span className="cmp-rank">#{n}</span> : null);
  const IconCmp = r.icon ? Icon[r.icon] : null;
  const text = (
    <>
      {IconCmp && <IconCmp width={16} height={16} aria-hidden="true" />}
      <span>{r.label}</span>
      {r.win === "weniger" && <span aria-label="weniger ist besser">↓</span>}
    </>
  );
  const label = r.metric ? (
    <Link href={graphHref(r.metric as Metric, [d.a.id, d.b.id])} title={r.hint ?? `${r.label} von beiden im Graphen öffnen`}>
      {text} <span aria-hidden="true">↗</span>
    </Link>
  ) : (
    <span title={r.hint}>{text}</span>
  );
  return (
    <li className="cmp-row" data-lead={lead ?? undefined} data-neutral={r.win ? undefined : ""} title={r.win === "weniger" ? "Weniger ist hier besser" : r.win ? undefined : "Zählt nicht zum Stand"}>
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

/** Tabelle a | b mit Kopfzeile in den Spielerfarben */
function SideTable({ d, rows, head }: { d: CompareData; rows: { label: React.ReactNode; a: React.ReactNode; b: React.ReactNode; hint?: string }[]; head?: [React.ReactNode, React.ReactNode] }) {
  return (
    <table className="cmp-table">
      <thead>
        <tr>
          <th />
          <th data-side="a">{head?.[0] ?? d.a.name}</th>
          <th data-side="b">{head?.[1] ?? d.b.name}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={r.hint}>
            <th scope="row">{r.label}</th>
            <td className="num">{r.a}</td>
            <td className="num">{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ Rhythmus */

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
          <rect key={h} x={x(h) + 1} y={y(Math.min(v, na[h]))} width={W / 24 - 2} height={H - y(Math.min(v, na[h]))} className="cmp-hours__both">
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
  const parts = (r: Rhythm) => [r.parts.night, r.parts.morning, r.parts.day, r.parts.evening].map((v) => Math.round(v * 100)).join(" / ");
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <div className="section-head">
          <h2 className="t-3 cmp-h">
            <Icon.clock width={22} height={22} aria-hidden="true" /> Rhythmus
          </h2>
          {d.hourSimilarity !== null && (
            <p className="tag" data-tone="gold" title="Wie stark sich die Tagesprofile decken: 100 % = beide verteilen ihre Spielzeit gleich über den Tag">
              Tagesprofile decken sich zu {pct(d.hourSimilarity)}
            </p>
          )}
        </div>
        <div className="cmp-two">
          <HourCompare a={ra} b={rb} nameA={d.a.name} nameB={d.b.name} />
          <SideTable
            d={d}
            rows={[
              { label: "Spieltyp", a: <TraitBadges traits={ra.traits} max={2} />, b: <TraitBadges traits={rb.traits} max={2} /> },
              { label: "Online je aktivem Tag", a: duration(ra.minutesPerDay * 60), b: duration(rb.minutesPerDay * 60) },
              { label: "Typische Session (Median)", a: duration(ra.medianSession * 60), b: duration(rb.medianSession * 60) },
              { label: "Sessions je Tag", a: dec(ra.perDay), b: dec(rb.perDay) },
              { label: "Aktive Tage", a: `${num(ra.activeDays)} von ${num(ra.spanDays)}`, b: `${num(rb.activeDays)} von ${num(rb.spanDays)}` },
              { label: "Erster Login meist", a: ra.typicalStart !== null ? clock(ra.typicalStart) : "–", b: rb.typicalStart !== null ? clock(rb.typicalStart) : "–" },
              { label: "Stärkste Stunde", a: `${ra.peakHour}–${ra.peakHour + 1} Uhr`, b: `${rb.peakHour}–${rb.peakHour + 1} Uhr` },
              { label: "Nacht / Morgen / Tag / Abend (%)", a: parts(ra), b: parts(rb), hint: "Anteile der Online-Zeit: 0–6, 6–12, 12–18, 18–24 Uhr" },
              { label: "Wochenende", a: pct(ra.weekend), b: pct(rb.weekend) },
              { label: "Davon live", a: ra.liveShare !== null ? pct(ra.liveShare) : "streamt nicht", b: rb.liveShare !== null ? pct(rb.liveShare) : "streamt nicht" },
              { label: "Aktivster Tag", a: ra.topDay ? `${dayLabel(ra.topDay.day)} · ${duration(ra.topDay.minutes * 60)}` : "–", b: rb.topDay ? `${dayLabel(rb.topDay.day)} · ${duration(rb.topDay.minutes * 60)}` : "–" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Netz */

const VERDICT: Record<CompareData["net"]["verdict"], { label: string; tone: string; text: string }> = {
  eng: { label: "Eng verbunden", tone: "grass", text: "Für mindestens einen von beiden unter den drei stärksten Verbindungen." },
  befreundet: { label: "Befreundet", tone: "diamond", text: "Direkt verbunden, für mindestens einen unter den zehn stärksten." },
  bekannt: { label: "Kennen sich", tone: "white", text: "Direkt verbunden, aber für beide keine der wichtigen Verbindungen." },
  fremd: { label: "Keine direkte Verbindung", tone: "paper", text: "Keine Raids, kein geteilter Chat, keine Nennung im Titel und keine Chat-Nachricht beim anderen." },
};

function FriendList({ list, max, names, mark, other, title, empty = "Keine." }: { list: Friend[]; max: number; names: Names; mark?: Set<string>; other: string; title: React.ReactNode; empty?: string }) {
  return (
    <div className="box cmp-friends" data-tone="white">
      <h3 className="eyebrow">{title}</h3>
      {list.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ol>
          {list.map((f) => (
            <li key={f.id}>
              <Head id={f.id} uuid={names.uuidOf(f.id)} name={names.nameOf(f.id)} size={22} src={32} decorative />
              <span className="cmp-friends__name">
                <Link href={names.pair(other, f.id)} title={`${names.nameOf(other)} mit ${names.nameOf(f.id)} vergleichen`}>
                  {names.nameOf(f.id)}
                </Link>
                {mark?.has(f.id) && (
                  <span className="cmp-chip" title="Auch mit dem anderen verbunden">
                    beide
                  </span>
                )}
              </span>
              <span className="cmp-friends__bar" aria-hidden="true">
                <span style={{ width: `${(f.w / max) * 100}%` }} />
              </span>
              <span className="num muted cmp-friends__w">{dec(f.w)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NetworkSection({ d, names }: { d: CompareData; names: Names }) {
  const n = d.net;
  const { a, b, link } = d;
  const v = VERDICT[n.verdict];
  // Je Seite eigener Maßstab: sonst verschwinden die Balken des Spielers mit den schwächeren Verbindungen
  const maxA = Math.max(1, ...n.a.friends.map((f) => f.w), ...n.common.map((c) => c.wa));
  const maxB = Math.max(1, ...n.b.friends.map((f) => f.w), ...n.common.map((c) => c.wb));
  const commonSet = new Set(n.common.map((c) => c.id));
  const group = (g: CompareData["net"]["a"]["group"]) => (g ? `${names.nameOf(g.leader)}s Gruppe · ${ROLE_LABEL[g.role]} (${g.size})` : "keine");
  const chat = link.chats ? `${num(link.chats)}× · ${duration(link.chatSeconds)}` : "–";
  return (
    <section className="block" data-tone="paper">
      <div className="wrap stack">
        <div className="section-head">
          <h2 className="t-3 cmp-h">
            <Icon.users width={22} height={22} aria-hidden="true" /> Netz
          </h2>
          <p className="tag" data-tone={v.tone} title={v.text}>
            {v.label}
          </p>
        </div>
        <p className="muted">
          Verbindungen über Twitch wie auf der Seite Verbindungen: Raids, geteilte Chats, Namen im Stream-Titel und Chat-Nachrichten beim anderen, als Punkte. Ein Klick auf einen Namen vergleicht ihn mit dem
          jeweiligen Spieler.
        </p>
        <dl className="grid st-figs">
          <div className="box st-fig" data-tone="white">
            <dt>Direkte Verbindung</dt>
            <dd className="num">{n.direct ? `${dec(n.direct)} Punkte` : "keine"}</dd>
            <p className="muted cmp-fig__note">
              {n.a.otherPlace || n.b.otherPlace ? `${b.name} ist Nr. ${n.a.otherPlace ?? "–"} bei ${a.name}, ${a.name} Nr. ${n.b.otherPlace ?? "–"} bei ${b.name}` : "Kein direkter Kontakt erfasst"}
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Abstand</dt>
            <dd className="num">{n.hops === null ? "getrennt" : n.hops === 1 ? "direkt" : `${n.hops} Schritte`}</dd>
            <p className="muted cmp-fig__note">Kürzester Weg im Netz (starke Verbindungen zählen als kürzer)</p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Gemeinsame Bekannte</dt>
            <dd className="num">{num(n.commonCount)}</dd>
            <p className="muted cmp-fig__note">
              von {num(n.a.degree)} bzw. {num(n.b.degree)} Verbindungen
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Freundeskreis deckt sich</dt>
            <dd className="num">{pct(n.overlap)}</dd>
            <p className="muted cmp-fig__note">Wie ähnlich sich die Verbindungsstärke auf dieselben Leute verteilt</p>
          </div>
        </dl>

        {n.hops !== null && n.hops > 1 && (
          <p className="cmp-path">
            <span className="muted">Wer sie verbindet:</span>
            {n.path.map((id, i) => (
              <span key={id} className="cmp-path__step">
                {i > 0 && <span className="muted">→</span>}
                <Link href={`/spieler/${encodeURIComponent(id)}`} className="cmp-path__who">
                  <Head id={id} uuid={names.uuidOf(id)} name={names.nameOf(id)} size={20} src={32} decorative /> {names.nameOf(id)}
                </Link>
              </span>
            ))}
          </p>
        )}

        <div className="box" data-tone="white">
          <SideTable
            d={d}
            rows={[
              { label: "Gruppe im Netz", a: group(n.a.group), b: group(n.b.group) },
              { label: "Direkte Verbindungen", a: num(n.a.degree), b: num(n.b.degree) },
              { label: "Gesamtstärke im Netz", a: `${dec(n.a.strength)} · Platz ${n.a.strengthRank ?? "–"}`, b: `${dec(n.b.strength)} · Platz ${n.b.strengthRank ?? "–"}`, hint: `Platz unter ${n.nodes} verbundenen Spielern` },
              { label: "Raids an den anderen", a: num(link.raidsAB), b: num(link.raidsBA) },
              { label: "Chat-Nachrichten beim anderen", a: num(link.msgsAB), b: num(link.msgsBA) },
              { label: "Anderen im Stream-Titel genannt", a: link.titleAB ? duration(link.titleAB) : "–", b: link.titleBA ? duration(link.titleBA) : "–" },
              { label: "Geteilter Chat (zusammen)", a: chat, b: chat },
            ]}
          />
        </div>

        <div className="cmp-three">
          <FriendList list={n.a.friends} max={maxA} names={names} mark={commonSet} other={a.id} title={<>Stärkste Verbindungen von {a.name}</>} />
          <div className="box cmp-friends" data-tone="white">
            <h3 className="eyebrow">Gemeinsame Bekannte</h3>
            {n.common.length === 0 ? (
              <p className="muted">Niemand, mit dem beide verbunden sind.</p>
            ) : (
              <ol>
                {n.common.map((c) => (
                  <li key={c.id} title={`${a.name}: ${dec(c.wa)} · ${b.name}: ${dec(c.wb)} Punkte`}>
                    <Head id={c.id} uuid={names.uuidOf(c.id)} name={names.nameOf(c.id)} size={22} src={32} decorative />
                    <span className="cmp-friends__name">
                      <Link href={`/spieler/${encodeURIComponent(c.id)}`}>{names.nameOf(c.id)}</Link>
                    </span>
                    <span className="cmp-common__bars" aria-hidden="true">
                      <span data-side="a" style={{ width: `${(c.wa / maxA) * 100}%` }} />
                      <span data-side="b" style={{ width: `${(c.wb / maxB) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <FriendList list={n.b.friends} max={maxB} names={names} mark={commonSet} other={b.id} title={<>Stärkste Verbindungen von {b.name}</>} />
        </div>
        {(n.a.ownCircle.length > 0 || n.b.ownCircle.length > 0) && (
          <div className="cmp-two">
            <FriendList list={n.a.ownCircle} max={maxA} names={names} other={a.id} title={<>Nur im Kreis von {a.name}</>} empty={`Alle Verbindungen von ${a.name} kennen auch ${b.name}.`} />
            <FriendList list={n.b.ownCircle} max={maxB} names={names} other={b.id} title={<>Nur im Kreis von {b.name}</>} empty={`Alle Verbindungen von ${b.name} kennen auch ${a.name}.`} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Gemeinsame Dritte */

const CIRCLE: Record<CircleKey, { title: string; unit: string; hint: string }> = {
  raidsIn: {
    title: "Raidet beide",
    unit: "Raids",
    hint: "Raids an den einen und an den anderen",
  },
  raidsOut: {
    title: "Wird von beiden geraidet",
    unit: "Raids",
    hint: "Raids von beiden an denselben Streamer",
  },
  msgsIn: {
    title: "Schreibt bei beiden im Chat",
    unit: "Nachrichten",
    hint: "Chat-Nachrichten im Twitch-Chat beider",
  },
  msgsOut: {
    title: "Beide schreiben bei",
    unit: "Nachrichten",
    hint: "Chat-Nachrichten beider im Twitch-Chat desselben Streamers",
  },
  shared: {
    title: "Geteilter Chat mit beiden",
    unit: "",
    hint: "Zeit im geteilten Chat (Stream Together) mit dem einen und mit dem anderen",
  },
  costream: {
    title: "Gemeinsam gestreamt mit beiden",
    unit: "",
    hint: "Zeit in „Gemeinsam streamen“ mit dem einen und mit dem anderen",
  },
  voice: {
    title: "Im Voicechat mit beiden",
    unit: "",
    hint: "Zeit in derselben Voicechat-Gruppe mit dem einen und mit dem anderen, erkannt aus den Gruppenlisten in den Twitch-VODs (nur, was in Streams zu sehen war; mehr auf /voicechat)",
  },
  title: {
    title: "Beide nennen im Stream-Titel",
    unit: "",
    hint: "Stream-Zeit mit dem Namen im Titel",
  },
};

const AUDIENCE: Record<AudienceKind, { label: string; hint: string }> = {
  subs: {
    label: "Abonnenten",
    hint: "Leute mit eigenem Abo bei beiden (neu, verlängert oder Prime), nach den Sub-Meldungen im Chat",
  },
  gifts: {
    label: "Sub-Verschenker",
    hint: "Leute, die bei beiden Subs verschenkt haben (ohne anonyme Geschenke)",
  },
  cheers: {
    label: "Cheerer",
    hint: "Leute, die bei beiden Bits gegeben haben",
  },
  clips: {
    label: "Clipper",
    hint: "Leute, die bei beiden Clips erstellt haben",
  },
};

function ThirdList({ l, d, names }: { l: CircleList; d: CompareData; names: Names }) {
  const c = CIRCLE[l.key];
  const max = Math.max(1, ...l.rows.flatMap((r) => [r.a, r.b]));
  const show = (v: number) => (l.seconds ? duration(v) : num(v));
  return (
    <div className="box cmp-friends cmp-third" data-tone="white">
      <h3 className="eyebrow" title={c.hint}>
        {c.title} · {num(l.count)}
      </h3>
      <ol>
        {l.rows.map((r) => (
          <li key={r.id} title={`${d.a.name}: ${show(r.a)}${c.unit ? ` ${c.unit}` : ""} · ${d.b.name}: ${show(r.b)}${c.unit ? ` ${c.unit}` : ""}`}>
            <Head id={r.id} uuid={names.uuidOf(r.id)} name={names.nameOf(r.id)} size={22} src={32} decorative />
            <span className="cmp-friends__name">
              <Link href={`/spieler/${encodeURIComponent(r.id)}`}>{names.nameOf(r.id)}</Link>
            </span>
            <span className="cmp-common__bars" aria-hidden="true">
              <span data-side="a" style={{ width: `${(r.a / max) * 100}%` }} />
              <span data-side="b" style={{ width: `${(r.b / max) * 100}%` }} />
            </span>
            <span className="num cmp-third__v">
              <span data-side="a">{show(r.a)}</span>
              <span data-side="b">{show(r.b)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

async function ThirdSection({ d, names }: { d: CompareData; names: Names }) {
  const { state } = await loadTracker();
  const t = await getThirdParties(d.a.id, d.b.id, state.players, d.now);
  const { a, b } = d;
  const circle = t.circle.filter((l) => l.rows.length > 0);
  const au = t.audience;
  const share = (n: number, of: number) => (of ? pctFine(n / of) : "–");
  const maxServer = Math.max(1, ...t.server.rows.map((r) => r.seconds));
  if (!circle.length && !au && !t.server.rows.length) return null;
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <h2 className="t-3 cmp-h">
          <Icon.users width={22} height={22} aria-hidden="true" /> Gemeinsame Dritte
        </h2>
        <p className="muted">
          Wer mit beiden zu tun hat: andere Streamer im Kreis, dasselbe Publikum und wer auf dem Server dabei ist, wenn beide online sind.
        </p>

        <h3 className="cmp-sub">Kreis</h3>
        {circle.length === 0 ? (
          <p className="muted">Niemand, der mit beiden über Raids, Chat, geteilten Chat, gemeinsames Streamen oder Titel verbunden ist.</p>
        ) : (
          <>
            <p className="muted cmp-note">
              Nur Leute, die bei beiden vorkommen, stärkste zuerst (nach dem kleineren der beiden Werte). Oben {a.name}, unten {b.name}. Raids, Chat und Titel
              wie im Netz nur aus Zeiten auf CraftAttack.
            </p>
            <div className="cmp-three">
              {circle.map((l) => (
                <ThirdList key={l.key} l={l} d={d} names={names} />
              ))}
            </div>
          </>
        )}

        {au && (
          <>
            <h3 className="cmp-sub">Publikum</h3>
            <dl className="grid st-figs">
              <div className="box st-fig" data-tone="paper">
                <dt>Publikum deckt sich</dt>
                <dd className="num">{au.similarity === null ? "–" : pctFine(au.similarity)}</dd>
                <p className="muted cmp-fig__note">Gemeinsame Abonnenten im Verhältnis zur Größe beider (Wurzel aus dem Produkt)</p>
              </div>
              <div className="box st-fig" data-tone="paper">
                <dt>Platz unter den Ähnlichsten</dt>
                <dd className="num cmp-score--small">
                  <span data-side="a">{au.placeA ?? "–"}</span> : <span data-side="b">{au.placeB ?? "–"}</span>
                </dd>
                <p className="muted cmp-fig__note">
                  {b.name} ist Nr. {au.placeA ?? "–"} bei {a.name}, {a.name} Nr. {au.placeB ?? "–"} bei {b.name} (von {num(au.of)} Kanälen)
                </p>
              </div>
            </dl>
            <div className="cmp-two">
              <div className="box" data-tone="paper">
                <table className="cmp-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Bei beiden</th>
                      <th data-side="a">Anteil bei {a.name}</th>
                      <th data-side="b">Anteil bei {b.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {au.rows.map((r) => (
                      <tr key={r.kind} title={AUDIENCE[r.kind].hint}>
                        <th scope="row">{AUDIENCE[r.kind].label}</th>
                        <td className="num">{num(r.shared)}</td>
                        <td className="num">
                          {share(r.shared, r.a)} <span className="muted">von {num(r.a)}</span>
                        </td>
                        <td className="num">
                          {share(r.shared, r.b)} <span className="muted">von {num(r.b)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {au.gifters.length > 0 && (
                <div className="box cmp-friends cmp-third" data-tone="paper">
                  <h3 className="eyebrow">Größte Sub-Verschenker an beide</h3>
                  <ol>
                    {au.gifters.map((g) => {
                      const max = Math.max(1, ...au.gifters.flatMap((x) => [x.a, x.b]));
                      return (
                        <li key={g.login} title={`${a.name}: ${num(g.a)} Subs · ${b.name}: ${num(g.b)} Subs`}>
                          {g.player ? (
                            <Head id={g.player} uuid={names.uuidOf(g.player)} name={names.nameOf(g.player)} size={22} src={32} decorative />
                          ) : (
                            <span />
                          )}
                          <span className="cmp-friends__name">
                            {g.player ? <Link href={`/spieler/${encodeURIComponent(g.player)}`}>{names.nameOf(g.player)}</Link> : <strong>{g.login}</strong>}
                          </span>
                          <span className="cmp-common__bars" aria-hidden="true">
                            <span data-side="a" style={{ width: `${(g.a / max) * 100}%` }} />
                            <span data-side="b" style={{ width: `${(g.b / max) * 100}%` }} />
                          </span>
                          <span className="num cmp-third__v">
                            <span data-side="a">{num(g.a)}</span>
                            <span data-side="b">{num(g.b)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>
          </>
        )}

        <h3 className="cmp-sub">Auf dem Server</h3>
        {t.server.rows.length === 0 ? (
          <p className="muted">{t.server.both > 0 ? "Wenn beide online waren, war sonst kaum jemand dabei." : "Beide waren nie gleichzeitig online."}</p>
        ) : (
          <div className="box cmp-friends cmp-third--narrow" data-tone="paper">
            <h3 className="eyebrow">Am häufigsten dabei, wenn beide online sind · zusammen {duration(t.server.both)}</h3>
            <ol>
              {t.server.rows.map((r) => (
                <li key={r.id} title={`${duration(r.seconds)} von ${duration(t.server.both)}`}>
                  <Head id={r.id} uuid={names.uuidOf(r.id)} name={names.nameOf(r.id)} size={22} src={32} decorative />
                  <span className="cmp-friends__name">
                    <Link href={`/spieler/${encodeURIComponent(r.id)}`}>{names.nameOf(r.id)}</Link>
                  </span>
                  <span className="cmp-friends__bar" aria-hidden="true">
                    <span style={{ width: `${(r.seconds / maxServer) * 100}%` }} />
                  </span>
                  <span className="num muted cmp-friends__w">{pct(r.seconds / t.server.both)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Zuschauer und Raids */

function ViewerSection({ d, names }: { d: CompareData; names: Names }) {
  const v = d.viewers;
  if (!v.a.days && !v.b.days && !v.a.raid && !v.b.raid) return null;
  const raid = (s: ViewerSide, f: (r: NonNullable<ViewerSide["raid"]>) => string) => (s.raid ? f(s.raid) : "–");
  const rate = (r: NonNullable<ViewerSide["raid"]>) => (r.opportunities ? pct((r.given - r.givenExternal) / r.opportunities) : "–");
  const magnet = (r: NonNullable<ViewerSide["raid"]>) => (r.expected >= 0.5 ? `${dec(r.received / r.expected)}×` : "–");
  const bilanz = (r: NonNullable<ViewerSide["raid"]>) => `${r.receivedViewers - r.givenViewers > 0 ? "+" : ""}${num(r.receivedViewers - r.givenViewers)}`;
  const flow = (x: CompareData["viewers"]["ab"], place: number | null) => (x ? `${num(x.viewers)}${x.raid ? ` (${num(x.raid)} per Raid)` : ""}${place ? ` · Ziel Nr. ${place}` : ""}` : "–");
  const destinations = (s: ViewerSide) =>
    s.topTo.length ? (
      <span className="cmp-dest">
        {s.topTo.map((t) => (
          <Link key={t.id} href={`/spieler/${encodeURIComponent(t.id)}`} className="cmp-path__who" title={`${num(t.viewers)} Zuschauer über die Staffel`}>
            <Head id={t.id} uuid={names.uuidOf(t.id)} name={names.nameOf(t.id)} size={18} src={32} decorative />
            {names.nameOf(t.id)}
          </Link>
        ))}
      </span>
    ) : (
      "–"
    );
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <h2 className="t-3 cmp-h">
          <Icon.eye width={22} height={22} aria-hidden="true" /> Zuschauer und Raids
        </h2>
        <div className="cmp-two">
          <div className="box" data-tone="paper">
            <h3 className="eyebrow">Streams</h3>
            <SideTable
              d={d}
              rows={[
                { label: "Streamtage", a: num(v.a.days), b: num(v.b.days), hint: "Tage, an denen der Streamer auf CraftAttack live war" },
                { label: "Stunden live", hint: "Stream-Zeit, solange der Streamer auf dem Server war", a: duration(v.a.hours * 3600), b: duration(v.b.hours * 3600) },
                { label: "Ø Zuschauer", a: v.a.avg !== null ? num(v.a.avg) : "–", b: v.b.avg !== null ? num(v.b.avg) : "–", hint: "Ohne die erste halbe Stunde des Streams" },
                { label: "Bester Tag", a: v.a.best ? `${dayLabel(v.a.best.day)} · Ø ${num(v.a.best.avg)}` : "–", b: v.b.best ? `${dayLabel(v.b.best.day)} · Ø ${num(v.b.best.avg)}` : "–" },
                { label: "Anteil am CA-Publikum", a: v.a.share !== null ? pctFine(v.a.share) : "–", b: v.b.share !== null ? pctFine(v.b.share) : "–", hint: "Anteil an allen Zuschauern der CraftAttack-Streams, solange er live war" },
                {
                  label: "Entwicklung seit Start",
                  a: v.a.ownChange !== null ? signed(v.a.ownChange) : "–",
                  b: v.b.ownChange !== null ? signed(v.b.ownChange) : "–",
                  hint: v.marketChange !== null ? `Ganz CraftAttack im selben Zeitraum: ${signed(v.marketChange)}` : undefined,
                },
                { label: "Halb so viel Konkurrenz bringt", a: v.a.lessCompetition !== null ? signed(v.a.lessCompetition) : "–", b: v.b.lessCompetition !== null ? signed(v.b.lessCompetition) : "–", hint: "Mehr Zuschauer, wenn halb so viele andere CraftAttack-Streams laufen" },
              ]}
            />
          </div>
          <div className="box" data-tone="paper">
            <h3 className="eyebrow">Raids</h3>
            <SideTable
              d={d}
              rows={[
                { label: "Raids gegeben", a: raid(v.a, (r) => num(r.given)), b: raid(v.b, (r) => num(r.given)) },
                { label: "Zuschauer weitergeschickt", a: raid(v.a, (r) => num(r.givenViewers)), b: raid(v.b, (r) => num(r.givenViewers)) },
                { label: "Raid-Rate", a: raid(v.a, rate), b: raid(v.b, rate), hint: "Raids an Erfasste je Stream-Ende, bei dem jemand Erfasstes live war" },
                { label: "Raids bekommen", a: raid(v.a, (r) => num(r.received)), b: raid(v.b, (r) => num(r.received)) },
                { label: "Zuschauer bekommen", a: raid(v.a, (r) => num(r.receivedViewers)), b: raid(v.b, (r) => num(r.receivedViewers)) },
                { label: "Raid-Magnet", a: raid(v.a, magnet), b: raid(v.b, magnet), hint: "Bekommen ÷ erwartet bei zufälliger Wahl unter den Live-Spielern" },
                { label: "Bilanz Zuschauer", a: raid(v.a, bilanz), b: raid(v.b, bilanz) },
              ]}
            />
          </div>
        </div>
        <div className="box" data-tone="paper">
          <h3 className="eyebrow">Zuschauer-Wanderung</h3>
          <p className="muted cmp-note">Wie viele Zuschauer über die Staffel nach Stream-Ende, Raid oder Einbruch beim anderen wieder auftauchten – geschätzt aus den Zuschauerzahlen wie auf der Zuschauer-Seite.</p>
          <SideTable
            d={d}
            head={[`${d.a.name} → ${d.b.name}`, `${d.b.name} → ${d.a.name}`]}
            rows={[
              { label: "Zuschauer gewandert", a: flow(v.ab, v.placeAB), b: flow(v.ba, v.placeBA) },
              { label: "Nach 60 Min noch da", a: v.ab?.stay != null ? pct(v.ab.stay) : "–", b: v.ba?.stay != null ? pct(v.ba.stay) : "–" },
            ]}
          />
          <SideTable d={d} rows={[{ label: "Wohin die eigenen Zuschauer am meisten gehen", a: destinations(v.a), b: destinations(v.b) }]} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Fortschritte */

function AdvSection({ d }: { d: CompareData }) {
  const ad = d.adv;
  if (!ad.countA && !ad.countB) return null;
  const list = (l: CompareData["adv"]["onlyA"]) =>
    l.length ? (
      <ul className="cmp-adv">
        {l.slice(0, 10).map((x) => (
          <li key={x.id}>
            {x.title} {x.rare > 0 && <small className="muted">· {num(x.rare)} von {num(ad.players)} Spielern</small>}
          </li>
        ))}
        {l.length > 10 && <li className="muted">und {num(l.length - 10)} weitere</li>}
      </ul>
    ) : (
      <p className="muted">Keine.</p>
    );
  return (
    <section className="block" data-tone="paper">
      <div className="wrap stack">
        <h2 className="t-3 cmp-h">
          <Icon.star width={22} height={22} aria-hidden="true" /> Fortschritte
        </h2>
        <dl className="grid st-figs">
          <div className="box st-fig" data-tone="white">
            <dt>Gemeinsam</dt>
            <dd className="num">{num(ad.shared)}</dd>
            <p className="muted cmp-fig__note">
              {d.a.name} {num(ad.countA)} · {d.b.name} {num(ad.countB)}
            </p>
          </div>
          <div className="box st-fig" data-tone="white">
            <dt>Wer war zuerst?</dt>
            <dd className="num cmp-score--small">
              <span data-side="a">{num(ad.firstA)}</span> : <span data-side="b">{num(ad.firstB)}</span>
            </dd>
            <p className="muted cmp-fig__note">Bei gemeinsamen Fortschritten mit bekanntem Zeitpunkt</p>
          </div>
        </dl>
        <div className="cmp-two">
          <div className="box" data-tone="white">
            <h3 className="eyebrow">Nur {d.a.name} · seltenste zuerst</h3>
            {list(ad.onlyA)}
          </div>
          <div className="box" data-tone="white">
            <h3 className="eyebrow">Nur {d.b.name} · seltenste zuerst</h3>
            {list(ad.onlyB)}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Miteinander auf dem Server */

const PAIR_VERB: Partial<Record<string, string>> = {
  death: "Getötet",
  subscription_gift: "Subs verschenkt",
};

function TogetherSection({ d }: { d: CompareData }) {
  const { a, b, together: t } = d;
  const types = [...new Set(d.pairEvents.map((p) => p.type))].filter((ty) => ty !== "chat" && ty !== "raid");
  const countOf = (ty: string, side: "a" | "b") => d.pairEvents.find((p) => p.type === ty && p.from === side)?.count ?? 0;
  return (
    <section className="block" data-tone="white">
      <div className="wrap stack">
        <h2 className="t-3 cmp-h">
          <Icon.server width={22} height={22} aria-hidden="true" /> Miteinander auf dem Server
        </h2>
        <dl className="grid st-figs">
          <div className="box st-fig" data-tone="paper">
            <dt>Gemeinsam online</dt>
            <dd className="num">{t.seconds > 0 ? duration(t.seconds) : "–"}</dd>
            <p className="muted cmp-fig__note">
              {t.sessions > 0 ? `in ${num(t.sessions)} Sessions von ${a.name}` : "Nie gleichzeitig gesehen"}
              {t.now ? " · gerade beide online" : ""}
            </p>
          </div>
          <div className="box st-fig" data-tone="paper">
            <dt>Anteil der Online-Zeit</dt>
            <dd className="num">
              {pct(t.shareA)} <span className="muted">/</span> {pct(t.shareB)}
            </dd>
            <p className="muted cmp-fig__note">
              So viel seiner Zeit war der andere dabei ({a.name} / {b.name})
            </p>
          </div>
          <div className="box st-fig" data-tone="paper">
            <dt>Platz als Mitspieler</dt>
            <dd className="num">
              {t.placeInA ? `#${t.placeInA}` : "–"} <span className="muted">/</span> {t.placeInB ? `#${t.placeInB}` : "–"}
            </dd>
            <p className="muted cmp-fig__note">
              {b.name} bei {a.name} / {a.name} bei {b.name}, nach gemeinsamer Zeit
            </p>
          </div>
        </dl>
        <div className="cmp-two">
          {types.length > 0 ? (
            <div className="box" data-tone="paper">
              <SideTable
                d={d}
                head={[`${a.name} → ${b.name}`, `${b.name} → ${a.name}`]}
                rows={types.map((ty) => ({ label: PAIR_VERB[ty] ?? EVENT_META[ty].label, a: num(countOf(ty, "a")), b: num(countOf(ty, "b")) }))}
              />
            </div>
          ) : (
            <p className="muted">Keine Kills oder Abo-Geschenke zwischen beiden erfasst.</p>
          )}
          <div className="box" data-tone="paper">
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

export default function Page(props: PageProps<"/vergleich">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Spieler" title="Spielervergleich" figs={0} />}>
      <Inner {...props} />
    </Suspense>
  );
}
