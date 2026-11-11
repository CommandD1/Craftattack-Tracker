import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Schlüssel des versteckten FitnaCraft-Rückblicks (/fitnacraft/<Schlüssel>): aus FITNACRAFT_KEY oder, damit kein
 * Neustart des Website-Dienstes nötig ist, aus ~/.config/actracker/fitnacraft.key (einmal pro Minute gelesen).
 * Nie im Repo. Kürzer als 16 Zeichen oder nicht vorhanden → die Seiten gibt es nicht.
 */
let cached: { key: string; at: number } | null = null;

export function fitnacraftKey(): string {
  const env = process.env.FITNACRAFT_KEY ?? "";
  if (env) return env;
  const now = Date.now();
  if (cached && now - cached.at < 60_000) return cached.key;
  let key = "";
  try {
    key = readFileSync(join(homedir(), ".config/actracker/fitnacraft.key"), "utf8").trim();
  } catch {
    key = "";
  }
  cached = { key, at: now };
  return key;
}

/** true = Schlüssel passt (Vergleich ohne frühen Abbruch) */
export function fitnacraftKeyOk(given: string): boolean {
  const key = fitnacraftKey();
  if (key.length < 16 || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
