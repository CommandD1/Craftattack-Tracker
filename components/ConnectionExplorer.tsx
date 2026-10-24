"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConnectionGraph, type GraphEdge, type GraphNode } from "./ConnectionGraph";
import { Head } from "./Head";
import { BASE_POINTS, DEFAULT_WEIGHTS, LINK_KINDS, weigh, type LinkCounts, type LinkKind, type Weights } from "@/lib/connectionWeights";
import { duration, num } from "@/lib/format";

/** Punkte und Faktoren mit höchstens zwei Nachkommastellen */
const dec = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
/** So viele Nachrichten ergeben bei Faktor 1 einen Punkt */
const MSGS_PER_POINT = Math.round(1 / BASE_POINTS.msgs);

const KIND: Record<LinkKind, { label: string; color: string; unit: (w: number) => string }> = {
  raid: { label: "Raids", color: "var(--twitch)", unit: (w) => `1 Raid = ${dec.format(BASE_POINTS.raid * w)} P.` },
  shared: { label: "Geteilte Chats", color: "var(--diamond)", unit: (w) => `1 geteilter Chat = ${dec.format(BASE_POINTS.shared * w)} P.` },
  msgs: { label: "Chat-Nachrichten", color: "var(--gold)", unit: (w) => `${MSGS_PER_POINT} Nachrichten = ${dec.format(MSGS_PER_POINT * BASE_POINTS.msgs * w)} P.` },
};

const PRESETS: { label: string; w: Weights }[] = [
  { label: "Ausgewogen", w: DEFAULT_WEIGHTS },
  { label: "Nur Raids", w: { raid: 1, shared: 0, msgs: 0 } },
  { label: "Nur geteilter Chat", w: { raid: 0, shared: 1, msgs: 0 } },
  { label: "Nur Chat", w: { raid: 0, shared: 0, msgs: 1 } },
];

type Show = "alle" | "online" | "live";
const SHOW: { key: Show; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "online", label: "Auf dem Server" },
  { key: "live", label: "Live" },
];

interface Settings {
  weights: Weights;
  /** Verbindungen unter so vielen Punkten ausblenden */
  min: number;
  show: Show;
  /** Hervorgehobener Spieler (ID) oder leer */
  focus: string;
}
const DEFAULTS: Settings = { weights: DEFAULT_WEIGHTS, min: 0, show: "alle", focus: "" };
const STORAGE_KEY = "ac.verbindungen.v1";

/** Gespeicherte Einstellungen des Besuchers; alles Unbekannte fällt auf die Standardwerte zurück */
function loadSettings(): Settings | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!raw || typeof raw !== "object") return null;
    const w = { ...DEFAULT_WEIGHTS };
    for (const k of LINK_KINDS) {
      const v = raw.weights?.[k];
      if (typeof v === "number" && v >= 0 && v <= 5) w[k] = v;
    }
    return {
      weights: w,
      min: typeof raw.min === "number" && raw.min >= 0 && raw.min <= 20 ? raw.min : 0,
      show: SHOW.some((s) => s.key === raw.show) ? (raw.show as Show) : "alle",
      focus: "",
    };
  } catch {
    return null;
  }
}

const sameWeights = (a: Weights, b: Weights) => LINK_KINDS.every((k) => a[k] === b[k]);

/**
 * Einstellungen, Graph und Tabelle der Verbindungen. Der Besucher legt fest, wie viel Raids, geteilte Chats und
 * Chat-Nachrichten zählen (Faktor 0 = aus), blendet schwache Verbindungen aus und kann einen Spieler hervorheben.
 * Alles wird im Browser gerechnet; die Einstellungen (ohne Hervorhebung) bleiben im Browser gespeichert.
 */
