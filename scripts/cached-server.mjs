#!/usr/bin/env node
/**
 * Kurzzeit-Cache vor der Website, für viele gleichzeitige Besucher.
 *
 *   node scripts/cached-server.mjs        (PORT wie gewohnt, Next.js läuft intern auf PORT + 1)
 *
 * Die Seiten hängen nur von der URL ab (kein Login, keine Cookies) und die Daten ändern sich höchstens einmal pro
 * Minute. Deshalb wird jede Seite (HTML, RSC-Daten für Navigation und Auto-Refresh, API-Antworten) höchstens alle
 * FRESH_MS neu gerendert; alle anderen Besucher bekommen die fertige, gzip-komprimierte Kopie.
 * - Gleichzeitige Anfragen für dieselbe Seite warten auf ein einziges Rendern.
 * - Ältere Kopien (bis STALE_MS) werden sofort ausgeliefert und im Hintergrund erneuert.
 * - Höchstens MAX_RENDERS Seiten werden gleichzeitig gerendert (2 CPUs), der Rest wartet in einer Schlange.
 * - Endet Next.js, endet auch dieser Prozess (systemd startet beide neu).
 * - `/schaetzung/…` geht an die Schätzungs-Ausgabe (eigener Dienst auf ESTIMATE_PORT, siehe README), mit demselben Cache.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";

const PORT = Number(process.env.PORT ?? 3000);
const INNER_PORT = Number(process.env.INNER_PORT ?? PORT + 1);
const FRESH_MS = 30_000;
const STALE_MS = 10 * 60_000;
const MAX_BYTES = 120 * 1024 * 1024;
const MAX_RENDERS = 3;
const MAX_QUEUE = 400;
const UPSTREAM_TIMEOUT_MS = 90_000;
/** Schätzungs-Ausgabe (eigener Next.js-Dienst mit basePath /schaetzung) */
const ESTIMATE_PORT = Number(process.env.ESTIMATE_PORT ?? 3030);
const ESTIMATE_PREFIX = /^\/schaetzung(\/|\?|$)/;
const portFor = (url) => (ESTIMATE_PREFIX.test(url) ? ESTIMATE_PORT : INNER_PORT);
/** Nie zwischenspeichern: Cron/Poll, Vorwärmen, Status */
const BYPASS = [/^(\/schaetzung)?\/api\/cron\//, /^(\/schaetzung)?\/api\/tracker(\/|$|\?)/, /^(\/schaetzung)?\/api\/warm/];
/** Diese Anfrage-Header ändern die Antwort von Next.js (siehe dessen `Vary`) und gehören in den Schlüssel */
const VARY = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url"];
/** Nicht an den Besucher weiterreichen; Länge und Kodierung setzt dieser Prozess selbst */
const DROP = new Set(["content-length", "transfer-encoding", "connection", "keep-alive", "content-encoding"]);

/* ---------- Next.js als Kindprozess ---------- */
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  ["--max-old-space-size=280", "--max-semi-space-size=16", nextBin, "start", "-p", String(INNER_PORT), "-H", "127.0.0.1"],
  { env: { ...process.env, PORT: String(INNER_PORT) }, stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  console.error(`[cache] Next.js beendet (${signal ?? code}), beende auch den Cache`);
  process.exit(code || 1);
});
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    child.kill(sig);
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

/* ---------- Cache ---------- */
/** @type {Map<string, { key?: string; at: number; status: number; headers: Record<string, string | string[]>; body: Buffer; gzip: boolean; plain?: Buffer }>} */
const cache = new Map();
let cachedBytes = 0;
/** @type {Map<string, Promise<any>>} */
const rendering = new Map();
let active = 0;
/** @type {(() => void)[]} */
const queue = [];

