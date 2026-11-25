"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectNumbers } from "@/lib/projectMap";
import type { ProjectMilestone, ProjectPr } from "@/lib/projectTimeline";

const nf = new Intl.NumberFormat("de-DE");
const n = (v: number) => nf.format(Math.round(v));
const gb = (b: number) => `${(b / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 1 })} GB`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "–");
const dShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });
const dLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

type Area = "tracker" | "video" | "youtube";
interface Node {
  id: string;
  col: 0 | 1 | 2 | 3;
  label: string;
  kicker: string;
  tone: string;
  areas: Area[];
  desc: string;
  facts: (x: ProjectNumbers) => string[];
  links?: { label: string; href: string }[];
}

const COLS = ["Quellen", "Verarbeitung", "Speicher", "Ausgabe"];

function nodes(root: string): Node[] {
  return [
    { id: "ca", col: 0, label: "craftattack.one", kicker: "Offizielle Seite", tone: "var(--gold)", areas: ["tracker"], desc: "Spielerliste, wer online ist, Statistiken und Fortschritte jedes Spielers. Wird seit dem 24.10. über die eigene Heimleitung abgefragt, weil die Seite Rechenzentren sperrt.", facts: (x) => [`${n(x.polls)} Abfragen`, `${n(x.players)} Spieler`], links: [{ label: "Spieler", href: "/spieler" }] },
    { id: "tw", col: 0, label: "Twitch", kicker: "API, Chat, Web", tone: "var(--twitch)", areas: ["tracker"], desc: "Live-Status und Zuschauer, Abos, Bits, Raids, Chat zwischen Spielern, geteilter Chat, Clips und die VOD-Liste.", facts: (x) => [`${n(x.eventsBy.twitch ?? 0)} Twitch-Ereignisse`, `${n(x.chatMessages)} Chat-Nachrichten zwischen Spielern`, `${n(x.clips)} Clips`], links: [{ label: "Live", href: "/live" }, { label: "Raids", href: "/raids" }] },
    { id: "vod", col: 0, label: "Twitch-VODs", kicker: "Videobilder", tone: "var(--twitch)", areas: ["video"], desc: "Die Aufzeichnungen der Streams: ein Schlüsselbild alle 10 Sekunden, nur solange der Streamer auf dem Server und nicht AFK war.", facts: (x) => [`${n(x.twitchVods)} VODs bekannt`, `${n(x.twitchVodHours)} Stunden Aufzeichnung`] },
    { id: "yt", col: 0, label: "YouTube", kicker: "Data API v3", tone: "var(--youtube)", areas: ["youtube"], desc: "Uploads und Livestreams der Kanäle, die die Teilnehmer selbst verlinken. Offizielle Schnittstelle, kein Scraping.", facts: (x) => [`${n(x.ytChannels)} Kanäle`, `${n(x.ytVideos)} Uploads seit 1.9.`] },

    { id: "tracker", col: 1, label: "Tracker", kicker: "jede Minute", tone: "var(--ink)", areas: ["tracker", "youtube"], desc: "Vergleicht jede Abfrage mit der vorigen und macht daraus Ereignisse: Joins, Tode, Fortschritte, AFK-Farmen, Streams, Raids, Rekorde.", facts: (x) => [`${n(x.events)} Ereignisse`, `läuft seit ${x.startedAt ? dShort.format(new Date(x.startedAt)) : "–"}`] },
    { id: "jobs", col: 1, label: "Analysen", kicker: "alle 10 Minuten", tone: "var(--amethyst)", areas: ["tracker"], desc: "Teure Auswertungen (Netzwerk, Gruppen, Zuschauerwanderung, Rhythmus, Raids) rechnet der Tracker vor; die Website liest nur noch fertige Ergebnisse.", facts: (x) => [`${n(x.snapshots)} vorberechnete Auswertungen`] },
    { id: "ytjob", col: 1, label: "YouTube-Abgleich", kicker: "alle 6 Stunden", tone: "var(--youtube)", areas: ["youtube"], desc: "Holt neue Uploads, zählt Aufrufe nach, erkennt CraftAttack-Videos und verknüpft Ereignisse mit YouTube-Livestreams, wo kein Twitch-VOD mehr existiert.", facts: (x) => [`${n(x.ytCa14)} Uploads zu CraftAttack 14`, `${n(x.ytViews)} Aufrufe`] },
    { id: "scan", col: 1, label: "VOD-Scan", kicker: "Server + Laptop", tone: "var(--twitch)", areas: ["video"], desc: "Liest in jedem Bild die Hotbar (spielt er gerade?), den Ingame-Chat per Texterkennung und die Köpfe der Voicechat-Gruppe per Skin-Abgleich. Zwei Rechner teilen sich die Arbeit.", facts: (x) => (x.scan ? [`${pct(x.scan.done, x.scan.total)} gescannt`, `${n(x.scan.frames)} Bilder gelesen`, `VODs bis ${x.scan.reached ? dShort.format(new Date(x.scan.reached)) : "–"}`] : ["Kein Stand"]) },
    { id: "faces", col: 1, label: "Kopf-Erkennung", kicker: "stündlich", tone: "var(--sky)", areas: ["video"], desc: "Ordnet Köpfe Spielern zu: Skin-Vergleich, Reihenfolge der Gruppenliste bei anderen Streamern, Zeit davor und danach – den Rest beschriftest du von Hand.", facts: (x) => (x.scan ? [`${n(x.scan.heads)} Köpfe gelesen`, `${pct(x.scan.known, x.scan.heads)} zugeordnet`] : []), links: [{ label: "Gesichter", href: `${root}/gesichter` }] },
    { id: "chat", col: 1, label: "Chat-Bereinigung", kicker: "nach dem Scan", tone: "var(--sky)", areas: ["video"], desc: "Führt dieselbe Chatzeile aus mehreren Streams zusammen, gleicht sie mit Tracker-Ereignissen ab und ordnet verlesene Namen Spielern zu.", facts: (x) => (x.chat ? [`${n(x.chat.lines)} gelesene Zeilen`, `${n(x.chat.events)} bereinigte Ereignisse`, `${n(x.chat.open)} offen`] : []), links: [{ label: "Chat", href: `${root}/chat` }] },

    { id: "db", col: 2, label: "Tracker-Datenbank", kicker: "PostgreSQL", tone: "var(--ink)", areas: ["tracker", "youtube"], desc: "Alles, was der Tracker sieht: Spieler, Ereignisse, Minutenverlauf je Spieler, Twitch- und YouTube-Daten.", facts: (x) => [gb(x.dbBytes), `${n(x.playerHistory)} Messpunkte je Spieler`, `${n(x.history)} Messpunkte gesamt`] },
    { id: "scandb", col: 2, label: "Scan-Datenbank", kicker: "Rückblick-Projekt", tone: "var(--twitch)", areas: ["video"], desc: "Ergebnis des VOD-Scans: jedes gelesene Bild mit Voicechat-Liste, Chatzeilen und Rohtext, dazu gelernte Köpfe und HUD-Positionen.", facts: (x) => (x.scan ? [`${n(x.scan.frames)} Bilder`, `${n(x.chat?.lines ?? 0)} Chatzeilen`] : []) },
    { id: "files", col: 2, label: "Auswertungsdateien", kicker: "review/", tone: "var(--sky)", areas: ["video"], desc: "Was der Scan der Website übergibt: Voicechat-Zusammenfassung, Kopf-Gruppen zum Beschriften, Chat-Bündel.", facts: (x) => (x.scan ? [`${n(x.scan.groups)} Gruppen-Zusammensetzungen`, `${n(x.scan.groupHours)} Stunden Voicechat`] : []) },

    { id: "web", col: 3, label: "Website", kicker: "öffentlich", tone: "var(--presence)", areas: ["tracker", "youtube"], desc: "Jetzt, Spieler, Bestenlisten, Verlauf, Community: alles live aus der Datenbank, mit Seiten-Cache davor.", facts: (x) => [`${n(x.players)} Spielerseiten`, `${n(x.events)} Ereignisse durchsuchbar`], links: [{ label: "Startseite", href: "/" }, { label: "Ereignisse", href: "/ereignisse" }, { label: "Zeitstrahl", href: "/zeitstrahl" }] },
    { id: "preview", col: 3, label: "Vorschau-Seiten", kicker: "versteckt", tone: "var(--amethyst)", areas: ["video", "youtube"], desc: "Neue Ideen vor dem Livegang und die Werkzeuge fürs Rückblick-Video.", facts: () => ["Voicechat, Gesichter, Chat, YouTube, diese Seite"], links: [{ label: "Voicechat", href: `${root}/voicechat` }, { label: "YouTube", href: `${root}/youtube` }] },
    { id: "video", col: 3, label: "Rückblick-Video", kicker: "„Das war CraftAttack“", tone: "var(--gold)", areas: ["video"], desc: "Analysen und gerenderte Grafik-Clips aus einem Schnappschuss der Datenbank, ergänzt um Voicechat, Chat und YouTube.", facts: () => ["Grafik-Clips, Ereignis-Chronik, Storyboard"] },
  ];
}