export function ConnectionExplorer({ nodes, edges }: { nodes: GraphNode[]; edges: LinkCounts[] }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));

  // Gespeicherte Einstellungen erst nach dem ersten Rendern lesen, sonst passt das Server-HTML nicht
  useEffect(() => {
    const saved = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalig nach dem Hydrieren
    if (saved) setS(saved);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ weights: s.weights, min: s.min, show: s.show }));
    } catch {
      /* Speicher gesperrt: Einstellungen gelten nur bis zum Neuladen */
    }
  }, [s.weights, s.min, s.show, loaded]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const shownEdges: GraphEdge[] = useMemo(() => {
    const visible = (id: string) => {
      const n = nodeById.get(id);
      if (!n) return false;
      return s.show === "alle" || (s.show === "online" ? n.online : n.live);
    };
    return edges
      .filter((e) => visible(e.a) && visible(e.b))
      .map((e) => ({ ...e, ...weigh(e, s.weights) }))
      .filter((e) => e.weight > 0 && e.weight >= s.min);
  }, [edges, nodeById, s.weights, s.min, s.show]);
  const shownNodes = useMemo(() => {
    const ids = new Set(shownEdges.flatMap((e) => [e.a, e.b]));
    return nodes.filter((n) => ids.has(n.id));
  }, [nodes, shownEdges]);
  const focus = s.focus && shownNodes.some((n) => n.id === s.focus) ? s.focus : null;
  const top = useMemo(
    () =>
      shownEdges
        .filter((e) => !focus || e.a === focus || e.b === focus)
        .sort((a, b) => b.weight - a.weight || b.chatSeconds - a.chatSeconds)
        .slice(0, 25),
    [shownEdges, focus],
  );
  const byName = useMemo(() => [...shownNodes].sort((a, b) => a.name.localeCompare(b.name, "de")), [shownNodes]);
  const name = (id: string) => nodeById.get(id)?.name ?? id;
  const changed = !sameWeights(s.weights, DEFAULTS.weights) || s.min !== DEFAULTS.min || s.show !== DEFAULTS.show || s.focus !== "";

  const Person = ({ id }: { id: string }) => (
    <Link href={`/spieler/${encodeURIComponent(id)}`} className="conn__person">
      <Head id={id} uuid={nodeById.get(id)?.uuid} name={name(id)} size={22} decorative />
      <span>{name(id)}</span>
    </Link>
  );

  return (
    <>
      <div className="box conn__controls" data-tone="white">
        <fieldset className="conn__group">
          <legend className="eyebrow">Gewichtung</legend>
          <div className="gb__seg" role="group" aria-label="Voreinstellungen">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" aria-pressed={sameWeights(s.weights, p.w)} onClick={() => set({ weights: p.w })}>
                {p.label}
              </button>
            ))}
          </div>
          {LINK_KINDS.map((k) => {
            const w = s.weights[k];
            return (
              <label key={k} className="conn__weight">
                <span className="conn__weight-name">
                  <i style={{ background: KIND[k].color }} aria-hidden="true" /> {KIND[k].label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.25}
                  value={w}
                  onChange={(e) => set({ weights: { ...s.weights, [k]: Number(e.target.value) } })}
                  aria-valuetext={w === 0 ? "aus" : `Faktor ${dec.format(w)}`}
                />
                <b className="num conn__weight-val">{w === 0 ? "aus" : `×${dec.format(w)}`}</b>
                <span className="muted conn__weight-unit">{w === 0 ? "zählt nicht" : KIND[k].unit(w)}</span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="conn__group">
          <legend className="eyebrow">Anzeige</legend>
          <label className="conn__weight">
            <span className="conn__weight-name">Mindeststärke</span>
            <input type="range" min={0} max={10} step={0.5} value={s.min} onChange={(e) => set({ min: Number(e.target.value) })} />
            <b className="num conn__weight-val">{s.min === 0 ? "alle" : `ab ${dec.format(s.min)} P.`}</b>
            <span className="muted conn__weight-unit">schwächere Verbindungen ausblenden</span>
          </label>
          <div className="conn__row">
            <span className="conn__weight-name">Spieler</span>
            <div className="gb__seg" role="group" aria-label="Spieler">
              {SHOW.map((o) => (
                <button key={o.key} type="button" aria-pressed={s.show === o.key} onClick={() => set({ show: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <label className="conn__row gb__select">
            <span className="conn__weight-name">Hervorheben</span>
            <select value={focus ?? ""} onChange={(e) => set({ focus: e.target.value })}>
              <option value="">Niemand</option>
              {byName.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <div className="conn__row">
            <span className="muted">
              {num(shownNodes.length)} Spieler · {num(shownEdges.length)} Verbindungen
            </span>
            {changed && (
              <button type="button" className="tag conn__reset" onClick={() => setS({ ...DEFAULTS })}>
                Zurücksetzen
              </button>
            )}
          </div>
        </fieldset>
      </div>

      <div className="box conn__box" data-tone="white">
        <ConnectionGraph nodes={shownNodes} edges={shownEdges} focus={focus} />
        <ul className="conn__legend muted">
          <li>
            <i style={{ background: "var(--twitch)" }} /> vor allem Raids
          </li>
          <li>
            <i style={{ background: "var(--diamond)" }} /> vor allem geteilter Chat
          </li>
          <li>
            <i style={{ background: "var(--gold)" }} /> vor allem Chat-Nachrichten
          </li>
          <li>
            <i style={{ background: "var(--grass)" }} /> gerade im geteilten Chat
          </li>
          <li>Lila Rahmen: live · grünes Kästchen: auf dem Server · Kopf ziehen zum Verschieben, anklicken fürs Profil</li>
        </ul>
      </div>

      <div className="section-head" style={{ marginTop: 48 }}>
        <h2 className="t-2">{focus ? `Verbindungen von ${name(focus)}` : "Stärkste Verbindungen"}</h2>
        <p className="muted">Punkte nach der eingestellten Gewichtung</p>
      </div>
      {top.length === 0 ? (
        <p className="muted">Mit diesen Einstellungen gibt es keine Verbindungen.</p>
      ) : (
        <div className="box" data-tone="white">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Spieler</th>
                  <th />
                  <th className="num">Raids →</th>
                  <th className="num">← Raids</th>
                  <th className="num">Geteilte Chats</th>
                  <th className="num">Zeit im Chat</th>
                  <th className="num" title="Nachrichten des ersten Spielers im Chat des zweiten">
                    Nachr. →
                  </th>
                  <th className="num" title="Nachrichten des zweiten Spielers im Chat des ersten">
                    ← Nachr.
                  </th>
                  <th className="num">Punkte</th>
                </tr>
              </thead>
              <tbody>
                {top.map((e) => (
                  <tr key={`${e.a}|${e.b}`}>
                    <td>
                      <Person id={e.a} />
                    </td>
                    <td>
                      <Person id={e.b} />
                    </td>
                    <td className="num">{e.raidsAB ? num(e.raidsAB) : "–"}</td>
                    <td className="num">{e.raidsBA ? num(e.raidsBA) : "–"}</td>
                    <td className="num">
                      {e.now && (
                        <span className="tag" data-tone="grass" style={{ fontSize: ".75rem", padding: "1px 6px", marginRight: 6 }}>
                          jetzt
                        </span>
                      )}
                      {e.chats ? num(e.chats) : "–"}
                    </td>
                    <td className="num">{e.chatSeconds ? duration(e.chatSeconds) : "–"}</td>
                    <td className="num">{e.msgsAB ? num(e.msgsAB) : "–"}</td>
                    <td className="num">{e.msgsBA ? num(e.msgsBA) : "–"}</td>
                    <td className="num">
                      <b>{dec.format(e.weight)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
