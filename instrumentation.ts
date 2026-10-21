export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runsTracker, servesWeb, trackerMode } = await import("./lib/mode");
    console.log(`[tracker] Modus: ${trackerMode()}`);
    if (servesWeb()) {
      // Teure Zwischenspeicher der Spielerseiten vorwärmen, sobald der Server Anfragen annimmt
      const port = process.env.PORT ?? "3000";
      setTimeout(() => {
        fetch(`http://127.0.0.1:${port}/api/warm`, { signal: AbortSignal.timeout(120_000) })
          .then(async (r) => console.log(`[tracker] Zwischenspeicher vorgewärmt (${r.status}, ${(await r.json().catch(() => ({})) as { ms?: number }).ms ?? "?"} ms)`))
          .catch((err: unknown) => console.warn("[tracker] Vorwärmen fehlgeschlagen:", err instanceof Error ? err.message : err));
      }, 15_000);
    }
    if (!runsTracker()) return;
    const { startPolling } = await import("./lib/tracker");
    startPolling();
    const { startTwitchIrc } = await import("./lib/twitchIrc");
    startTwitchIrc();
    // Einmal pro Prozess: alte Verlaufsdaten korrigieren und fehlende AFK-Farm-Ereignisse nachtragen
    const { runBackfills } = await import("./lib/backfill");
    runBackfills().catch((err: unknown) => console.error("[tracker] Nachträge fehlgeschlagen:", err));
  }
}
