"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";
import { useRouter } from "next/navigation";
import { ADVANCEMENTS, ADV_CATEGORIES, type AdvCategory, type Advancement } from "@/lib/advancements";
import { BASE_PATH } from "@/lib/estimateMode";

interface Status {
  at?: number;
  guess?: string;
  /** Ereignis-ID der Feed-Meldung */
  ev?: string;
}

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const FRAME_LABEL = { task: "Fortschritt", goal: "Ziel", challenge: "Aufgabe" } as const;
const BG: Record<AdvCategory, string> = { story: "stone", nether: "nether", end: "end", adventure: "adventure", husbandry: "husbandry" };

/** Wie im Spiel bei GUI-Größe 2: Rahmen 26 px → 52 px, Symbol 16 px → 32 px, Abstände 28 × 27 → 56 × 54 */
const SCALE = 2;
const COL = 28 * SCALE;
const ROW = 27 * SCALE;
const NODE = 26 * SCALE;
const PAD = 12 * SCALE;
/** Sprite public/fortschritt/icons.png: 16 Spalten, 64-px-Felder (Inventar-Symbole von minecraft.wiki/w/Advancement, © Mojang), angezeigt in 32 px */
const SPRITE_COLS = 16;

interface Placed {
  a: Advancement;
  x: number;
  y: number;
}

/** Baum je Kategorie: Tiefe nach rechts, Blätter untereinander, Eltern mittig zu ihren Kindern */
function layout(cat: AdvCategory): { nodes: Placed[]; width: number; height: number } {
  const list = ADVANCEMENTS.filter((a) => a.cat === cat);
  const kids = new Map<string, Advancement[]>();
  for (const a of list) if (a.parent) (kids.get(a.parent) ?? kids.set(a.parent, []).get(a.parent)!).push(a);
  const row = new Map<string, number>();
  let next = 0;
  const place = (a: Advancement): number => {
    const ch = kids.get(a.id) ?? [];
    if (!ch.length) {
      row.set(a.id, next++);
      return row.get(a.id)!;
    }
    const rs = ch.map(place);
    const r = (rs[0] + rs[rs.length - 1]) / 2;
    row.set(a.id, r);
    return r;
  };
  for (const root of list.filter((a) => !a.parent)) place(root);
  const nodes = list.map((a) => ({ a, x: PAD + a.depth * COL, y: PAD + (row.get(a.id) ?? 0) * ROW }));
  const width = Math.max(...nodes.map((n) => n.x)) + NODE + PAD;
  const height = Math.max(...nodes.map((n) => n.y)) + NODE + PAD;
  return { nodes, width, height };
}

function Icon({ index, size = 32 }: { index: number; size?: number }) {
  const f = size / 16;
  return (
    <span
      className="fstree__icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${BASE_PATH}/fortschritt/icons.png)`,
        backgroundSize: `${SPRITE_COLS * 16 * f}px auto`,
        backgroundPosition: `-${(index % SPRITE_COLS) * size}px -${Math.floor(index / SPRITE_COLS) * size}px`,
      }}
    />
  );
}

/**
 * Fortschritte wie im Spiel: Reiter je Kategorie, Baum mit Original-Rahmen und -Symbolen auf dem Reiter-Hintergrund.
 * Gold = gemeldet, gold mit „?“ = vermutet, grau = noch nicht gesehen. Text nur im Tooltip (Zeigen oder Tippen).
 * Die Fläche lässt sich wie im Spiel mit der Maus ziehen.
 *
 * `eventBase` (z. B. „/ereignis“): gemeldete Fortschritte führen auf `${eventBase}/<Ereignis-ID>` (Maus/Tastatur: Klick;
 * Touch: erstes Tippen zeigt den Tooltip, zweites öffnet). Ohne `eventBase` keine Links.
 */
