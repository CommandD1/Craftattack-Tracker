import "server-only";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Interne Vorschau-Seite „Ingame-Chat aufräumen“ (/vorschau/<key>/chat) für den VOD-Scan des Rückblick-Videos: Lesungen
 * derselben Chatzeile aus mehreren Streams sind zu Ereignissen zusammengefasst (scripts/chat/chat-review.mjs im
 * Videoprojekt), offene Ereignisse nach OCR-Namen gebündelt. Dateien in FACE_REVIEW_DIR (Standard
 * ~/craftattack-stats/review): chat-review.json (nur gelesen), chat-labels.json (hier geschrieben). Keine Verbindung zur
 * Tracker-Datenbank.
 */
const DIR = process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review");
const DATA = join(DIR, "chat-review.json");
const LABELS = join(DIR, "chat-labels.json");

export type ChatKind = "chat" | "join" | "leave" | "advancement" | "death" | "waypoint";
/** Eine OCR-Lesung in einem Stream */
export type ChatRead = { s: string; name: string; text: string; tag?: string; conf: number; p?: string; url: string };
/** Vorschlag: [Spieler-ID, Punkte, Begründungen] */
export type ChatCand = [string, number, string[]];
export type ChatEvent = {
  id: string;
  at: string;
  kind: ChatKind;
  text: string;
  /** auto = sicher erkannt, rule = über Namensregel, labeled = von Hand, foreign = wohl kein Teilnehmer, open */
  status: "auto" | "rule" | "labeled" | "foreign" | "open";
  player: string | null;
  conflict?: boolean;
  cands: ChatCand[];
  reads: ChatRead[];
  more?: number;
  /** andere Ereignisse ±60 s */
  ctx?: { dt: number; kind: ChatKind; who: string; text: string; n: number }[];
};
export type ChatBundle = {
  /** gefalteter OCR-Name (OCR-Verwechslungen zusammengelegt) */
  key: string;
  names: string[];
  n: number;
  open: number;
  rule: string | null;
  cands: [string, number][];
  events: ChatEvent[];
  hidden?: number;
};
export type ChatReviewData = {
  made: string;
  stats: {
    lines: number;
    events: number;
    byStatus: Record<string, number>;
    conflicts: number;
    byKind: Record<string, { all: number; open: number }>;
    until: string;
  };
  players: Record<string, { name: string; mc: string[]; skin: string | null }>;
  bundles: ChatBundle[];
  sample: ChatEvent[];
};
/** Bündel ohne Ereignisse (für die Übersicht; Ereignisse lädt die Seite beim Aufklappen nach) */
export type ChatBundleHead = Omit<ChatBundle, "events" | "hidden"> & { kinds: Partial<Record<ChatKind, number>>; foreign: number; conflict: number; first: string };
/** choice: Spieler-ID, "?" = fremder Spieler (name = sein Name), "x" = Unsinn/keine echte Zeile, "skip" = weiß nicht */
export type ChatLabel = { choice: string; name?: string; text?: string; at: string };
export type ChatLabels = { names: Record<string, ChatLabel>; events: Record<string, ChatLabel> };

export const CHAT_SPECIAL = ["?", "x", "skip"] as const;

// Datei ist ein paar MB groß und der Web-Prozess hat wenig Speicher: beim Durchklicken (viele Nachlade-Anfragen) kurz
// im Speicher halten, danach wieder freigeben
let cache: { at: number; data: ChatReviewData } | null = null;
let dropTimer: ReturnType<typeof setTimeout> | null = null;
export async function loadChatReview(): Promise<ChatReviewData | null> {
  try {
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), data: JSON.parse(await readFile(DATA, "utf8")) as ChatReviewData };
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (cache = null), 120_000);
    dropTimer.unref?.();
    return cache.data;
  } catch {
    return null;
  }
}

export function bundleHead(b: ChatBundle): ChatBundleHead {
  const kinds: Partial<Record<ChatKind, number>> = {};
  for (const e of b.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const { events, hidden, ...rest } = b;
  void hidden;
  return {
    ...rest,
    kinds,
    foreign: events.filter((e) => e.status === "foreign").length,
    conflict: events.filter((e) => e.conflict).length,
    first: events[0]?.at ?? "",
  };
}

export async function loadChatLabels(): Promise<ChatLabels> {
  try {
    const l = JSON.parse(await readFile(LABELS, "utf8")) as Partial<ChatLabels>;
    return { names: l.names ?? {}, events: l.events ?? {} };
  } catch {
    return { names: {}, events: {} };
  }
}

// Schreibvorgänge nacheinander (ein Prozess), Datei atomar ersetzen
let chain: Promise<unknown> = Promise.resolve();
export function saveChatLabel(scope: "names" | "events", id: string, label: Omit<ChatLabel, "at"> | null): Promise<ChatLabels> {
  const run = chain.then(async () => {
    const labels = await loadChatLabels();
    if (label === null) delete labels[scope][id];
    else labels[scope][id] = { ...label, at: new Date().toISOString() };
    const tmp = `${LABELS}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(labels, null, 1));
    await rename(tmp, LABELS);
    return labels;
  });
  chain = run.catch(() => {});
  return run;
}
