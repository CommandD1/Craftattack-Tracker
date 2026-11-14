import type { TrackerEvent, TrackerRecords } from "./types";

/**
 * Server-Rekorde (gleichzeitig online, Streams live, Zuschauer auf dem Server) – eine Regel für den Live-Tracker
 * und für den Neuaufbau aus dem Verlauf (Tabelle `history`), damit beide dieselben Rekord-Ereignisse liefern.
 */
export type RecordKey = keyof TrackerRecords;

export const RECORD_LABEL: Record<RecordKey, string> = {
  peakOnline: "Spieler gleichzeitig online",
  peakLive: "Streams gleichzeitig live",
  peakViewers: "Zuschauer gesamt",
};

/** Ein neuer Höchstwert wird gemeldet – Zuschauer nur beim Überschreiten einer neuen 10.000er-Marke */
export function notifyRecord(key: RecordKey, value: number, prev: number): boolean {
  return key !== "peakViewers" || Math.floor(value / 10_000) > Math.floor(prev / 10_000);
}

/** Feste ID, damit ein erneuter Neuaufbau dieselben Ereignisse ergibt */
export const recordEventId = (key: RecordKey, at: string) => `record-${key}-${Date.parse(at)}`;

export interface HistoryRecordRow {
  at: string;
  onlineCount: number;
  liveCount: number;
  viewers: number;
}

const ROW_VALUE: Record<RecordKey, (r: HistoryRecordRow) => number> = {
  peakOnline: (r) => r.onlineCount,
  peakLive: (r) => r.liveCount,
  peakViewers: (r) => r.viewers,
};

/**
 * Rekord-Ereignisse und Höchststände aus dem nach Zeit sortierten Verlauf. Der erste Messpunkt setzt nur den
 * Ausgangswert (wie beim Tracker-Start), danach wie live: jeder neue Höchstwert zählt, gemeldet nach `notifyRecord`.
 */
export function recordsFromHistory(rows: HistoryRecordRow[]): { events: TrackerEvent[]; records: TrackerRecords } {
  const records: TrackerRecords = { peakOnline: null, peakLive: null, peakViewers: null };
  const events: TrackerEvent[] = [];
  for (const row of rows) {
    for (const key of Object.keys(ROW_VALUE) as RecordKey[]) {
      const value = ROW_VALUE[key](row);
      const prev = records[key];
      if (prev && value <= prev.value) continue;
      records[key] = { value, at: row.at };
      if (prev && notifyRecord(key, value, prev.value)) {
        events.push({
          id: recordEventId(key, row.at),
          at: row.at,
          type: "record",
          where: "server",
          value,
          delta: value - prev.value,
          meta: { key, label: RECORD_LABEL[key], rebuilt: true },
        });
      }
    }
  }
  return { events, records };
}

/** Höherer der beiden Stände je Rekord (z. B. gespeicherter Zustand gegen den Verlauf) */
export function maxRecords(a: TrackerRecords, b: TrackerRecords): TrackerRecords {
  const pick = (k: RecordKey) => {
    const x = a[k];
    const y = b[k];
    return !x ? y : !y ? x : y.value > x.value ? y : x;
  };
  return { peakOnline: pick("peakOnline"), peakLive: pick("peakLive"), peakViewers: pick("peakViewers") };
}
