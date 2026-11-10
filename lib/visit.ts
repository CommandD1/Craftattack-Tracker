"use client";

import { useSyncExternalStore } from "react";

/**
 * Letzter Besuch, nur im Browser (localStorage, nichts wird übertragen). Ein neuer Besuch beginnt nach 30 Minuten
 * ohne Seite; dann gilt der Zeitpunkt, an dem der vorige endete, als „seit deinem letzten Besuch“. Innerhalb eines
 * Besuchs bleibt der Wert stehen, damit Markierungen beim Weiterklicken nicht verschwinden.
 */
const KEY = "ca:besuch";
const GAP_MS = 30 * 60_000;

interface Visit {
  /** Ende des vorigen Besuchs (ms), null beim ersten Besuch */
  prev: number | null;
  /** Zuletzt aktiv (ms) */
  last: number;
}

let since: number | null | undefined;
const listeners = new Set<() => void>();

function read(): Visit | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.last === "number" ? { prev: typeof v.prev === "number" ? v.prev : null, last: v.last } : null;
  } catch {
    return null;
  }
}

function write(v: Visit) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}

function touch() {
  const v = read();
  write({ prev: v?.prev ?? since ?? null, last: Date.now() });
}

function compute(): number | null {
  const now = Date.now();
  const v = read();
  const prev = v ? (now - v.last > GAP_MS ? v.last : v.prev) : null;
  write({ prev, last: now });
  // Aktiv bleiben, solange die Seite offen ist und benutzt wird
  addEventListener("pagehide", touch);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && touch());
  setInterval(() => document.visibilityState === "visible" && touch(), 5 * 60_000);
  return prev;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => (since === undefined ? (since = compute()) : since);

/** Zeitpunkt des letzten Besuchs (ms) oder null (erster Besuch, Server, kein Speicher) */
export function useLastVisit(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** „Alles gesehen“: ab jetzt gilt nichts mehr als neu */
export function markAllSeen() {
  since = Date.now();
  write({ prev: since, last: since });
  for (const l of listeners) l();
}

const fmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const fmtOld = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/** „Mo., 14:02“ (innerhalb einer Woche) bzw. „3. Nov., 14:02“ */
export function visitLabel(ms: number): string {
  return (Date.now() - ms < 6 * 86_400_000 ? fmt : fmtOld).format(ms);
}
