/**
 * Zwischenspeicher für teure Abfragen, ausgelegt für einen kleinen Server (Render, 512 MB):
 * - Single-Flight: Gleichzeitige Anfragen teilen sich eine Berechnung, statt sie mehrfach zu starten.
 *   Mehrfaches Klicken auf eine Spielerseite startet so nicht mehrere teure Abfragen parallel.
 * - Stale-while-revalidate: Ist ein Eintrag abgelaufen, bekommt die Anfrage sofort den alten Wert,
 *   und genau eine Neuberechnung läuft im Hintergrund. Nur der allererste Aufruf wartet.
 * - Begrenzt: Einträge, die länger als `idleMs` nicht gelesen wurden, fliegen raus, und es gibt höchstens
 *   `maxEntries` (die am längsten ungelesenen zuerst). Sonst hielte z. B. der Verlauf jedes je aufgerufenen
 *   Spielerprofils (Suchmaschinen besuchen alle) den Speicher der Website voll, bis sie abstürzt.
 */
interface Entry {
  at: number;
  used: number;
  has: boolean;
  value: unknown;
  pending: Promise<unknown> | null;
}

export function createSwrCache({ maxEntries = 48, idleMs = 30 * 60_000 }: { maxEntries?: number; idleMs?: number } = {}) {
  const entries = new Map<string, Entry>();
  let swept = 0;

  /** Ungelesene raus; die Map ist nach letztem Lesen sortiert (touch setzt neu ein) */
  function sweep(now: number) {
    for (const [key, e] of entries) {
      if (entries.size <= maxEntries && now - e.used < idleMs) break;
      if (!e.pending) entries.delete(key);
    }
  }

  function touch(key: string, entry: Entry, now: number) {
    entry.used = now;
    entries.delete(key);
    entries.set(key, entry);
  }

  function refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = entries.get(key) ?? { at: 0, used: Date.now(), has: false, value: undefined, pending: null };
    if (entry.pending) return entry.pending as Promise<T>;
    const pending = load().then(
      (value) => {
        // Eintrag weiterverwenden (Lesezeit und Reihenfolge bleiben), nur falls er inzwischen verworfen wurde neu
        Object.assign(entry, { at: Date.now(), has: true, value, pending: null });
        if (!entries.has(key)) entries.set(key, entry);
        return value;
      },
      (err: unknown) => {
        // Fehlgeschlagen: alten Wert behalten, beim nächsten Aufruf erneut versuchen
        entry.pending = null;
        throw err;
      },
    );
    entry.pending = pending;
    if (!entries.has(key)) entries.set(key, entry);
    return pending;
  }

  return async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (entries.size > maxEntries || now - swept > 30_000) {
      swept = now;
      sweep(now);
    }
    const entry = entries.get(key);
    if (entry) touch(key, entry, now);
    if (entry?.has) {
      if (now - entry.at >= ttlMs && !entry.pending) {
        refresh(key, load).catch((err: unknown) => console.warn(`[cache] ${key} konnte nicht aktualisiert werden:`, err instanceof Error ? err.message : err));
      }
      return entry.value as T;
    }
    return refresh(key, load);
  };
}
