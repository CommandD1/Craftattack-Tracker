import "server-only";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Voicechat-Zeitstrahl (/vorschau/<key>/voicechat/zeitstrahl): wer wann mit wem im Voicechat war, je Tag, mit
 * Korrekturen von Fehlerkennungen. Daten erzeugt das Videoprojekt (scripts/chat/export-voice-days.mjs →
 * FACE_REVIEW_DIR/voice-days/), Korrekturen schreibt diese Seite nach voice-fixes.json; scripts/chat/apply-voice-fixes.mjs
 * übernimmt sie stündlich in den Scan. Keine Verbindung zur Tracker-Datenbank.
 */
const DIR = process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review");
const DAYS = join(DIR, "voice-days");
const FIXES = join(DIR, "voice-fixes.json");

export type VoiceDayInfo = { day: string; frames: number; withGroup: number; streamers?: number; heads?: number; open?: number };
export type VoiceIndex = { made: string; days: VoiceDayInfo[]; players: Record<string, { name: string; face: string | null }> };
/** Kopf in einer Liste: [Spieler-ID | null, Art p/i/o/j/x, 0 | 1 = von Hand | 2 = per Mehrheit der anderen Streamer korrigiert] */
export type VoiceHead = [string | null, "p" | "i" | "o" | "j" | "x", 0 | 1 | 2];
/** Abschnitt: [von s, bis s, Liste (-1 = keine), VOD, erstes Segment, größte Abweichung je Platz, Gesichts-ID je Platz] */
export type VoiceRun = [number, number, number, string, number, number[], (number | null)[]];
export type VoiceDay = { day: string; start: number; made: string; lists: VoiceHead[][]; streamers: Record<string, VoiceRun[]>; fixes: string[] };
/** Gesicht eines unbekannten Kopfs: [8×8 RGB base64, Gesichtsgruppe, Status, Spieler] */
export type VoiceFaces = Record<string, [string, number | null, string | null, string | null]>;

export type VoiceFix = {
  id: string;
  day: string;
  streamer: string;
  /** Zeitraum in ms */
  from: number;
  until: number;
  /** run = nur dieser Platz in diesem Abschnitt, day = alle Sichtungen dieses Kopfs beim Streamer an dem Tag */
  scope: "run" | "day";
  slot: number;
  was: { i: string | null; u: number | null };
  /** Spieler-ID, "-" = kein Kopf, "?" = fremd */
  to: string;
  at: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (d: unknown): d is string => typeof d === "string" && DAY_RE.test(d);

export async function loadVoiceIndex(): Promise<VoiceIndex | null> {
  try {
    return JSON.parse(await readFile(join(DAYS, "index.json"), "utf8")) as VoiceIndex;
  } catch {
    return null;
  }
}

/** Rohdatei eines Tages (<tag>.json oder <tag>-faces.json) als Text, ohne sie zu parsen */
export async function readVoiceDayFile(day: string, faces: boolean): Promise<string | null> {
  if (!isDay(day)) return null;
  try {
    return await readFile(join(DAYS, `${day}${faces ? "-faces" : ""}.json`), "utf8");
  } catch {
    return null;
  }
}

export async function loadVoiceFixes(): Promise<VoiceFix[]> {
  try {
    return JSON.parse(await readFile(FIXES, "utf8")) as VoiceFix[];
  } catch {
    return [];
  }
}

// Schreibvorgänge nacheinander (ein Prozess), Datei atomar ersetzen
let chain: Promise<unknown> = Promise.resolve();
function update(fn: (all: VoiceFix[]) => VoiceFix[]): Promise<VoiceFix[]> {
  const run = chain.then(async () => {
    const next = fn(await loadVoiceFixes());
    const tmp = `${FIXES}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 1));
    await rename(tmp, FIXES);
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

export const addVoiceFix = (fix: Omit<VoiceFix, "id" | "at">) => update((all) => [...all, { ...fix, id: randomUUID().slice(0, 8), at: new Date().toISOString() }]);
export const removeVoiceFix = (id: string) => update((all) => all.filter((f) => f.id !== id));
