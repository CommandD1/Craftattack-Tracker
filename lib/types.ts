export type BoardKey =
  | "playtimeSeconds"
  | "diamonds"
  | "deaths"
  | "blocksBroken"
  | "mobsKilled"
  | "distance";

export const BOARD_KEYS: BoardKey[] = [
  "playtimeSeconds",
  "diamonds",
  "deaths",
  "blocksBroken",
  "mobsKilled",
  "distance",
];

export interface LiveInfo {
  login: string;
  title: string;
  viewers: number;
}

export interface ApiPlayer {
  id: string;
  name: string;
  uuid: string;
  live: LiveInfo | null;
}

export interface BoardEntry {
  id: string;
  name: string;
  uuid: string;
  value: number;
}

/** Rang eines Spielers in einer Liste laut /api/ext/<id> */
export interface PlayerRank {
  rank: number;
  of: number;
}

/** Zähler-Keys, die /api/ext/<id> liefert (keine Spielzeit) */
export type ExtKey = Exclude<BoardKey, "playtimeSeconds">;
export const EXT_KEYS: ExtKey[] = ["diamonds", "deaths", "blocksBroken", "mobsKilled", "distance"];

/** Antwort von https://craftattack.one/api/ext/<id> */
export interface ApiExtPlayer {
  updatedAt: string;
  serverOnline: boolean;
  participant: { id: string; name: string } | null;
  player:
    | ({ id: string; name: string; online: boolean } & Record<ExtKey, number> & {
        ranks: Partial<Record<ExtKey, PlayerRank>>;
      })
    | null;
}

export interface ApiStats {
  updatedAt: string;
  serverOnline: boolean;
  onlineCount: number;
  playerCount: number;
  totals: { playtimeSeconds: number; deaths: number };
  boards: Record<BoardKey, BoardEntry[]>;
  online: ApiPlayer[];
  live: (LiveInfo & { id: string; name: string })[];
}

export type EventType =
  | "join"
  | "leave"
  | "death"
  | "diamonds"
  | "blocksBroken"
  | "mobsKilled"
  | "distance"
  | "stream_start"
  | "stream_end"
  | "stream_title"
  | "server_online"
  | "server_offline"
  | "tracker_start"
  | "first_join"
  | "rank"
  | "milestone"
  | "record";

export interface TrackerEvent {
  id: string;
  at: string; // ISO
  type: EventType;
  /** Spieler-ID (slug) – fehlt bei Server-Events */
  player?: string;
  playerName?: string;
  uuid?: string;
  /** Wo: "server" oder "twitch" */
  where: "server" | "twitch" | "tracker";
  /** Delta bei Zählern (z. B. +3 Tode) */
  delta?: number;
  /** Neuer Gesamtwert */
  value?: number;
  /** Zusatzinfos (Streamtitel, Viewer, …) */
  meta?: Record<string, string | number | boolean | null>;
}

export interface PlayerState {
  id: string;
  name: string;
  uuid: string;
  online: boolean;
  live: LiveInfo | null;
  /** Letzter bekannter Stand aus den Boards bzw. /api/ext/<id> */
  stats: Partial<Record<BoardKey, number>>;
  /** Ränge laut /api/ext/<id> (leer, solange der Spieler dort noch nie abgefragt wurde) */
  ranks: Partial<Record<ExtKey, PlayerRank>>;
  firstSeen: string;
  lastSeen: string;
  /** Beginn der aktuellen Online-Session */
  sessionStart: string | null;
  /** Summe abgeschlossener Sessions in Sekunden (vom Tracker gemessen) */
  trackedSeconds: number;
  sessions: number;
  liveSince: string | null;
  peakViewers: number;
  /** Längste vom Tracker gemessene Session in Sekunden */
  longestSession: number;
}

export interface RecordValue {
  value: number;
  at: string;
}
export interface TrackerRecords {
  peakOnline: RecordValue | null;
  peakViewers: RecordValue | null;
  peakLive: RecordValue | null;
}

/** Ein Messpunkt pro Spieler (nur gespeichert, wenn sich etwas geändert hat oder 5 Min vergangen sind) */
export interface PlayerPoint {
  at: string;
  online: boolean;
  viewers: number | null;
  playtimeSeconds: number | null;
  deaths: number | null;
  diamonds: number | null;
  blocksBroken: number | null;
  mobsKilled: number | null;
  distance: number | null;
}

export interface TotalsPoint {
  at: string;
  onlineCount: number;
  liveCount: number;
  viewers: number;
  playtimeSeconds: number;
  deaths: number;
}

export interface TrackerState {
  startedAt: string;
  lastPoll: string | null;
  lastOk: string | null;
  lastError: string | null;
  polls: number;
  serverOnline: boolean | null;
  latest: ApiStats | null;
  players: Record<string, PlayerState>;
  history: TotalsPoint[];
  eventCount: number;
  records: TrackerRecords;
}
