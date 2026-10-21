import type { BoardKey } from "./types";
import type { StatGroup } from "./playerStats";

/**
 * Eine Farbe je Kennzahl – überall dieselbe: Kacheln, Bestenlisten, Graph-Auswahl, Ereignisse, Profil.
 *
 * Die neun Hauptlisten bekommen je einen eigenen Ton. Alles rund um Twitch ist `twitch`, "auf dem Server"
 * teilt sich den Ton der Spielzeit, reine Tracker-Zähler (Sessions, Ereignisse) sind neutral – so bedeutet
 * Farbe immer "welche Kennzahl".
 * Zusatzwerte erben den Ton ihrer Gruppe; AFK-Farmen den Ton dessen, was gefarmt wird.
 */
export type Tone = "sky" | "diamond" | "redstone" | "gold" | "grass" | "pink" | "amethyst" | "lava" | "ender" | "twitch" | "white" | "paper";

export const BOARD_TONE: Record<BoardKey, Tone> = {
  playtimeSeconds: "sky",
  diamonds: "diamond",
  deaths: "redstone",
  blocksBroken: "gold",
  mobsKilled: "grass",
  distance: "pink",
  totemsUsed: "amethyst",
  damageDealt: "lava",
  foodEaten: "ender",
};

export const GROUP_TONE: Record<StatGroup, Tone> = {
  allgemein: "white",
  abbau: BOARD_TONE.blocksBroken,
  kampf: BOARD_TONE.damageDealt,
  bewegung: BOARD_TONE.distance,
  items: BOARD_TONE.foodEaten,
  tiere: BOARD_TONE.mobsKilled,
  afk: "paper",
};

/** Kennzahlen außerhalb der Hauptlisten */
export const METRIC_TONE = {
  ...BOARD_TONE,
  // Twitch
  liveCount: "twitch",
  viewers: "twitch",
  followers: "twitch",
  twitchSubs: "twitch",
  // Auf dem Server sein: derselbe Ton wie die Spielzeit (CSS: --presence), auch im Zeitstrahl
  onlineCount: BOARD_TONE.playtimeSeconds,
  online: BOARD_TONE.playtimeSeconds,
  /** Vom Tracker gemessene Online-Zeit */
  tracked: BOARD_TONE.playtimeSeconds,
  // Zähler des Trackers: neutral
  sessions: "white",
  events: "white",
  // AFK: neutral, Farmen in der Farbe dessen, was gefarmt wird
  afkSeconds: "paper",
  afkMobsSeconds: BOARD_TONE.mobsKilled,
  afkBlocksSeconds: BOARD_TONE.blocksBroken,
} satisfies Record<string, Tone>;

export type MetricToneKey = keyof typeof METRIC_TONE;
