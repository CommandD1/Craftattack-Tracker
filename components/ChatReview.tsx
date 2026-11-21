"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatBundleHead, ChatEvent, ChatKind, ChatLabel, ChatLabels, ChatReviewData } from "@/lib/chatReview";
import { faceUrl } from "@/lib/faceBmp";
import "./chatReview.css";

/** Prüfliste für /vorschau/<key>/chat (Daten: lib/chatReview.ts, erzeugt von scripts/chat/chat-review.mjs) */
const fmtN = new Intl.NumberFormat("de-DE");
const fmtT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
const KIND: Record<ChatKind, string> = { chat: "Chat", join: "Beitritt", leave: "Verlassen", advancement: "Fortschritt", death: "Tod", waypoint: "Wegpunkt" };
const OUT: Record<string, string> = { "?": "Fremder Spieler", x: "Unsinn / keine echte Zeile", skip: "Weiß nicht" };
const PAGE = 25;
type Tab = "open" | "done" | "foreign" | "sample";
type Props = Pick<ChatReviewData, "made" | "stats" | "players"> & { bundles: ChatBundleHead[]; endpoint: string };

export function ChatReview({ made, stats, players, bundles, endpoint }: Props) {
  const [labels, setLabels] = useState<ChatLabels>({ names: {}, events: {} });
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [kind, setKind] = useState<ChatKind | "all">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, { events: ChatEvent[]; hidden: number } | "loading">>({});
  const [sample, setSample] = useState<ChatEvent[] | null>(null);

  const skins = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, p] of Object.entries(players)) if (p.skin) m.set(id, faceUrl(p.skin));
    return m;
  }, [players]);
  const pname = useCallback((id: string) => players[id]?.name ?? id, [players]);
  const post = useCallback(
    async (body: object) => {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      return j;
    },
    [endpoint],
  );

  useEffect(() => {
    post({ op: "get" })
      .then((j: { labels: ChatLabels }) => setLabels(j.labels))
      .catch(() => setNote("Gespeicherte Auswahl konnte nicht geladen werden. Seite neu laden."))
      .finally(() => setLoaded(true));
  }, [post]);

  async function save(scope: "names" | "events", id: string, label: Omit<ChatLabel, "at"> | null) {
    const prev = labels;
    setLabels((l) => {
      const n = { names: { ...l.names }, events: { ...l.events } };
      if (label === null) delete n[scope][id];
      else n[scope][id] = { ...label, at: new Date().toISOString() };
      return n;
    });
    try {
      const j = await post({ op: "set", scope, id, choice: label?.choice ?? null, name: label?.name, text: label?.text });
      setLabels(j.labels);
      setNote("");
    } catch (e) {
      setLabels(prev);
      setNote(`Nicht gespeichert (${e instanceof Error ? e.message : "Fehler"}). Bitte erneut wählen.`);
    }
  }

  async function loadBundle(key: string) {
    if (events[key]) return;
    setEvents((e) => ({ ...e, [key]: "loading" }));
    try {
      const j = (await post({ op: "bundle", key })) as { events: ChatEvent[]; hidden: number };
      setEvents((e) => ({ ...e, [key]: j }));
    } catch (err) {
      setEvents((e) => {
        const n = { ...e };
        delete n[key];
        return n;
      });
      setNote(`Ereignisse nicht geladen (${err instanceof Error ? err.message : "Fehler"}).`);
    }
  }
  useEffect(() => {
    if (tab === "sample" && !sample) post({ op: "sample" }).then((j: { events: ChatEvent[] }) => setSample(j.events)).catch(() => setNote("Stichprobe nicht geladen."));
  }, [tab, sample, post]);

  const ruleOf = (b: ChatBundleHead) => labels.names[b.key]?.choice ?? null;
  const decided = (b: ChatBundleHead) => {
    const c = ruleOf(b);
    return !!c && c !== "skip";
  };
  const needle = q.trim().toLowerCase();
  const shown = bundles.filter((b) => {
    if (tab === "sample") return false;
    if (kind !== "all" && !b.kinds[kind]) return false;
    if (needle && !b.names.some((n) => n.toLowerCase().includes(needle)) && !b.key.includes(needle)) return false;
    if (tab === "done") return decided(b);
    if (decided(b)) return false;
    if (tab === "foreign") return b.foreign > 0 && b.foreign >= b.open / 2;
    return b.open > 0 && b.foreign < b.open / 2;
  });
  const page = shown.slice(0, limit);
  const active = page.find((b) => b.key === activeKey) ?? page[0] ?? null;

  const choose = useCallback(
    (b: ChatBundleHead, choice: string | null, name?: string) => {
      void save("names", b.key, choice === null ? null : { choice, name });
      if (choice !== null && tab === "open") setActiveKey(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, tab],
  );
  const askForeign = (b: ChatBundleHead) => {
    const name = window.prompt("Name des fremden Spielers (so wie im Spiel):", labels.names[b.key]?.name ?? b.names[0] ?? "");
    if (name !== null) choose(b, "?", name.trim() || b.names[0]);
  };

  // Tastatur: 1–6 Vorschlag, f fremd, x Unsinn, s weiß nicht, Leertaste Ereignisse auf/zu, j/k nächstes/voriges Bündel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || tab === "sample" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const i = page.indexOf(active);
      if (/^[1-6]$/.test(e.key)) {
        const c = active.cands[Number(e.key) - 1];
        if (c) choose(active, c[0]);
      } else if (e.key === "f") askForeign(active);
      else if (e.key === "x") choose(active, "x");
      else if (e.key === "s") choose(active, "skip");
      else if (e.key === "j" && page[i + 1]) setActiveKey(page[i + 1].key);
      else if (e.key === "k" && page[i - 1]) setActiveKey(page[i - 1].key);
      else if (e.key === " ") {
        setOpenKey((o) => (o === active.key ? null : active.key));
        void loadBundle(active.key);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (active) document.getElementById(`cr-b-${active.key}`)?.scrollIntoView({ block: "nearest" });
  }, [active?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const Skin = ({ id, size = 24 }: { id: string; size?: number }) =>
    skins.get(id) ? <img className="cr-skin" src={skins.get(id)} alt="" width={size} height={size} /> : <span className="cr-skin cr-noskin" style={{ width: size, height: size }} aria-hidden="true" />;
  const choiceText = (c: string | null | undefined, name?: string) =>
    !c ? null : c === "?" ? `Fremder Spieler${name ? `: ${name}` : ""}` : OUT[c] ?? pname(c);

  const done = bundles.filter(decided);
  const doneEvents = done.reduce((s, b) => s + b.n, 0);
  const openEvents = bundles.filter((b) => !decided(b)).reduce((s, b) => s + b.open, 0);
  const autoShare = stats.events ? Math.round(((stats.byStatus.auto ?? 0) / stats.events) * 100) : 0;

  const PlayerInput = ({ onPick, label }: { onPick: (id: string) => void; label: string }) => (
    <input
      type="text"
      list="cr-players"
      placeholder="Anderer Spieler …"
      aria-label={label}
      onChange={(e) => {
        const v = e.currentTarget.value.trim().toLowerCase();
        const id = Object.keys(players).find((k) => k === v || pname(k).toLowerCase() === v || players[k].mc.some((m) => m.toLowerCase() === v));
        if (id) {
          e.currentTarget.value = "";
          onPick(id);
        }
      }}
    />
  );

  const EventRow = ({ e, bundleKey }: { e: ChatEvent; bundleKey: string | null }) => {
    const own = labels.events[e.id];
    const rule = bundleKey ? labels.names[bundleKey] : undefined;
    const eff = own?.choice ?? rule?.choice ?? (e.status === "auto" || e.status === "rule" ? e.player : null);
    const effName = own?.name ?? rule?.name;
    const set = (choice: string | null, extra?: Partial<ChatLabel>) =>
      void save("events", e.id, choice === null ? (own?.text ? { choice: own.choice, text: own.text } : null) : { choice, name: extra?.name, text: extra?.text ?? own?.text });
    const shownText = own?.text ?? e.text;
    return (
      <li className="cr-ev" data-own={own ? "true" : undefined}>
        <div className="cr-ev-head">
          <span className="cr-kind" data-kind={e.kind}>{KIND[e.kind]}</span>
          <time dateTime={e.at}>{fmtT.format(new Date(e.at))}</time>
          <span className="cr-ev-text">{shownText || <i className="cr-muted">ohne Text</i>}</span>
          {e.conflict && <span className="cr-flag" title="Der Scan hatte die Lesungen verschiedenen Spielern zugeordnet">Widerspruch</span>}
          {eff && (
            <span className="cr-eff">
              → {eff in players && <Skin id={eff} size={18} />} {choiceText(eff, effName)}
              {own ? " (einzeln)" : rule ? " (Namensregel)" : " (automatisch)"}
            </span>
          )}
        </div>
        <table className="cr-reads">
          <thead>
            <tr>
              <th scope="col">Stream</th>
              <th scope="col">Name gelesen</th>
              <th scope="col">Text gelesen</th>
              <th scope="col" title="Sicherheit der Texterkennung">OCR</th>
              <th scope="col"><span className="cr-sr">Aktion</span></th>
            </tr>
          </thead>
          <tbody>
            {e.reads.map((r, i) => (
              <tr key={i}>
                <td>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" title="Im VOD ansehen">
                    ▶ {pname(r.s)}
                  </a>
                </td>
                <td className="cr-mono">
                  {r.tag && <span className="cr-tag">[{r.tag}]</span>} {r.name || "—"}
                  {r.p && <small className="cr-muted"> ({pname(r.p)})</small>}
                </td>
                <td className="cr-mono">{r.text}</td>
                <td className="cr-num">{r.conf}</td>
                <td>
                  {e.kind !== "join" && e.kind !== "leave" && r.text && r.text !== shownText && (
                    <button type="button" className="cr-mini" onClick={() => set(own?.choice ?? eff ?? "skip", { text: r.text, name: effName })} title="Diesen Text für das Ereignis übernehmen">
                      Text nehmen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {e.more ? <p className="cr-muted cr-small">+ {fmtN.format(e.more)} weitere Lesungen</p> : null}
        {e.ctx && e.ctx.length > 0 && (
          <details className="cr-ctx">
            <summary>Gleichzeitig im Chat (±60 s)</summary>
            <ul>
              {e.ctx.map((c, i) => (
                <li key={i}>
                  <span className="cr-num">{c.dt > 0 ? `+${c.dt}` : c.dt} s</span> <span className="cr-kind" data-kind={c.kind}>{KIND[c.kind]}</span>{" "}
                  <b>{c.who in players ? pname(c.who) : c.who}</b> {c.text} {c.n > 1 && <small className="cr-muted">({c.n} Streams)</small>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="cr-row">
          <span className="cr-lbl">Nur dieses</span>
          {e.cands.slice(0, 4).map(([p, s, why]) => (
            <button key={p} type="button" className="cr-cand cr-cand-s" aria-pressed={own?.choice === p} onClick={() => set(p)} title={why.join(" · ")}>
              <Skin id={p} size={18} /> {pname(p)} <small>{Math.round(s * 100)}</small>
            </button>
          ))}
          <PlayerInput label={`Anderen Spieler für das Ereignis um ${fmtT.format(new Date(e.at))} wählen`} onPick={(id) => set(id)} />
          <button type="button" className="cr-act" aria-pressed={own?.choice === "x"} onClick={() => set("x")}>
            Unsinn
          </button>
          {own && (
            <button type="button" className="cr-act cr-reset" onClick={() => void save("events", e.id, null)}>
              Zurücksetzen
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="cr">
      <div className="cr-stats">
        <p>
          <b>{fmtN.format(stats.events)}</b> Ereignisse aus {fmtN.format(stats.lines)} Lesungen · <b>{autoShare} %</b> automatisch sicher ·{" "}
          <b>{fmtN.format(openEvents)}</b> offen · von dir entschieden: <b>{fmtN.format(done.length)}</b> Namen ({fmtN.format(doneEvents)} Ereignisse)
          {!loaded && " · lade Auswahl …"}
        </p>
        <p className="cr-muted cr-small">
          Stand der Liste {fmtT.format(new Date(made))}, gescannt bis {fmtT.format(new Date(stats.until))}. Deine Wahl wirkt sofort hier; die Zahlen oben und
          neue Vorschläge kommen mit dem nächsten Lauf des Skripts.
        </p>
      </div>
      <div className="cr-bar">
        <div className="cr-tabs" role="group" aria-label="Ansicht">
          {(
            [
              ["open", "Offen"],
              ["foreign", "Fremde?"],
              ["done", "Entschieden"],
              ["sample", "Stichprobe automatisch"],
            ] as [Tab, string][]
          ).map(([t, l]) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setLimit(PAGE); setActiveKey(null); }}>
              {l}
            </button>
          ))}
        </div>
        {tab !== "sample" && (
          <>
            <label className="cr-filter">
              <span className="cr-lbl">Art</span>
              <select value={kind} onChange={(e) => { setKind(e.currentTarget.value as ChatKind | "all"); setLimit(PAGE); }}>
                <option value="all">Alle</option>
                {(Object.keys(KIND) as ChatKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND[k]} ({fmtN.format(stats.byKind[k]?.open ?? 0)} offen)
                  </option>
                ))}
              </select>
            </label>
            <label className="cr-filter">
              <span className="cr-lbl">Name</span>
              <input type="search" value={q} onChange={(e) => { setQ(e.currentTarget.value); setLimit(PAGE); }} placeholder="gelesenen Namen suchen" />
            </label>
          </>
        )}
      </div>
      <p className="cr-keys cr-small cr-muted">
        Tasten fürs markierte Bündel: <kbd>1</kbd>–<kbd>6</kbd> Vorschlag · <kbd>f</kbd> fremder Spieler · <kbd>x</kbd> Unsinn · <kbd>s</kbd> weiß nicht ·{" "}
        <kbd>Leertaste</kbd> Ereignisse zeigen · <kbd>j</kbd>/<kbd>k</kbd> nächstes/voriges
      </p>
      {note && <p className="cr-note" role="status">{note}</p>}
      <datalist id="cr-players">
        {Object.keys(players).map((id) => (
          <option key={id} value={pname(id)} />
        ))}
      </datalist>

      {tab === "sample" ? (
        <div className="cr-sample">
          <p className="cr-small">
            Zufällig verteilte Ereignisse, die das Skript selbst zugeordnet hat. Falsche bitte einzeln korrigieren – häufen sich Fehler bei einem Namen, wird
            die Regel im Skript strenger.
          </p>
          {!sample ? <p className="cr-muted">lade …</p> : <ul className="cr-evs">{sample.map((e) => <EventRow key={e.id} e={e} bundleKey={null} />)}</ul>}
        </div>
      ) : (
        <div className="cr-list">
          <p className="cr-small cr-muted">{fmtN.format(shown.length)} Namen in dieser Ansicht</p>
          {page.length === 0 && <p className="cr-empty">{tab === "open" ? "Nichts mehr offen." : "Nichts in dieser Ansicht."}</p>}
          {page.map((b) => {
            const rule = labels.names[b.key];
            const isOpen = openKey === b.key;
            const ev = events[b.key];
            return (
              <article key={b.key} id={`cr-b-${b.key}`} className="cr-card" data-active={active?.key === b.key || undefined} data-done={decided(b) || undefined} onClick={() => setActiveKey(b.key)}>
                <div className="cr-card-head">
                  <h2 className="cr-names">
                    {b.names.map((n, i) => (
                      <span key={i} className="cr-mono">
                        {n}
                      </span>
                    ))}
                  </h2>
                  <p className="cr-meta">
                    <b>{fmtN.format(b.n)}</b> {b.n === 1 ? "Ereignis" : "Ereignisse"}
                    {b.open !== b.n && ` (${fmtN.format(b.open)} offen)`} ·{" "}
                    {Object.entries(b.kinds)
                      .map(([k, n]) => `${KIND[k as ChatKind]} ${n}`)
                      .join(", ")}
                    {b.first && ` · ab ${fmtT.format(new Date(b.first)).slice(0, 6)}`}
                    {b.conflict > 0 && <span className="cr-flag"> {b.conflict} Widerspruch</span>}
                  </p>
                </div>
                <div className="cr-row">
                  <span className="cr-lbl">Vorschläge</span>
                  {b.cands.length === 0 && <span className="cr-muted">Kein Teilnehmer mit ähnlichem Namen.</span>}
                  {b.cands.map(([p, s], i) => (
                    <button key={p} type="button" className="cr-cand" aria-pressed={rule?.choice === p} onClick={() => choose(b, p)} title={`Punkte im Schnitt über die Ereignisse: ${Math.round(s * 100)}`}>
                      <kbd>{i + 1}</kbd> <Skin id={p} /> {pname(p)} <small>{Math.round(s * 100)}</small>
                    </button>
                  ))}
                </div>
                <div className="cr-row">
                  <span className="cr-lbl">Oder</span>
                  <PlayerInput label={`Anderen Spieler für ${b.names[0] ?? b.key} wählen`} onPick={(id) => choose(b, id)} />
                  <button type="button" className="cr-act" aria-pressed={rule?.choice === "?"} onClick={() => askForeign(b)}>
                    Fremder Spieler …
                  </button>
                  <button type="button" className="cr-act" aria-pressed={rule?.choice === "x"} onClick={() => choose(b, "x")}>
                    Unsinn
                  </button>
                  <button type="button" className="cr-act" aria-pressed={rule?.choice === "skip"} onClick={() => choose(b, "skip")}>
                    Weiß nicht
                  </button>
                  {rule && (
                    <button type="button" className="cr-act cr-reset" onClick={() => choose(b, null)}>
                      Zurücksetzen
                    </button>
                  )}
                </div>
                {rule && (
                  <p className="cr-result" data-kind={rule.choice in players ? "player" : rule.choice}>
                    Regel: „{b.names[0] ?? b.key}“ = {choiceText(rule.choice, rule.name)}
                  </p>
                )}
                <button
                  type="button"
                  className="cr-toggle"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenKey(isOpen ? null : b.key);
                    void loadBundle(b.key);
                  }}
                >
                  {isOpen ? "Ereignisse ausblenden" : `Ereignisse ansehen (${fmtN.format(b.n)}) – Lesungen aus allen Streams vergleichen`}
                </button>
                {isOpen && (
                  <div className="cr-events">
                    {ev === "loading" || !ev ? (
                      <p className="cr-muted">lade …</p>
                    ) : (
                      <>
                        <ul className="cr-evs">
                          {ev.events
                            .filter((e) => kind === "all" || e.kind === kind)
                            .map((e) => (
                              <EventRow key={e.id} e={e} bundleKey={b.key} />
                            ))}
                        </ul>
                        {ev.hidden > 0 && <p className="cr-muted cr-small">+ {fmtN.format(ev.hidden)} weitere Ereignisse mit diesem Namen (gelten über die Namensregel mit)</p>}
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {shown.length > limit && (
            <button type="button" className="cr-more" onClick={() => setLimit((l) => l + PAGE)}>
              Weitere {fmtN.format(Math.min(PAGE, shown.length - limit))} Namen zeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
