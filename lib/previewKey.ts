import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Versteckte Vorschau-Seiten (/vorschau/<Schlüssel>/…) zum Ausprobieren neuer Funktionen, bevor sie öffentlich
 * werden. Schlüssel aus VORSCHAU_KEY oder ~/.config/actracker/vorschau.key (einmal pro Minute gelesen, kein
 * Dienst-Neustart nötig). Nie im Repo. Kürzer als 16 Zeichen oder nicht vorhanden → die Seiten gibt es nicht.
 */
let cached: { key: string; at: number } | null = null;

function previewKey(): string {
  const env = process.env.VORSCHAU_KEY ?? "";
  if (env) return env;
  const now = Date.now();
  if (cached && now - cached.at < 60_000) return cached.key;
  let key = "";
  try {
    key = readFileSync(join(homedir(), ".config/actracker/vorschau.key"), "utf8").trim();
  } catch {
    key = "";
  }
  cached = { key, at: now };
  return key;
}

/** true = Schlüssel passt (Vergleich ohne frühen Abbruch) */
export function previewKeyOk(given: string): boolean {
  const key = previewKey();
  if (key.length < 16 || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** true = Pfad gehört zur Vorschau, aber der Schlüssel fehlt oder passt nicht */
export function previewDenied(path: string): boolean {
  if (path !== "/vorschau" && !path.startsWith("/vorschau/")) return false;
  try {
    return !previewKeyOk(decodeURIComponent(path.split("/")[2] ?? ""));
  } catch {
    return true;
  }
}
