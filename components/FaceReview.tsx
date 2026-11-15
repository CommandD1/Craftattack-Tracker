"use client";

import { useEffect, useMemo, useState } from "react";
import type { FaceLabel, FaceReviewData, FaceGroup } from "@/lib/faceReview";
import "./faceReview.css";

/** Zuordnungsliste für /vorschau/<key>/gesichter (Daten: lib/faceReview.ts) */
const OUT: Record<string, string> = { "-": "Kein Kopf", "?": "Fremde Person", skip: "Weiß nicht" };
const fmtN = new Intl.NumberFormat("de-DE");
const fmtD = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const fmtDay = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
type Filter = "open" | "done" | "all";

/** 8×8 RGB (base64) als SVG-Daten-URL, scharf skaliert */
function faceUrl(b64: string): string {
  const bin = atob(b64);
  let rects = "";
  for (let i = 0; i < 64; i++) {
    const r = bin.charCodeAt(i * 3), g = bin.charCodeAt(i * 3 + 1), b = bin.charCodeAt(i * 3 + 2);
    rects += `<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1.02" height="1.02" fill="rgb(${r},${g},${b})"/>`;
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${rects}</svg>`)}`;
}

export function FaceReview({ data, endpoint }: { data: FaceReviewData; endpoint: string }) {
  const [labels, setLabels] = useState<Record<string, FaceLabel>>({});
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.groups) m.set(g.face, faceUrl(g.face));
    for (const p of Object.values(data.players)) if (p.skins[0]) m.set(p.skins[0], faceUrl(p.skins[0]));
    return m;
  }, [data]);
  const pname = (id: string) => data.players[id]?.name ?? id;

  useEffect(() => {
    fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "get" }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { labels: Record<string, FaceLabel> }) => setLabels(j.labels))
      .catch(() => setNote("Gespeicherte Auswahl konnte nicht geladen werden. Seite neu laden."))
      .finally(() => setLoaded(true));
  }, [endpoint]);

  const choiceOf = (g: FaceGroup) => labels[`c${g.id}`]?.choice ?? (g.status !== "open" ? g.player : null);
  const isDone = (g: FaceGroup) => {
    const c = choiceOf(g);
    return !!c && c !== "skip";
  };

  async function choose(g: FaceGroup, choice: string | null) {
    const key = `c${g.id}`;
    const prev = labels;
    setLabels((l) => {
      const n = { ...l };
      if (choice === null) delete n[key];
      else n[key] = { choice, at: new Date().toISOString() };
      return n;
    });
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "set", id: g.id, choice }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      setLabels(j.labels);
      setNote("");
    } catch (e) {
      setLabels(prev);
      setNote(`Nicht gespeichert (${e instanceof Error ? e.message : "Fehler"}). Bitte erneut wählen.`);
    }
  }

  const done = data.groups.filter(isDone).length;
  const openSightings = data.groups.filter((g) => !isDone(g)).reduce((s, g) => s + g.n, 0);
  const shown = data.groups.filter((g) => filter === "all" || (filter === "done") === isDone(g));

  return (
    <div className="fr">
      <div className="fr-bar">
        <p className="fr-stat">
          <b>{fmtN.format(done)}</b> von {fmtN.format(data.groups.length)} Gruppen erledigt · <b>{fmtN.format(openSightings)}</b> Sichtungen offen
          {!loaded && " · lade Auswahl …"}
        </p>
        <div className="fr-tabs" role="group" aria-label="Filter">
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "open" ? "Offen" : f === "done" ? "Erledigt" : "Alle"}
            </button>
          ))}
        </div>
      </div>
      {note && <p className="fr-note" role="status">{note}</p>}
      <datalist id="fr-players">
        {Object.keys(data.players).map((id) => (
          <option key={id} value={pname(id)} />
        ))}
      </datalist>
      <div className="fr-list">
        {shown.length === 0 && <p className="fr-empty">{filter === "open" ? "Alles zugeordnet." : "Noch nichts erledigt."}</p>}
        {shown.map((g) => {
          const choice = choiceOf(g);
          const from = g.from ? fmtDay.format(new Date(g.from)) : "", to = g.to ? fmtDay.format(new Date(g.to)) : "";
          return (
            <article key={g.id} className="fr-card" data-done={isDone(g)} aria-label={`Gruppe ${g.id}`}>
              <div className="fr-facecol">
                <img className="fr-face" src={urls.get(g.face)} alt={`Gesicht der Gruppe ${g.id}`} width={112} height={112} />
                <span className="fr-id">#{g.id}</span>
              </div>
              <div className="fr-body">
                <p className="fr-meta">
                  <b>{fmtN.format(g.n)}</b> Sichtungen in <b>{fmtN.format(g.units)}</b> Paketen{from && ` · ${from === to ? from : `${from}–${to}`}`}
                </p>
                <div className="fr-row">
                  <span className="fr-lbl">Gesehen bei</span>
                  <span>{g.streamers.map(([s, n]) => `${pname(s)} (${fmtN.format(n)})`).join(", ")}</span>
                </div>
                <div className="fr-row">
                  <span className="fr-lbl">Im VOD</span>
                  {g.ex.map((x) => (
                    <a key={x.url} className="fr-ex" href={x.url} target="_blank" rel="noopener noreferrer">
                      ▶ {pname(x.s)} {fmtD.format(new Date(x.at))}
                    </a>
                  ))}
                </div>
                <div className="fr-row">
                  <span className="fr-lbl">Kandidaten</span>
                  {g.cands.length === 0 && <span className="fr-muted">Niemand war bei der Hälfte der Sichtungen online.</span>}
                  {g.cands.map(([p, pct]) => {
                    const skin = data.players[p]?.skins[0];
                    return (
                      <button key={p} type="button" className="fr-cand" aria-pressed={choice === p} onClick={() => choose(g, p)} title={`Als ${pname(p)} zuordnen`}>
                        {skin && <img src={urls.get(skin)} alt="" width={24} height={24} />}
                        {pname(p)} <small>{pct} %</small>
                      </button>
                    );
                  })}
                </div>
                <div className="fr-row">
                  <span className="fr-lbl">Oder</span>
                  <input
                    type="text"
                    id={`fr-o-${g.id}`}
                    list="fr-players"
                    placeholder="Anderer Spieler …"
                    aria-label={`Anderen Spieler für Gruppe ${g.id} wählen`}
                    onChange={(e) => {
                      const v = e.currentTarget.value.trim().toLowerCase();
                      const id = Object.keys(data.players).find((k) => k === v || pname(k).toLowerCase() === v);
                      if (id) {
                        e.currentTarget.value = "";
                        choose(g, id);
                      }
                    }}
                  />
                  {Object.entries(OUT).map(([k, label]) => (
                    <button key={k} type="button" className="fr-act" aria-pressed={choice === k} onClick={() => choose(g, k)}>
                      {label}
                    </button>
                  ))}
                  {choice && (
                    <button type="button" className="fr-act fr-reset" onClick={() => choose(g, null)}>
                      Zurücksetzen
                    </button>
                  )}
                </div>
                {choice && (
                  <p className="fr-result" data-kind={OUT[choice] ? (choice === "skip" ? "skip" : "out") : "player"}>
                    {OUT[choice] ?? `Zugeordnet: ${pname(choice)}`}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