export function AdvancementBoard({
  mine,
  others,
  players,
  eventBase,
}: {
  mine: Record<string, Status>;
  others: Record<string, [number, number]>;
  players: number;
  eventBase?: string;
}) {
  const router = useRouter();
  const hrefOf = (s?: Status) => (eventBase && s?.ev ? `${eventBase}/${encodeURIComponent(s.ev)}` : null);
  const [cat, setCatState] = useState<AdvCategory>("story");
  // Gewählten Reiter über Neuladen hinweg behalten (z. B. wenn eine neue Version der Website kommt)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("ac.adv.tab") as AdvCategory | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- gespeicherte Auswahl erst nach dem Hydrieren lesen
      if (saved && ADV_CATEGORIES.some((c) => c.key === saved)) setCatState(saved);
    } catch {}
  }, []);
  const setCat = (c: AdvCategory) => {
    setCatState(c);
    try {
      sessionStorage.setItem("ac.adv.tab", c);
    } catch {}
  };
  const [tip, setTip] = useState<{ id: string; pinned: boolean } | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const { nodes, width, height } = useMemo(() => layout(cat), [cat]);
  const pos = useMemo(() => new Map(nodes.map((n) => [n.a.id, n])), [nodes]);
  const total = ADVANCEMENTS.length;
  const done = ADVANCEMENTS.filter((a) => mine[a.id]?.at).length;
  const guessed = ADVANCEMENTS.filter((a) => mine[a.id]?.guess).length;
  const tipNode = tip ? pos.get(tip.id) : undefined;
  // Vorab nur, was die erste Ansicht braucht (sonst warnt der Browser über ungenutzte Preloads); der Rest kommt
  // nach dem Laden still in den Cache, damit beim Umschalten nichts kurz fehlt
  preload(`${BASE_PATH}/fortschritt/icons.png`, { as: "image" });
  preload(`${BASE_PATH}/fortschritt/bg-${BG[cat]}.png`, { as: "image" });
  for (const st of ["obtained", "unobtained"]) preload(`${BASE_PATH}/fortschritt/task-${st}.png`, { as: "image" });
  useEffect(() => {
    const urls = [
      ...["goal", "challenge"].flatMap((f) => ["obtained", "unobtained"].map((st) => `${BASE_PATH}/fortschritt/${f}-${st}.png`)),
      ...Object.values(BG).map((b) => `${BASE_PATH}/fortschritt/bg-${b}.png`),
    ];
    const load = () => urls.forEach((u) => (new Image().src = u));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(load);
    else setTimeout(load, 1500);
  }, []);
  // Wie im Spiel: die Wurzel der Kategorie im Blick (senkrecht mittig)
  useEffect(() => {
    const v = view.current;
    const root = nodes.find((n) => !n.a.parent);
    if (v && root) v.scrollTo({ left: 0, top: Math.max(0, root.y + NODE / 2 - v.clientHeight / 2) });
  }, [nodes]);

  // Verbindungen wie im Spiel: waagerecht aus dem Elternteil, senkrecht, waagerecht ins Kind
  const lines = nodes
    .filter((n) => n.a.parent && pos.has(n.a.parent))
    .map((n) => {
      const p = pos.get(n.a.parent!)!;
      const x1 = p.x + NODE / 2;
      const y1 = p.y + NODE / 2;
      const x2 = n.x + NODE / 2;
      const y2 = n.y + NODE / 2;
      const mx = x2 - COL / 2;
      return { id: n.a.id, d: `M${x1} ${y1}H${mx}V${y2}H${x2}`, on: Boolean(mine[n.a.id]) };
    });

  return (
    <div className="fstree">
      <div className="fsb__summary">
        <p>
          <b className="fsb__big num">{done + guessed}</b> <span className="muted">von {total}</span>
          <span className="fsb__legend">
            <i className="fsb__sw fsb__sw--done" /> {done} gemeldet <i className="fsb__sw fsb__sw--guess" /> {guessed} vermutet
          </span>
        </p>
        <span className="fsb__bar" aria-hidden="true">
          <i className="fsb__bar-done" style={{ width: `${(100 * done) / total}%` }} />
          <i className="fsb__bar-guess" style={{ width: `${(100 * guessed) / total}%` }} />
        </span>
      </div>

      <div className="fstree__tabs" role="group" aria-label="Kategorie">
        {ADV_CATEGORIES.map((c) => {
          const list = ADVANCEMENTS.filter((a) => a.cat === c.key);
          const root = list.find((a) => !a.parent)!;
          const n = list.filter((a) => mine[a.id]).length;
          return (
            <button
              key={c.key}
              type="button"
              className="fstree__tab"
              aria-pressed={cat === c.key}
              title={`${c.label}: ${n} von ${list.length}`}
              onClick={() => {
                setCat(c.key);
                setTip(null);
              }}
            >
              <Icon index={root.icon} />
              <span className="fstree__tabcount">
                {n}/{list.length}
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={view}
        className="fstree__view"
        style={{ backgroundImage: `url(${BASE_PATH}/fortschritt/bg-${BG[cat]}.png)`, maxHeight: Math.min(height + 4, 560) }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || !view.current) return;
          drag.current = { x: e.clientX, y: e.clientY, sl: view.current.scrollLeft, st: view.current.scrollTop, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !view.current) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          view.current.scrollLeft = d.sl - dx;
          view.current.scrollTop = d.st - dy;
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onPointerLeave={() => (drag.current = null)}
      >
        <div className="fstree__canvas" style={{ width, height }}>
          <svg className="fstree__lines" width={width} height={height} aria-hidden="true">
            {lines.map((l) => (
              <path key={`o${l.id}`} d={l.d} className="fstree__line-outer" />
            ))}
            {lines.map((l) => (
              <path key={`i${l.id}`} d={l.d} className={l.on ? "fstree__line-inner fstree__line-inner--on" : "fstree__line-inner"} />
            ))}
          </svg>
          {nodes.map(({ a, x, y }) => {
            const s = mine[a.id];
            const state = s?.at ? "done" : s?.guess ? "guess" : "open";
            return (
              <button
                key={a.id}
                type="button"
                className={`fstree__node fstree__node--${state}${hrefOf(s) ? " fstree__node--link" : ""}`}
                style={{ left: x, top: y, width: NODE, height: NODE, backgroundImage: `url(${BASE_PATH}/fortschritt/${a.frame}-${state === "open" ? "unobtained" : "obtained"}.png)` }}
                aria-label={`${a.title}: ${state === "done" ? "erzielt" : state === "guess" ? "vermutlich erzielt" : "nicht gesehen"}`}
                aria-describedby={tip?.id === a.id ? "advt-tip" : undefined}
                onPointerEnter={(e) => e.pointerType === "mouse" && !tip?.pinned && setTip({ id: a.id, pinned: false })}
                onPointerLeave={(e) => e.pointerType === "mouse" && !tip?.pinned && setTip(null)}
                onFocus={() => setTip({ id: a.id, pinned: false })}
                onBlur={() => setTip((t) => (t?.pinned ? t : null))}
                onClick={(e) => {
                  if (drag.current?.moved) return;
                  const href = hrefOf(s);
                  const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
                  if (href && (!touch || (tip?.id === a.id && tip.pinned))) {
                    router.push(href);
                    return;
                  }
                  setTip((t) => (t?.id === a.id && t.pinned ? null : { id: a.id, pinned: true }));
                }}
              >
                <Icon index={a.icon} />
                {state === "guess" && <span className="fstree__q">?</span>}
              </button>
            );
          })}
          {tipNode && (
            <Tip
              a={tipNode.a}
              s={mine[tipNode.a.id]}
              share={others[tipNode.a.id] ?? [0, 0]}
              players={players}
              link={hrefOf(mine[tipNode.a.id]) ? (tip?.pinned ? "Nochmal tippen öffnet das Ereignis" : "Klicken öffnet das Ereignis") : undefined}
              x={tipNode.x}
              y={tipNode.y}
              flip={tipNode.x + NODE + 300 > width && tipNode.x > 300}
            />
          )}
        </div>
      </div>
      <p className="muted fstree__note">Ziehen zum Verschieben, Zeigen oder Tippen für Details{eventBase ? ", Klick auf einen gemeldeten Fortschritt öffnet sein Ereignis" : ""}. Grafiken aus Minecraft © Mojang, keine offizielle Seite.</p>
    </div>
  );
}

function Tip({ a, s, share, players, link, x, y, flip }: { a: Advancement; s?: Status; share: [number, number]; players: number; link?: string; x: number; y: number; flip: boolean }) {
  const state = s?.at ? "done" : s?.guess ? "guess" : "open";
  const [rep, gue] = share;
  return (
    <div id="advt-tip" role="tooltip" className={`fstree__tip fstree__tip--${state}`} style={flip ? { right: `calc(100% - ${x}px + 6px)`, top: y } : { left: x + NODE + 6, top: y }}>
      <b className="fstree__tiphead">{a.title}</b>
      <span>{a.desc}</span>
      <span className="fstree__tipmeta">
        {state === "done" && <>Erzielt am {date.format(s!.at!)}</>}
        {state === "guess" && <>Vermutlich erzielt: {s!.guess}</>}
        {state === "open" && <>Noch nicht gesehen</>} · {FRAME_LABEL[a.frame]}
      </span>
      <span className="fstree__tipmeta">
        {players ? Math.round((100 * (rep + gue)) / players) : 0} % der Spieler ({rep + gue} von {players}
        {gue ? `, davon ${gue} vermutet` : ""})
      </span>
      {link && <span className="fstree__tiplink">{link} →</span>}
    </div>
  );
}