/** [von, nach, Datenmenge 1–3] */
const EDGES: [string, string, number][] = [
  ["ca", "tracker", 3],
  ["tw", "tracker", 3],
  ["yt", "ytjob", 1],
  ["vod", "scan", 3],
  ["tracker", "db", 3],
  ["db", "jobs", 2],
  ["jobs", "db", 2],
  ["ytjob", "db", 1],
  ["scan", "scandb", 3],
  ["scandb", "faces", 2],
  ["scandb", "chat", 2],
  ["faces", "files", 1],
  ["chat", "files", 1],
  ["db", "web", 3],
  ["db", "preview", 1],
  ["files", "preview", 1],
  ["db", "video", 1],
  ["scandb", "video", 1],
];

const FILTERS: { key: Area | null; label: string }[] = [
  { key: null, label: "Alles" },
  { key: "tracker", label: "Live-Tracker" },
  { key: "video", label: "Rückblick-Video" },
  { key: "youtube", label: "YouTube" },
];

const W = 1100;
const H = 600;
const NW = 200;
const NH = 62;
const colX = (c: number) => 20 + c * ((W - 40 - NW) / 3);

function useCountUp(target: number, run: boolean) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    // Weniger Bewegung gewünscht: gleich der Endwert (im ersten Animationsschritt)
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = ms ? Math.min(1, (t - t0) / ms) : 1;
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function Counter({ value, label, sub, tone, run }: { value: number; label: string; sub?: string; tone: string; run: boolean }) {
  const v = useCountUp(value, run);
  return (
    <div className="pj-count" style={{ ["--tone" as string]: tone }}>
      <strong className="num">{n(v)}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function ProjectExplorer({ x, prs, milestones, root }: { x: ProjectNumbers; prs: ProjectPr[]; milestones: ProjectMilestone[]; root: string }) {
  const list = useMemo(() => nodes(root), [root]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("tracker");
  const [filter, setFilter] = useState<Area | null>(null);

  // Position je Knoten: Spalte, gleichmäßig verteilt
  const pos = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (let c = 0; c < 4; c++) {
      const col = list.filter((d) => d.col === c);
      const gap = (H - 60 - col.length * NH) / (col.length + 1);
      col.forEach((d, i) => (out[d.id] = { x: colX(c), y: 50 + gap * (i + 1) + NH * i }));
    }
    return out;
  }, [list]);

  // Alles, was vor und nach einem Knoten liegt
  const reach = (id: string) => {
    const set = new Set([id]);
    const walk = (cur: string, down: boolean) => {
      for (const [from, to] of EDGES) {
        const [here, next] = down ? [from, to] : [to, from];
        if (here === cur && !set.has(next)) {
          set.add(next);
          walk(next, down);
        }
      }
    };
    walk(id, true);
    walk(id, false);
    return set;
  };
  const focus = hover ?? null;
  const active: Set<string> | null = filter ? new Set(list.filter((d) => d.areas.includes(filter)).map((d) => d.id)) : focus ? reach(focus) : null;
  const on = (id: string) => !active || active.has(id);
  const sel = list.find((d) => d.id === selected)!;

  // Zähler starten, sobald sie sichtbar sind
  const countRef = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const el = countRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setRun(true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <section className="block" data-tone="paper" aria-labelledby="pj-karte">
        <div className="wrap">
          <div className="pj-head">
            <h2 className="t-2" id="pj-karte">
              Wie alles zusammenhängt
            </h2>
            <div className="pj-filters" role="group" aria-label="Teilsystem hervorheben">
              {FILTERS.map((f) => (
                <button key={f.label} type="button" className="tag" data-tone={filter === f.key ? "ink" : "white"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pj-layout">
            <div className="pj-scroll">
              <svg className="pj-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Systemkarte: Quellen, Verarbeitung, Speicher und Ausgabe des Projekts">
                {COLS.map((c, i) => (
                  <text key={c} className="pj-col" x={colX(i) + NW / 2} y={26} textAnchor="middle">
                    {c}
                  </text>
                ))}
                {EDGES.map(([a, b, w]) => {
                  const p = pos[a];
                  const q = pos[b];
                  const back = q.x < p.x; // Rückweg (Analysen → DB)
                  const x1 = back ? p.x : p.x + NW;
                  const x2 = back ? q.x + NW : q.x;
                  const y1 = p.y + NH / 2 + (back ? 10 : a === "db" && b === "jobs" ? -10 : 0);
                  const y2 = q.y + NH / 2 + (back ? 10 : a === "db" && b === "jobs" ? -10 : 0);
                  const mx = (x1 + x2) / 2;
                  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
                  const lit = on(a) && on(b);
                  return (
                    <g key={`${a}-${b}`} className="pj-edge" data-lit={lit ? "" : undefined}>
                      <path d={d} className="pj-edge__line" />
                      <path d={d} className="pj-edge__flow" style={{ animationDuration: `${4.5 - w}s`, strokeWidth: 1.5 + w }} />
                    </g>
                  );
                })}
                {list.map((d) => {
                  const p = pos[d.id];
                  return (
                    <g
                      key={d.id}
                      className="pj-node"
                      data-dim={on(d.id) ? undefined : ""}
                      data-sel={selected === d.id ? "" : undefined}
                      transform={`translate(${p.x},${p.y})`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${d.label}: ${d.kicker}`}
                      onMouseEnter={() => setHover(d.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(d.id)}
                      onBlur={() => setHover(null)}
                      onClick={() => setSelected(d.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(d.id))}
                    >
                      <rect className="pj-node__shadow" x={5} y={5} width={NW} height={NH} />
                      <rect className="pj-node__box" width={NW} height={NH} />
                      <rect width={8} height={NH} style={{ fill: d.tone }} />
                      <text className="pj-node__label" x={20} y={27}>
                        {d.label}
                      </text>
                      <text className="pj-node__kicker" x={20} y={47}>
                        {d.kicker}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <aside className="box pj-panel" data-tone="white" aria-live="polite">
              <p className="eyebrow" style={{ color: "inherit" }}>
                <i style={{ background: sel.tone }} /> {COLS[sel.col]} · {sel.kicker}
              </p>
              <h3 className="t-3">{sel.label}</h3>
              <p>{sel.desc}</p>
              {sel.facts(x).length > 0 && (
                <ul className="pj-facts">
                  {sel.facts(x).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {sel.links && (
                <p className="pj-links">
                  {sel.links.map((l) => (
                    <Link key={l.href} className="tag" data-tone="white" href={l.href}>
                      {l.label} →
                    </Link>
                  ))}
                </p>
              )}
              <p className="pj-hint">Fahr über einen Baustein, um seinen Weg zu sehen; klick ihn an für Details.</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="block" data-tone="ink" aria-labelledby="pj-zahlen">
        <div className="wrap">
          <h2 className="t-2" id="pj-zahlen">
            Was zusammengekommen ist
          </h2>
          <div className="pj-counts" ref={countRef}>
            <Counter run={run} value={x.polls} label="Abfragen von craftattack.one" sub="eine pro Minute" tone="var(--gold)" />
            <Counter run={run} value={x.events} label="Ereignisse" sub={`${n(x.eventsBy.server ?? 0)} auf dem Server, ${n(x.eventsBy.twitch ?? 0)} auf Twitch`} tone="var(--presence)" />
            <Counter run={run} value={x.playerHistory} label="Messpunkte je Spieler" sub="Minutenverlauf" tone="var(--sky)" />
            <Counter run={run} value={x.clips} label="Twitch-Clips" tone="var(--twitch)" />
            <Counter run={run} value={x.scan?.frames ?? 0} label="Videobilder gelesen" sub={x.scan ? `${pct(x.scan.done, x.scan.total)} des Scans` : undefined} tone="var(--twitch)" />
            <Counter run={run} value={x.scan?.heads ?? 0} label="Köpfe im Voicechat" sub={x.scan ? `${pct(x.scan.known, x.scan.heads)} zugeordnet` : undefined} tone="var(--amethyst)" />
            <Counter run={run} value={x.chat?.lines ?? 0} label="Ingame-Chatzeilen" sub="per Texterkennung" tone="var(--sky)" />
            <Counter run={run} value={x.ytViews} label="YouTube-Aufrufe" sub={`${n(x.ytCa14)} CraftAttack-Uploads`} tone="var(--youtube)" />
          </div>
        </div>
      </section>

      <Timeline prs={prs} milestones={milestones} />
    </>
  );
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

function Timeline({ prs, milestones }: { prs: ProjectPr[]; milestones: ProjectMilestone[] }) {
  const first = dayKey(milestones[0]?.at ?? prs[0].at);
  const last = dayKey(new Date().toISOString());
  const days: string[] = [];
  for (let t = Date.parse(`${first}T12:00:00Z`); t <= Date.parse(`${last}T12:00:00Z`); t += 86400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const byDay = new Map<string, ProjectPr[]>();
  for (const p of prs) byDay.set(dayKey(p.at), [...(byDay.get(dayKey(p.at)) ?? []), p]);
  const msDay = new Map<string, ProjectMilestone[]>();
  for (const m of milestones) msDay.set(dayKey(m.at), [...(msDay.get(dayKey(m.at)) ?? []), m]);
  const busiest = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const [day, setDay] = useState<string>(busiest?.[0] ?? last);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const TW = 1100;
  const step = TW / days.length;
  const maxStack = Math.max(1, ...[...byDay.values()].map((l) => l.length));
  const cell = Math.min(step - 3, 14);
  const TH = 120 + maxStack * (cell + 2);
  const base = TH - 26;
  const areaTone: Record<string, string> = { tracker: "var(--presence)", video: "var(--gold)", youtube: "var(--youtube)" };

  return (
    <section className="block" data-tone="paper" aria-labelledby="pj-verlauf">
      <div className="wrap">
        <h2 className="t-2" id="pj-verlauf">
          Wie das Projekt gewachsen ist
        </h2>
        <p className="pj-lead">
          Jedes Kästchen ist eine Änderung an der Website ({n(prs.length)} seit dem 13.10.), die Fahnen sind Meilensteine. Am meisten passierte am{" "}
          {busiest ? dLong.format(new Date(`${busiest[0]}T12:00:00Z`)) : "–"} ({busiest?.[1].length} Änderungen). Klick auf einen Tag.
        </p>
        <div className="pj-scroll" onMouseLeave={() => setTip(null)}>
          <svg className="pj-time" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label="Änderungen und Meilensteine pro Tag">
            {days.map((d, i) => {
              const list = byDay.get(d) ?? [];
              const ms = msDay.get(d) ?? [];
              const x = i * step;
              return (
                <g key={d} className="pj-day" data-sel={day === d ? "" : undefined} onClick={() => setDay(d)}>
                  <rect className="pj-day__hit" x={x} y={0} width={step} height={TH} />
                  {list.map((p, k) => (
                    <rect
                      key={p.pr}
                      className="pj-pr"
                      x={x + (step - cell) / 2}
                      y={base - (k + 1) * (cell + 2)}
                      width={cell}
                      height={cell}
                      onMouseEnter={() => setTip({ x: x + step / 2, y: base - (k + 1) * (cell + 2), text: `#${p.pr} · ${p.title}` })}
                    />
                  ))}
                  {ms.map((m, k) => (
                    <g key={m.title} onMouseEnter={() => setTip({ x: x + step / 2, y: 30, text: `${m.title}: ${m.text}` })}>
                      <line x1={x + step / 2} x2={x + step / 2} y1={base} y2={22 + k * 30} className="pj-flagpole" />
                      <rect x={x + step / 2} y={14 + k * 30} width={12} height={10} style={{ fill: areaTone[m.area] }} />
                    </g>
                  ))}
                  {(i % 7 === 0 || d === last) && (
                    <text className="pj-axis" x={x + step / 2} y={TH - 8} textAnchor="middle">
                      {dShort.format(new Date(`${d}T12:00:00Z`))}
                    </text>
                  )}
                </g>
              );
            })}
            {tip && (
              <foreignObject x={Math.min(Math.max(0, tip.x - 160), TW - 320)} y={Math.max(0, tip.y - 64)} width={320} height={60} pointerEvents="none">
                <div className="pj-tip">{tip.text}</div>
              </foreignObject>
            )}
          </svg>
        </div>
        <p className="pj-legend">
          <span><i style={{ background: "var(--presence)" }} /> Tracker</span>
          <span><i style={{ background: "var(--gold)" }} /> Rückblick-Video</span>
          <span><i style={{ background: "var(--youtube)" }} /> YouTube</span>
        </p>
        <div className="box pj-dayinfo" data-tone="white">
          <h3 className="t-3">{dLong.format(new Date(`${day}T12:00:00Z`))}</h3>
          {(msDay.get(day) ?? []).map((m) => (
            <p key={m.title}>
              <strong>{m.title}:</strong> {m.text}
            </p>
          ))}
          {(byDay.get(day) ?? []).length ? (
            <ul>
              {(byDay.get(day) ?? []).map((p) => (
                <li key={p.pr}>
                  <span className="muted">#{p.pr}</span> {p.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">An diesem Tag keine Änderung an der Website.</p>
          )}
        </div>
      </div>
    </section>
  );
}
