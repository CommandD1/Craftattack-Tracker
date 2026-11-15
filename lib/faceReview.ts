import "server-only";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Interne Vorschau-Seite „Gesichter zuordnen“ (/vorschau/<key>/gesichter) für den VOD-Scan des Rückblick-Videos:
 * unbekannte Köpfe aus der Voicechat-Liste, nach Ähnlichkeit gruppiert. Daten und Zuordnungen liegen als Dateien im
 * Videoprojekt (FACE_REVIEW_DIR, Standard ~/craftattack-stats/review): face-review.json (vom Scan erzeugt, nur
 * gelesen) und face-labels.json (hier geschrieben). Keine Verbindung zur Tracker-Datenbank.
 */
const DIR = process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review");
const DATA = join(DIR, "face-review.json");
const LABELS = join(DIR, "face-labels.json");

export type FaceGroup = {
  id: number;
  face: string; // 8×8 RGB, base64
  n: number;
  faces: number;
  units: number;
  status: string;
  player: string | null;
  from: string | null;
  to: string | null;
  streamers: [string, number][];
  /** Reihenfolge-Abgleich: [Spieler, Anzahl übereinstimmender Listen anderer Streamer] */
  cands: [string, number][];
  /** Ähnlichste Skins ohne die Symbol-Ecke: [Spieler, Abweichung] (bekannte Köpfe ~1–8, fremde ~25+) */
  similar?: [string, number][];
  ex: { s: string; url: string; at: string }[];
};
export type FaceReviewData = { made: string; groups: FaceGroup[]; players: Record<string, { name: string; skins: string[] }> };
export type FaceLabel = { choice: string; at: string };

export const FACE_SPECIAL = ["-", "?", "skip"] as const;

export async function loadFaceReview(): Promise<FaceReviewData | null> {
  try {
    return JSON.parse(await readFile(DATA, "utf8")) as FaceReviewData;
  } catch {
    return null;
  }
}

export async function loadFaceLabels(): Promise<Record<string, FaceLabel>> {
  try {
    return JSON.parse(await readFile(LABELS, "utf8")) as Record<string, FaceLabel>;
  } catch {
    return {};
  }
}

// Schreibvorgänge nacheinander (ein Prozess), Datei atomar ersetzen
let chain: Promise<unknown> = Promise.resolve();
export function saveFaceLabel(id: number, choice: string | null): Promise<Record<string, FaceLabel>> {
  const run = chain.then(async () => {
    const labels = await loadFaceLabels();
    if (choice === null) delete labels[`c${id}`];
    else labels[`c${id}`] = { choice, at: new Date().toISOString() };
    const tmp = `${LABELS}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(labels, null, 1));
    await rename(tmp, LABELS);
    return labels;
  });
  chain = run.catch(() => {});
  return run;
}
