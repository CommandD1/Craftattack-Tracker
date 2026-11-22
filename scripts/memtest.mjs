#!/usr/bin/env node
/**
 * Speichertest vor dem Mergen: startet einen fertigen Build wie in Produktion (Heap-Limit 280 MB, Modus web), ruft
 * die Hauptseiten und alle Spielerprofile mehrmals ab und misst nach jeder Runde den Heap nach dem Aufräumen.
 *
 *   npx next build && DATABASE_URL=… node scripts/memtest.mjs [--dist .next] [--port 3088] [--rounds 3]
 *                                                            [--budget 200] [--growth 12]
 *
 * Fehlschlag (Exit 1), wenn
 * - der Heap nach der letzten Runde über `--budget` MB liegt (zu viel bleibt dauerhaft liegen, z. B. ein
 *   Zwischenspeicher ohne Obergrenze, der je Profil wächst), oder
 * - er von der vorletzten zur letzten Runde um mehr als `--growth` MB wächst (Leck je Aufruf: dieselben Seiten
 *   ein weiteres Mal belegen mehr Speicher).
 * Produktion stürzt bei ~275 MB ab (Old Space 280 MB); scripts/cached-server.mjs startet ab 85 % (~250 MB) vorsorglich
 * neu. Gemessen am 22.11.2026: ~170 MB nach drei Runden, ohne die Obergrenze der Zwischenspeicher deutlich mehr.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const DIST = arg("dist", ".next");
const PORT = Number(arg("port", 3088));
const ROUNDS = Number(arg("rounds", 3));
const BUDGET_MB = Number(arg("budget", 200));
const GROWTH_MB = Number(arg("growth", 12));
const PARALLEL = 2;
const PAGES = ["/", "/spieler", "/bestenlisten", "/live", "/ereignisse", "/ereignisse?wo=alles", "/graph", "/verbindungen", "/verbindungen?ca=alle", "/verbindungen?gruppen=1", "/verbindungen?ansicht=distanz", "/zuschauer", "/zuschauer?ca=alle", "/raids", "/statistik"];

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
const here = dirname(fileURLToPath(import.meta.url));
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  ["--max-old-space-size=280", "--max-semi-space-size=16", "--expose-gc", "--import", pathToFileURL(join(here, "heap-report.mjs")).href, nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"],
  { env: { ...process.env, TRACKER_MODE: "web", NODE_ENV: "production", PORT: String(PORT), ...(DIST === ".next" ? {} : { NEXT_DIST_DIR: DIST }) }, stdio: ["ignore", "ignore", "inherit", "ipc"] },
);
let exited = false;
child.on("exit", (code, sig) => {
  exited = true;
  console.error(`Next.js beendet (${sig ?? code})`);
});
const stop = () => !exited && child.kill("SIGTERM");
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
const get = async (path) => {
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(120_000), headers: { "user-agent": "actracker-memtest" } });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: String(e?.message ?? e) };
  }
};
/** Aufräumen lassen und den Heap danach abwarten */
const heapAfterGc = () =>
  new Promise((resolve) => {
    const on = (m) => {
      if (!m?.heap?.afterGc) return;
      child.off("message", on);
      resolve(m.heap);
    };
    child.on("message", on);
    child.send({ gc: true });
  });
const mb = (b) => Math.round(b / 1e5) / 10;

const t0 = Date.now();
while ((await get("/api/tracker")).status !== 200) {
  if (exited || Date.now() - t0 > 180_000) throw new Error("Next.js startet nicht");
  await sleep(1000);
}
// Vorwärmen wie in Produktion abwarten, dann Ausgangswert
await sleep(5000);
const start = await heapAfterGc();
console.log(`Start: ${mb(start.used)} MB (Limit ${mb(start.limit)} MB)`);

const list = await get("/spieler");
const players = [...new Set([...list.text.matchAll(/href="\/spieler\/([^"/?#]+)"/g)].map((m) => m[1]))];
const urls = [...PAGES, ...players.map((id) => `/spieler/${id}`)];
console.log(`${PAGES.length} Seiten + ${players.length} Spielerprofile, ${ROUNDS} Runden`);

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  const r0 = Date.now();
  let i = 0;
  const bad = [];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (i < urls.length && !exited) {
        const url = urls[i++];
        const { status } = await get(url);
        if (status !== 200) bad.push(`${url} → ${status}`);
      }
    }),
  );
  if (exited) break;
  const h = await heapAfterGc();
  results.push(h.used);
  console.log(`Runde ${round}: ${mb(h.used)} MB nach dem Aufräumen (${Math.round((Date.now() - r0) / 1000)} s${bad.length ? `, ${bad.length} Fehler: ${bad.slice(0, 5).join(", ")}` : ""})`);
}

const last = results.at(-1) ?? Infinity;
const growth = results.length >= 2 ? results.at(-1) - results.at(-2) : 0;
const fails = [];
if (exited) fails.push("Next.js ist während des Tests beendet worden (Speicherabbruch?)");
if (last > BUDGET_MB * 1e6) fails.push(`Heap ${mb(last)} MB > Budget ${BUDGET_MB} MB`);
if (growth > GROWTH_MB * 1e6) fails.push(`Heap wächst je Runde um ${mb(growth)} MB > ${GROWTH_MB} MB`);
console.log(fails.length ? `FEHLGESCHLAGEN: ${fails.join("; ")}` : `OK: ${mb(last)} MB (Budget ${BUDGET_MB}), Zuwachs letzte Runde ${mb(growth)} MB (erlaubt ${GROWTH_MB})`);
stop();
process.exit(fails.length ? 1 : 0);
