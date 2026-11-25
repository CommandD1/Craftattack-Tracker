"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerSearch } from "./PlayerSearch";
import { faceUrl } from "@/lib/faceBmp";
import type { VoiceDay, VoiceFaces, VoiceFix, VoiceHead, VoiceRun } from "@/lib/voiceDays";

/**
 * Voicechat-Zeitstrahl eines Tages: Zeilen = Spieler, Spalten = Minuten, Farbe = Gruppe. Je Minute wird für jeden
 * Streamer die Liste genommen, die er am längsten zeigte; Listen mit gemeinsamen Spielern bilden eine Gruppe. Zeigen
 * zwei Streamer derselben Gruppe verschiedene vollständig erkannte Listen, ist das ein Konflikt (meist ein falsch
 * erkannter Kopf oder ein Wechsel innerhalb der Minute). Klick öffnet die Listen dieser Minute zum Korrigieren.
 */

type Players = Record<string, { name: string; face: string | null }>;
type Cell = { g: number; c: boolean; inf: boolean };
type Source = { s: string; run: number; list: number };
type Group = { id: number; ids: Set<string>; src: Source[]; conflict: Set<string>; open: number };

const PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#edc948", "#76b7b2", "#ff9da7", "#9c755f", "#86bcb6", "#d37295", "#a0cbe8", "#8cd17d"];
const PX = 2; // px je Minute
const ROW = 16;
const LEFT = 130;
const KIND: Record<VoiceHead[1], string> = { p: "erkannt", i: "gefolgert", o: "offen", j: "kein Kopf", x: "fremd" };
// Minuten ab Tagesbeginn (06:00) → Uhrzeit; der Tag beginnt laut Export immer um 06:00 Berliner Zeit
const hm = (m: number) => {
  const c = m + 360;
  return `${String(Math.floor(c / 60) % 24).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};
const hms = (s: number) => `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;

export function VoiceTimeline({ day, players, endpoint, fileBase }: { day: string; players: Players; endpoint: string; fileBase: string }) {
  const [data, setData] = useState<VoiceDay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fixes, setFixes] = useState<VoiceFix[]>([]);
  const [faces, setFaces] = useState<VoiceFaces | null>(null);
  const [sel, setSel] = useState<{ p: string; m: number } | null>(null);
  const [only, setOnly] = useState<"alle" | "konflikte">("alle");
  const facesLoading = useRef(false);

  useEffect(() => {
    // Neuer Tag = neue Komponente (key={day} auf der Seite), deshalb hier nichts zurücksetzen
    let off = false;
    Promise.all([
      fetch(`${fileBase}/${day}.json`).then((r) => (r.ok ? (r.json() as Promise<VoiceDay>) : Promise.reject(new Error(`HTTP ${r.status}`)))),
      post({ op: "get", day }),
    ])
      .then(([d, f]) => {
        if (off) return;
        setData(d);
        setFixes(f.fixes);
      })
      .catch((e) => !off && setErr(String(e?.message ?? e)));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  async function post(body: unknown): Promise<{ fixes: VoiceFix[] }> {
    const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  // Gesichter erst laden, wenn das Korrektur-Fenster offen ist
  useEffect(() => {
    if (!sel || faces || facesLoading.current) return;
    facesLoading.current = true;
    fetch(`${fileBase}/${day}-faces.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((f: VoiceFaces) => setFaces(f))
      .catch(() => setFaces({}));
  }, [sel, faces, day, fileBase]);

  const pending = useMemo(() => fixes.filter((f) => !data?.fixes.includes(f.id)), [fixes, data]);

  /** Kopf nach noch nicht übernommenen Korrekturen */
  const headAt = useMemo(() => {
    return (s: string, run: VoiceRun, k: number, h: VoiceHead): VoiceHead => {
      if (!data || !pending.length || h[1] === "j" || h[1] === "x") return h;
      const a = (data.start + run[0]) * 1000, b = (data.start + run[1]) * 1000;
      for (const f of pending) {
        if (f.streamer !== s || b < f.from || a > f.until) continue;
        if (f.scope === "run" && f.slot !== k) continue;
        const same = f.was.i ? h[0] === f.was.i : !h[0] && (f.scope === "run" || run[6][k] === f.was.u);
        if (!same) continue;
        return f.to === "-" ? [null, "j", 1] : f.to === "?" ? [null, "x", 1] : [f.to, "p", 1];
      }
      return h;
    };
  }, [data, pending]);

  const model = useMemo(() => (data ? build(data, headAt) : null), [data, headAt]);

  if (err) return <p className="box" data-tone="redstone">Tag konnte nicht geladen werden: {err}</p>;
  if (!data || !model) return <p className="muted">Lade {day} …</p>;

  const name = (id: string | null) => (id ? (players[id]?.name ?? id) : "?");
  const rows = only === "konflikte" ? model.rows.filter((r) => model.conflictMin.get(r)) : model.rows;
  const width = (model.to - model.from + 1) * PX;
  const hours: number[] = [];
  for (let h = Math.ceil(model.from / 60) * 60; h <= model.to; h += 60) hours.push(h);

  return (
    <div className="vt">
      <div className="vt-bar">
        <span>
          {model.rows.length} Spieler in Gruppen · {model.groupCount} Gruppen · <b>{model.conflicts.length}</b> Konflikte (ab 2 Min) · {model.openMinutes} Minuten mit offenen Köpfen
        </span>
        <span className="vt-seg" role="group" aria-label="Zeilen">
          <button type="button" aria-pressed={only === "alle"} onClick={() => setOnly("alle")}>
            Alle
          </button>
          <button type="button" aria-pressed={only === "konflikte"} onClick={() => setOnly("konflikte")}>
            Nur mit Konflikt
          </button>
        </span>
      </div>

      <div className="vt-scroll">
        <svg width={LEFT + width + 10} height={rows.length * ROW + 24} className="vt-svg" role="img" aria-label={`Voicechat-Gruppen am ${day}`}>
          {hours.map((h) => (
            <g key={h}>
              <line x1={LEFT + (h - model.from) * PX} x2={LEFT + (h - model.from) * PX} y1={14} y2={rows.length * ROW + 18} className="vt-hour" />
              <text x={LEFT + (h - model.from) * PX + 2} y={10} className="vt-tick">
                {hm(h)}
              </text>
            </g>
          ))}
          {rows.map((p, i) => {
            const y = 18 + i * ROW;
            const cov = model.coverage.get(p) ?? [];
            const segs = model.segs.get(p) ?? [];
            return (
              <g key={p}>
                <text x={LEFT - 6} y={y + 11} textAnchor="end" className="vt-name" data-sel={sel?.p === p || undefined}>
                  {name(p)}
                </text>
                {cov.map(([a, b]) => (
                  <rect key={`c${a}`} x={LEFT + (a - model.from) * PX} y={y + ROW - 4} width={(b - a + 1) * PX} height={2} className="vt-cov" />
                ))}
                {segs.map(([a, b, c]) => (
                  <rect
                    key={a}
                    x={LEFT + (a - model.from) * PX}
                    y={y + 1}
                    width={(b - a + 1) * PX}
                    height={ROW - 6}
                    fill={PALETTE[c.g % PALETTE.length]}
                    opacity={c.inf ? 0.45 : 1}
                    className={c.c ? "vt-cell vt-conf" : "vt-cell"}
                    onClick={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      const m = model.from + Math.floor((e.clientX - box.left - LEFT) / PX);
                      setSel({ p, m: Math.max(a, Math.min(b, m)) });
                    }}
                  >
                    <title>{`${name(p)} ${hm(a)}–${hm(b + 1)}: ${[...(model.groupAt(a, p)?.ids ?? [])].map(name).join(", ")}${c.c ? " · Konflikt" : ""}${c.inf ? " · nur gefolgert" : ""}`}</title>
                  </rect>
                ))}
                {sel?.p === p && <rect x={LEFT + (sel.m - model.from) * PX - 1} y={y - 1} width={PX + 2} height={ROW - 2} className="vt-mark" />}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="muted vt-legend">
        Farbe = Gruppe (bleibt gleich, solange die Gruppe ungefähr dieselbe ist) · blass = nur gefolgert · <span className="vt-k vt-k--conf" /> Konflikt: Streamer
        derselben Gruppe zeigen verschiedene vollständige Listen · grauer Strich = dieser Spieler wurde selbst gescannt (kein Balken darüber = allein).
        Klick auf einen Balken öffnet die Listen dieser Minute.
      </p>

      {model.conflicts.length > 0 && (
        <details className="vt-conflicts">
          <summary>Konflikte nach Dauer ({model.conflicts.length})</summary>
          <ol>
            {model.conflicts.slice(0, 80).map((c) => (
              <li key={`${c.p}-${c.a}`}>
                <button type="button" className="linkish" onClick={() => setSel({ p: c.p, m: c.a })}>
                  {name(c.p)} {hm(c.a)}–{hm(c.b + 1)}
                </button>{" "}
                <span className="muted">({c.b - c.a + 1} Min)</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {sel && (
        <Panel
          key={`${sel.p}-${sel.m}`}
          sel={sel}
          data={data}
          model={model}
          players={players}
          faces={faces}
          headAt={headAt}
          onClose={() => setSel(null)}
          onFix={async (fix) => setFixes((await post({ op: "add", fix })).fixes)}
        />
      )}

      <section className="vt-fixes">
        <h2 className="t-3">Korrekturen an diesem Tag ({fixes.length})</h2>
        {fixes.length === 0 ? (
          <p className="muted">Noch keine.</p>
        ) : (
          <ul>
            {fixes.map((f) => (
              <li key={f.id}>
                <b>{name(f.streamer)}</b> {new Date(f.from).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}
                {f.scope === "run" ? `–${new Date(f.until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}, Platz ${f.slot + 1}` : " ganzer Tag"} ·{" "}
                {f.was.i ? name(f.was.i) : "offener Kopf"} → <b>{f.to === "-" ? "kein Kopf" : f.to === "?" ? "fremd" : name(f.to)}</b>{" "}
                <span className="muted">{data.fixes.includes(f.id) ? "übernommen" : "wartet auf den Stundenlauf"}</span>{" "}
                <button type="button" className="linkish" onClick={async () => setFixes((await post({ op: "del", id: f.id, day })).fixes)}>
                  entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Korrekturen wirken hier sofort. In den Scan übernommen werden sie zur vollen Stunde; danach folgert der Scan die übrigen Köpfe mit den
          korrigierten neu. Ein schon übernommener Eintrag lässt sich nur noch aus der Liste entfernen, nicht im Scan zurückdrehen.
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Modell */

type Model = ReturnType<typeof build>;

function build(d: VoiceDay, headAt: (s: string, run: VoiceRun, k: number, h: VoiceHead) => VoiceHead) {
  let from = Infinity, to = -Infinity;
  for (const runs of Object.values(d.streamers))
    for (const r of runs) {
      from = Math.min(from, Math.floor(r[0] / 60));
      to = Math.max(to, Math.floor(r[1] / 60));
    }
  if (!Number.isFinite(from)) from = to = 0;
  const N = to - from + 1;
  const streamers = Object.keys(d.streamers);
  const ptr = new Map(streamers.map((s) => [s, 0]));
  const cells = new Map<string, (Cell | undefined)[]>();
  const coverage = new Map<string, [number, number][]>();
  const groupsByMin: Group[][] = [];
  let prev: Group[] = [];
  let nextId = 0;
  let openMinutes = 0;
  const resolved = (s: string, ri: number, li: number) => {
    const run = d.streamers[s][ri];
    return d.lists[li].map((h, k) => headAt(s, run, k, h));
  };

  for (let i = 0; i < N; i++) {
    const m = from + i, a = m * 60, b = a + 60;
    const srcs: { s: string; run: number; list: number; ids: string[]; inf: Set<string>; open: number }[] = [];
    for (const s of streamers) {
      const runs = d.streamers[s];
      let p = ptr.get(s)!;
      while (p < runs.length && runs[p][1] + 10 <= a) p++;
      ptr.set(s, p);
      let best = -1, bestLen = 0, covered = false;
      for (let q = p; q < runs.length && runs[q][0] < b; q++) {
        covered = true;
        const len = Math.min(b, runs[q][1] + 10) - Math.max(a, runs[q][0]);
        if (runs[q][2] >= 0 && len > bestLen) {
          bestLen = len;
          best = q;
        }
      }
      if (covered) {
        const cv = coverage.get(s) ?? [];
        const last = cv.at(-1);
        if (last && last[1] === m - 1) last[1] = m;
        else cv.push([m, m]);
        coverage.set(s, cv);
      }
      if (best < 0) continue;
      const heads = resolved(s, best, runs[best][2]);
      const ids: string[] = [];
      const inf = new Set<string>();
      let open = 0;
      for (const h of heads) {
        if (h[1] === "o") open++;
        if (!h[0] || h[1] === "j" || h[1] === "x") continue;
        ids.push(h[0]);
        if (h[1] === "i") inf.add(h[0]);
      }
      if (ids.length + open >= 2) srcs.push({ s, run: best, list: runs[best][2], ids, inf, open });
    }
    // Listen mit gemeinsamen Spielern zusammenfassen
    const parent = srcs.map((_, k) => k);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const owner = new Map<string, number>();
    srcs.forEach((x, k) => {
      for (const id of x.ids) {
        const o = owner.get(id);
        if (o === undefined) owner.set(id, k);
        else parent[find(k)] = find(o);
      }
    });
    const byRoot = new Map<number, typeof srcs>();
    srcs.forEach((x, k) => {
      const r = find(k);
      (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(x);
    });
    const groups: Group[] = [];
    for (const part of byRoot.values()) {
      const ids = new Set(part.flatMap((x) => x.ids));
      if (ids.size < 2) continue;
      // Konflikt = vertauschter Kopf: zwei vollständig erkannte, gleich lange Listen derselben Gruppe zeigen
      // verschiedene Spieler. Verschieden lange Listen sind meist nur ein kurz verdeckter Kopf oder ein Wechsel → kein Konflikt.
      const conflict = new Set<string>();
      const full = part.filter((x) => x.open === 0);
      for (let u = 0; u < full.length; u++)
        for (let v = u + 1; v < full.length; v++) {
          if (full[u].ids.length !== full[v].ids.length) continue;
          const A = new Set(full[u].ids), B = new Set(full[v].ids);
          for (const id of A) if (!B.has(id)) conflict.add(id);
          for (const id of B) if (!A.has(id)) conflict.add(id);
        }
      groups.push({ id: -1, ids, src: part.map((x) => ({ s: x.s, run: x.run, list: x.list })), conflict, open: Math.max(...part.map((x) => x.open)) });
    }
    // Farbe weitergeben: größte Überschneidung mit einer Gruppe der Minute davor
    const taken = new Set<number>();
    for (const g of groups) {
      let best: Group | null = null, score = 0;
      for (const p of prev) {
        if (taken.has(p.id)) continue;
        let common = 0;
        for (const id of g.ids) if (p.ids.has(id)) common++;
        const j = common / (g.ids.size + p.ids.size - common);
        if (j > score) {
          score = j;
          best = p;
        }
      }
      g.id = best && score >= 0.34 ? best.id : nextId++;
      taken.add(g.id);
      const infAll = new Set<string>();
      for (const id of g.ids) {
        const all = srcs.filter((x) => g.src.some((y) => y.s === x.s) && x.ids.includes(id));
        if (all.length && all.every((x) => x.inf.has(id))) infAll.add(id);
      }
      for (const id of g.ids) {
        const row = cells.get(id) ?? cells.set(id, new Array(N)).get(id)!;
        row[i] = { g: g.id, c: g.conflict.has(id), inf: infAll.has(id) };
      }
    }
    if (groups.some((g) => g.open > 0)) openMinutes++;
    groupsByMin.push(groups);
    // nach einer kurzen Lücke (niemand in einer Gruppe) behalten Gruppen ihre Farbe
    if (groups.length) prev = groups;
  }

  // Zeilen: Reihenfolge nach erstem Auftreten; Abschnitte gleicher Gruppe zusammenfassen
  const first = new Map<string, number>();
  const segs = new Map<string, [number, number, Cell][]>();
  const conflicts: { p: string; a: number; b: number }[] = [];
  const conflictMin = new Map<string, number>();
  for (const [p, row] of cells) {
    const out: [number, number, Cell][] = [];
    for (let i = 0; i < N; i++) {
      const c = row[i];
      if (!c) continue;
      if (!first.has(p)) first.set(p, i);
      const last = out.at(-1);
      if (last && last[1] === from + i - 1 && last[2].g === c.g && last[2].c === c.c && last[2].inf === c.inf) last[1] = from + i;
      else out.push([from + i, from + i, c]);
    }
    segs.set(p, out);
    for (const [a, b, c] of out)
      if (c.c) {
        const lastC = conflicts.at(-1);
        if (lastC && lastC.p === p && lastC.b >= a - 2) lastC.b = b;
        else conflicts.push({ p, a, b });
        conflictMin.set(p, (conflictMin.get(p) ?? 0) + b - a + 1);
      }
  }
  // einzelne Minuten sind oft nur ein Wechsel innerhalb der Minute → Liste erst ab 2 Minuten
  const longConflicts = conflicts.filter((c) => c.b > c.a).sort((x, y) => y.b - y.a - (x.b - x.a));
  const rows = [...cells.keys()].sort((x, y) => first.get(x)! - first.get(y)!);
  const ids = new Set<number>();
  for (const gs of groupsByMin) for (const g of gs) ids.add(g.id);
  const groupAt = (m: number, p: string) => groupsByMin[m - from]?.find((g) => g.ids.has(p)) ?? null;
  return { from, to, rows, segs, coverage, conflicts: longConflicts, conflictMin, groupCount: ids.size, openMinutes, groupAt, groupsByMin };
}

/* ------------------------------------------------------------------ Korrektur-Fenster */

function Panel({
  sel,
  data,
  model,
  players,
  faces,
  headAt,
  onClose,
  onFix,
}: {
  sel: { p: string; m: number };
  data: VoiceDay;
  model: Model;
  players: Players;
  faces: VoiceFaces | null;
  headAt: (s: string, run: VoiceRun, k: number, h: VoiceHead) => VoiceHead;
  onClose: () => void;
  onFix: (fix: Omit<VoiceFix, "id" | "at">) => Promise<void>;
}) {
  const g = model.groupAt(sel.m, sel.p);
  const name = (id: string | null) => (id ? (players[id]?.name ?? id) : "?");
  const pick = useMemo(() => Object.entries(players).map(([id, p]) => ({ id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, "de")), [players]);
  const [edit, setEdit] = useState<{ s: string; run: number; k: number } | null>(null);
  const [scope, setScope] = useState<"run" | "day">("run");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sources = g?.src ?? [];
  const save = async (s: string, ri: number, k: number, h: VoiceHead, to: string) => {
    const run = data.streamers[s][ri];
    setBusy(true);
    setMsg(null);
    try {
      await onFix({
        day: data.day,
        streamer: s,
        from: (data.start + (scope === "run" ? run[0] : 0)) * 1000,
        until: (data.start + (scope === "run" ? run[1] + 9 : 90000)) * 1000,
        scope,
        slot: k,
        was: { i: h[0], u: run[6][k] ?? null },
        to,
      });
      setEdit(null);
      setMsg("Gespeichert.");
    } catch (e) {
      setMsg(`Fehler: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="box vt-panel" data-tone="white" aria-label="Listen dieser Minute">
      <header className="vt-panel__head">
        <h2 className="t-3">
          {name(sel.p)} um {hm(sel.m)}
        </h2>
        <button type="button" className="btn btn--small" data-tone="white" onClick={onClose}>
          Schließen
        </button>
      </header>
      {!g ? (
        <p className="muted">In dieser Minute in keiner Gruppe.</p>
      ) : (
        <>
          <p className="muted">
            Gruppe: {[...g.ids].map(name).join(", ")}
            {g.open > 0 && ` · ${g.open} offen`}
            {g.conflict.size > 0 && <> · Konflikt bei {[...g.conflict].map(name).join(", ")}</>}
          </p>
          <div className="vt-lists">
            {sources.map(({ s, run: ri, list }) => {
              const run = data.streamers[s][ri];
              const heads = data.lists[list].map((h, k) => headAt(s, run, k, h));
              const sec = run[4] * 10 + Math.max(0, sel.m * 60 - run[0]);
              return (
                <div key={s} className="vt-list">
                  <p className="vt-list__who">
                    <b>{name(s)}</b>{" "}
                    <span className="muted">
                      {hm(Math.floor(run[0] / 60))}–{hm(Math.floor((run[1] + 10) / 60))}
                    </span>{" "}
                    <a href={`https://www.twitch.tv/videos/${run[3]}?t=${hms(sec)}`} target="_blank" rel="noopener noreferrer">
                      ▶ VOD
                    </a>
                  </p>
                  <ol>
                    {heads.map((h, k) => {
                      const u = run[6][k];
                      const f = u != null ? faces?.[u] : undefined;
                      const img = h[0] && h[1] !== "o" ? players[h[0]]?.face : f?.[0];
                      const d = run[5][k] ?? 0;
                      const editing = edit?.s === s && edit.run === ri && edit.k === k;
                      return (
                        <li key={k} data-kind={h[1]} data-hand={h[2] || undefined} data-hit={h[0] === sel.p || undefined}>
                          {img ? <img src={faceUrl(img)} alt="" width={20} height={20} className="vt-face" /> : <span className="vt-face vt-face--none">?</span>}
                          <span className="vt-head__name">{h[1] === "o" ? (f?.[3] ? `offen (Gruppe ${f[1]}: ${name(f[3])}?)` : "offen") : h[1] === "j" ? "kein Kopf" : h[1] === "x" ? "fremd" : name(h[0])}</span>
                          <span className="vt-badge">
                            {h[2] ? "von Hand" : KIND[h[1]]}
                            {h[1] === "p" && d >= 8 ? ` · unsicher (${d})` : ""}
                          </span>
                          {h[1] !== "j" && h[1] !== "x" && !editing && (
                            <button type="button" className="linkish" onClick={() => setEdit({ s, run: ri, k })}>
                              ändern
                            </button>
                          )}
                          {editing && (
                            <div className="vt-edit">
                              <PlayerSearch players={pick} label="Richtig ist" placeholder="Spieler suchen …" onChange={(id) => id && save(s, ri, k, h, id)} />
                              <button type="button" className="btn btn--small" data-tone="white" disabled={busy} onClick={() => save(s, ri, k, h, "-")}>
                                Kein Kopf
                              </button>
                              <button type="button" className="btn btn--small" data-tone="white" disabled={busy} onClick={() => save(s, ri, k, h, "?")}>
                                Fremd
                              </button>
                              <fieldset className="vt-scope">
                                <label>
                                  <input type="radio" checked={scope === "run"} onChange={() => setScope("run")} /> nur dieser Abschnitt
                                </label>
                                <label>
                                  <input type="radio" checked={scope === "day"} onChange={() => setScope("day")} />{" "}
                                  {h[0] ? `überall, wo ${name(s)} an diesem Tag „${name(h[0])}“ zeigt` : "dieses Gesicht den ganzen Tag"}
                                </label>
                              </fieldset>
                              <button type="button" className="linkish" onClick={() => setEdit(null)}>
                                abbrechen
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        </>
      )}
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}
