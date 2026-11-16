import "server-only";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Voicechat-Auswertung des VOD-Scans (Rückblick-Video) für /vorschau/<key>/voicechat. Erzeugt im Videoprojekt von
 * scripts/chat/export-voice.mjs als voice-summary.json (FACE_REVIEW_DIR, Standard ~/craftattack-stats/review).
 * Stunden = Anzahl 10-s-Takte; eine Gruppe, die mehrere Streamer gleichzeitig zeigen, zählt je Takt einmal.
 */
const DIR = process.env.FACE_REVIEW_DIR ?? join(homedir(), "craftattack-stats", "review");

export type VoiceSummary = {
  made: string;
  scan: { done: number; total: number; reached: string | null; from: string | null };
  totals: { frames: number; framesGroup: number; heads: number; known: number; inferred: number; open: number; groupHours: number; groups: number };
  largest: { ids: string[]; at: string } | null;
  /** [a, b, Stunden] */
  pairs: [string, string, number][];
  groups: { ids: string[]; hours: number; first: string; last: string; open: number }[];
  players: {
    id: string;
    hours: number;
    talk: number | null;
    deaf: number | null;
    partners: [string, number][];
    streamed: number;
    groupShare: number | null;
    muted: number | null;
    deafened: number | null;
  }[];
  days: { day: string; groupHours: number; avgSize: number; players: number }[];
  hours: number[];
  quality: { id: string; frames: number; withGroup: number; heads: number; known: number; inferred: number; open: number }[];
};

export async function loadVoiceSummary(): Promise<VoiceSummary | null> {
  try {
    return JSON.parse(await readFile(join(DIR, "voice-summary.json"), "utf8")) as VoiceSummary;
  } catch {
    return null;
  }
}