function store(key, entry) {
  const old = cache.get(key);
  if (old) {
    cachedBytes -= old.body.length + (old.plain?.length ?? 0);
    cache.delete(key);
  }
  cache.set(key, entry);
  cachedBytes += entry.body.length;
  // Älteste zuerst verdrängen (Map behält die Einfügereihenfolge, Treffer werden hinten neu eingereiht)
  for (const [k, e] of cache) {
    if (cachedBytes <= MAX_BYTES) break;
    cachedBytes -= e.body.length + (e.plain?.length ?? 0);
    cache.delete(k);
  }
}

function slot() {
  if (active < MAX_RENDERS) {
    active++;
    return Promise.resolve();
  }
  if (queue.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error("Warteschlange voll"), { busy: true }));
  return new Promise((resolve) => queue.push(resolve)).then(() => void active++);
}
function release() {
  active--;
  queue.shift()?.();
}

/** Holt die Antwort von Next.js vollständig (gzip angefragt) */
function fetchUpstream(req) {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers, "accept-encoding": "gzip" };
    const up = http.request({ host: "127.0.0.1", port: portFor(req.url ?? "/"), method: "GET", path: req.url, headers, timeout: UPSTREAM_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ at: Date.now(), status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks), gzip: res.headers["content-encoding"] === "gzip" }));
      res.on("error", reject);
    });
    up.on("timeout", () => up.destroy(new Error("Zeitüberschreitung beim Rendern")));
    up.on("error", reject);
    up.end();
  });
}

/** Ein Rendern je Schlüssel, egal wie viele Besucher gleichzeitig fragen */
function render(key, req) {
  let p = rendering.get(key);
  if (!p) {
    p = slot()
      .then(() => fetchUpstream(req).finally(release))
      .then((entry) => {
        entry.key = key;
        if (entry.status === 200 && !entry.headers["set-cookie"]) store(key, entry);
        return entry;
      })
      .finally(() => rendering.delete(key));
    rendering.set(key, p);
  }
  return p;
}

function send(req, res, entry, state) {
  const headers = {};
  for (const [k, v] of Object.entries(entry.headers)) if (!DROP.has(k) && v !== undefined) headers[k] = v;
  let body = entry.body;
  if (entry.gzip) {
    if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) headers["content-encoding"] = "gzip";
    else {
      if (!entry.plain) {
        entry.plain = gunzipSync(entry.body);
        if (cache.get(entry.key) === entry) cachedBytes += entry.plain.length;
      }
      body = entry.plain;
    }
  }
  headers["content-length"] = String(body.length);
  headers["x-cache"] = state;
  res.writeHead(entry.status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

/** Alles, was nicht zwischengespeichert wird, unverändert durchreichen (inkl. Streaming) */
function pass(req, res) {
  const up = http.request({ host: "127.0.0.1", port: portFor(req.url ?? "/"), method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Website startet gerade, bitte gleich neu laden.");
  });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  res.on("error", () => {});
  const url = req.url ?? "/";
  if ((req.method !== "GET" && req.method !== "HEAD") || BYPASS.some((r) => r.test(url))) return pass(req, res);
  const key = [req.headers.host ?? "", url, ...VARY.map((h) => req.headers[h] ?? "")].join("\n");
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < STALE_MS) {
    // Treffer hinten neu einreihen (zuletzt benutzt)
    cache.delete(key);
    cache.set(key, hit);
    if (age >= FRESH_MS) render(key, req).catch(() => {});
    return send(req, res, hit, age < FRESH_MS ? "HIT" : "STALE");
  }
  try {
    send(req, res, await render(key, req), "MISS");
  } catch (err) {
    if (hit) return send(req, res, hit, "STALE");
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "5" });
    res.end(err?.busy ? "Gerade sehr viele Besucher, bitte in ein paar Sekunden neu laden." : "Website startet gerade, bitte gleich neu laden.");
  }
});
server.keepAliveTimeout = 65_000;
server.listen(PORT, () => console.log(`[cache] Port ${PORT} → Next.js auf ${INNER_PORT} (frisch ${FRESH_MS / 1000} s, Reserve ${STALE_MS / 60_000} Min)`));
