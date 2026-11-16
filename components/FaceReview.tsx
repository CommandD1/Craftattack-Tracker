"use client";

import { useEffect, useMemo, useState } from "react";
import type { FaceExample, FaceLabel, FaceReviewData, FaceGroup } from "@/lib/faceReview";
import "./faceReview.css";

/** Zuordnungsliste für /vorschau/<key>/gesichter (Daten: lib/faceReview.ts) */
const FLAT = 30;
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

const rel = (sec: number) => {
  const m = Math.round(Math.abs(sec) / 60);
  const t = m < 1 ? `${Math.abs(sec)} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  return sec < 0 ? `${t} davor` : `${t} danach`;
};

export function FaceReview({ data, endpoint, thumbBase }: { data: FaceReviewData; endpoint: string; thumbBase: string }) {
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

  // Liste als Köpfe; die Kachel der Sichtung markiert (unbekannt = „?“, kein Kopf = grau)
  const ListRow = ({ list, slot, mark, unknownFace }: { list: (string | null)[]; slot?: number; mark: boolean; unknownFace?: string }) => (
    <span className="fr-list-row">
      {list.map((id, i) => {
        const hit = mark && i === slot;
        const skin = id && id !== "-" ? data.players[id]?.skins[0] : undefined;
        return (
          <span key={i} className="fr-slot" data-hit={hit || undefined} data-kind={id === "-" ? "junk" : id ? "known" : "open"} title={id === "-" ? "kein Kopf" : id ? pname(id) : "unbekannt"}>
            {skin ? <img src={urls.get(skin) ?? faceUrl(skin)} alt={pname(id!)} width={22} height={22} /> : hit && unknownFace ? <img src={urls.get(unknownFace)} alt="unbekannt" width={22} height={22} /> : <span aria-hidden="true">{id === "-" ? "×" : "?"}</span>}
          </span>
        );
      })}
    </span>
  );
  const Who = ({ v, label }: { v: { id: string; sec: number; how: string } | null | undefined; label: string }) => (
    <div className="fr-row">
      <span className="fr-lbl">{label}</span>
      {v ? (
        <span className="fr-who">
          {data.players[v.id]?.skins[0] && <img src={urls.get(data.players[v.id].skins[0])} alt="" width={22} height={22} />}
          {pname(v.id)} <small>({rel(v.sec)}, {v.how})</small>
        </span>
      ) : (
        <span className="fr-muted">niemand bekannt (±30 min, gleiche Listenlänge)</span>
      )}
    </div>
  );
  const Example = ({ x, faceUrl: face }: { x: FaceExample; faceUrl: string }) => (
    <div className="fr-exbox">
      {x.vod != null && (
        <a className="fr-thumb" href={x.url} target="_blank" rel="noopener noreferrer" title="Im VOD ansehen">
          <img
            src={`${thumbBase}/${x.vod}-${x.seg}-${x.slot}.png`}
            alt={`Kopfliste bei ${pname(x.s)}, Kachel markiert`}
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </a>
      )}
      <div className="fr-exinfo">
        <a className="fr-ex" href={x.url} target="_blank" rel="noopener noreferrer">
          ▶ {pname(x.s)} {fmtD.format(new Date(x.at))}
        </a>
        {x.list && x.list.length > 0 && (
          <div className="fr-row">
            <span className="fr-lbl">Liste</span>
            <ListRow list={x.list} slot={x.slot} mark unknownFace={face} />
          </div>
        )}
        {x.list && (
          <>
            <Who v={x.before} label="Davor hier" />
            <Who v={x.after} label="Danach hier" />
          </>
        )}
        {x.others && x.others.length > 0 && (
          <div className="fr-row fr-others">
            <span className="fr-lbl">Gleichzeitig</span>
            <div className="fr-otherlist">
              {x.others.map((o) => (
                <div key={o.s} className="fr-other" title={o.same ? "Gleich lange Liste: gleicher Platz markiert" : "Andere Länge: Platz nicht vergleichbar"}>
                  <span className="fr-other-name">
                    {pname(o.s)} <small>{o.dt === 0 ? "±0 s" : `${o.dt > 0 ? "+" : ""}${o.dt} s`}</small>
                  </span>
                  <ListRow list={o.list} slot={x.slot} mark={o.same} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const done = data.groups.filter(isDone).length;
  const openSightings = data.groups.filter((g) => !isDone(g)).reduce((s, g) => s + g.n, 0);
  // Offene zuerst mit Stimmen, dann nach Gesichts-Kontrast (flache Flächen = wahrscheinlich kein Kopf zuletzt), dann Häufigkeit
  const flat = (g: FaceGroup) => g.contrast != null && g.contrast < FLAT;
  const rank = (g: FaceGroup) => (g.cands.length ? 0 : flat(g) ? 2 : 1);
  const shown = data.groups
    .filter((g) => filter === "all" || (filter === "done") === isDone(g))
    .sort((a, b) => rank(a) - rank(b) || b.n - a.n);

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
          const cand = (p: string, note: string, title: string) => {
            const skin = data.players[p]?.skins[0];
            return (
              <button key={p} type="button" className="fr-cand" aria-pressed={choice === p} onClick={() => choose(g, p)} title={title}>
                {skin && <img src={urls.get(skin)} alt="" width={24} height={24} />}
                {pname(p)} <small>{note}</small>
              </button>
            );
          };
          const from = g.from ? fmtDay.format(new Date(g.from)) : "", to = g.to ? fmtDay.format(new Date(g.to)) : "";
          return (
            <article key={g.id} className="fr-card" data-done={isDone(g)} aria-label={`Gruppe ${g.id}`}>
              <div className="fr-facecol">
                <img className="fr-face" src={urls.get(g.face)} alt={`Gesicht der Gruppe ${g.id}`} width={112} height={112} />
                <span className="fr-id">#{g.id}</span>
              </div>
              <div className="fr-body">
                {flat(g) && <p className="fr-flat">Flach, wahrscheinlich kein Kopf (Kontrast {g.contrast}; echte Skins meist über 40)</p>}
                <p className="fr-meta">
                  <b>{fmtN.format(g.n)}</b> Sichtungen in <b>{fmtN.format(g.units)}</b> Paketen{from && ` · ${from === to ? from : `${from}–${to}`}`}
                </p>
                <div className="fr-row">
                  <span className="fr-lbl">Gesehen bei</span>
                  <span>{g.streamers.map(([s, n]) => `${pname(s)} (${fmtN.format(n)})`).join(", ")}</span>
                </div>
                <div className="fr-examples">
                  {g.ex.map((x) => (
                    <Example key={x.url} x={x} faceUrl={g.face} />
                  ))}
                </div>
                <div className="fr-row">
                  <span className="fr-lbl">Laut Reihenfolge</span>
                  {g.cands.length === 0 && <span className="fr-muted">Keine Liste eines anderen Streamers zur selben Zeit.</span>}
                  {g.cands.map(([p, n]) => (
                    cand(p, `${fmtN.format(n)}×`, `${fmtN.format(n)} Listen anderer Streamer haben an dieser Stelle ${pname(p)}`)
                  ))}
                </div>
                <div className="fr-row">
                  <span className="fr-lbl">Ähnlicher Skin</span>
                  {(g.similar ?? []).map(([p, d]) => (
                    cand(p, `Abw. ${String(d).replace(".", ",")}`, `Abweichung zum bekannten Skin von ${pname(p)}: unter 15 gilt als gleich`)
                  ))}
                </div>
                {choice && !OUT[choice] && g.cands.length > 0 && g.cands[0][0] !== choice && (
                  <p className="fr-warn">Die Reihenfolge spricht eher für {pname(g.cands[0][0])}. Bitte noch einmal prüfen.</p>
                )}
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
