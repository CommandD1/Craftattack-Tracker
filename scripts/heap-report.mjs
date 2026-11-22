/**
 * Wird mit `node --import` in den Next.js-Prozess geladen (scripts/cached-server.mjs, scripts/memtest.mjs) und meldet
 * über den IPC-Kanal alle 15 s den Heap: { heap: { used, limit, at } }. Auf { gc: true } räumt er vorher auf (nur mit
 * `--expose-gc`, für den Speichertest), auf { heap: true } meldet er sofort. Ohne IPC-Kanal tut er nichts.
 */
import v8 from "node:v8";

/**
 * Grenze, an der der Prozess abstürzt: `--max-old-space-size` (heap_size_limit enthält zusätzlich die junge
 * Generation und liegt deutlich darüber; der Abbruch kam in Produktion bei ~275 MB belegt, Limit 280)
 */
const oldSpace = Number(/--max-old-space-size=(\d+)/.exec(process.execArgv.join(" "))?.[1]);

if (process.send) {
  const report = (extra = {}) => {
    const h = v8.getHeapStatistics();
    const limit = Number.isFinite(oldSpace) ? oldSpace * 1024 * 1024 : h.heap_size_limit;
    try {
      process.send({ heap: { used: h.used_heap_size, limit, at: Date.now(), ...extra } });
    } catch {
      /* Kanal zu: Elternprozess beendet */
    }
  };
  setInterval(report, 15_000).unref();
  process.on("message", (m) => {
    if (m?.gc && typeof globalThis.gc === "function") {
      // Zweimal: schwache Verweise und Finalisierer gehen erst im zweiten Lauf weg
      globalThis.gc();
      globalThis.gc();
      report({ afterGc: true });
    } else if (m?.gc || m?.heap) report();
  });
  // IPC-Kanal soll den Prozess nicht am Leben halten
  process.channel?.unref?.();
}
