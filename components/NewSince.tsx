"use client";

import { useEffect, useState } from "react";
import { markAllSeen, useLastVisit, visitLabel } from "@/lib/visit";

/* ---------- Zahl neuer Ereignisse (Navigation) ---------- */

interface NewData {
  from: number;
  /** [Minute ab `from`, Anzahl] */
  at: [number, number][];
}

const REFRESH_MS = 5 * 60_000;
let cache: { at: number; p: Promise<NewData | null> } | null = null;

function loadNew(): Promise<NewData | null> {
  if (!cache || Date.now() - cache.at > REFRESH_MS) {
    cache = {
      at: Date.now(),
      p: fetch("/api/neu")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    };
  }
  return cache.p;
}

export function useNewCount(): { n: number; more: boolean } | null {
  const since = useLastVisit();
  const [data, setData] = useState<NewData | null>(null);
  useEffect(() => {
    if (since === null) return;
    let live = true;
    const get = () => loadNew().then((d) => live && setData(d));
    get();
    const t = setInterval(get, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [since]);
  if (since === null || !data) return null;
  let n = 0;
  // Minute zählt, wenn sie nach dem Besuch beginnt (auf eine Minute genau)
  for (const [m, c] of data.at) if (data.from + m * 60_000 >= since) n += c;
  return { n, more: since < data.from };
}

/** Kleine Zahl an „Verlauf“ / „Ereignisse“: neue Feed-Ereignisse seit dem letzten Besuch */
export function NewBadge() {
  const c = useNewCount();
  if (!c || c.n === 0) return null;
  const label = c.n > 99 ? "99+" : `${c.n}${c.more ? "+" : ""}`;
  return (
    <span className="new-badge num" title={`${c.n}${c.more ? "+" : ""} neue Ereignisse seit deinem letzten Besuch`}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">, {label} neu seit deinem letzten Besuch</span>
    </span>
  );
}

/* ---------- Im Feed ---------- */

/**
 * Zeile über dem Feed: wie viel seit dem letzten Besuch dazugekommen ist, oder dass es nichts Neues gibt.
 * `at`: Zeitpunkte (ms) aller Kacheln im Feed, neueste zuerst.
 */
export function FeedSinceNote({ at }: { at: number[] }) {
  const since = useLastVisit();
  const total = useNewCount();
  if (since === null || at.length === 0) return null;
  const when = visitLabel(since);
  const n = at.filter((t) => t > since).length;
  if (n === 0) {
    return (
      <p className="feed-since" data-state="none">
        <span className="feed-since__dot" aria-hidden="true">✓</span>
        <span>
          Nichts Neues seit deinem letzten Besuch <span className="muted">({when})</span>. Du bist auf dem neuesten Stand.
        </span>
      </p>
    );
  }
  const all = n === at.length;
  // Alles im Feed ist neu: die Liste ist abgeschnitten, also die echte Zahl (wie an „Verlauf“) nennen
  const count = all && total && total.n > n ? total.n : n;
  // Besuch liegt vor dem 7-Tage-Fenster von /api/neu: Zahl ist eine Untergrenze
  const more = all && total?.more ? "+" : "";
  return (
    <p className="feed-since" data-state="new">
      <span className="feed-since__dot" aria-hidden="true">
        {count > 99 ? "99+" : `${count}${more}`}
      </span>
      <span>
        {all ? "Alles hier ist neu: " : ""}
        {count === 1 ? "1 neues Ereignis" : `${count}${more} neue Ereignisse`} seit deinem letzten Besuch <span className="muted">({when})</span>
        {all ? "." : ", bis zur roten Linie."}
      </span>
      <button type="button" className="btn btn--small feed-since__btn" data-tone="white" onClick={markAllSeen}>
        Alles gesehen ✓
      </button>
    </p>
  );
}

/** Linie zwischen der letzten neuen und der ersten schon gesehenen Minute (sonst nichts) */
export function FeedNewDivider({ at, newerAt }: { at: number; newerAt: number }) {
  const since = useLastVisit();
  if (since === null || !(newerAt > since && at <= since)) return null;
  return (
    <li className="feed__new" role="separator" aria-label={`Ab hier schon gesehen (letzter Besuch ${visitLabel(since)})`}>
      <span>▲ Neu seit deinem letzten Besuch · {visitLabel(since)}</span>
    </li>
  );
}
