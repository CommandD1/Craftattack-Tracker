/**
 * Feste Gruppen („Clans“) der Staffel: Name, Farbe und Spieler-IDs (wie in der craftattack.one-API).
 * Wird im Netz farbig hervorgehoben und bekommt eine eigene Karte. Mitglieder hier pflegen.
 */
export interface Clan {
  key: string;
  name: string;
  /** Farbton aus den Design-Tokens (grass, gold, diamond, redstone, amethyst, pink, sky, lava, twitch) */
  tone: string;
  members: string[];
}

export const CLANS: Clan[] = [
  { key: "ghg", name: "GHG", tone: "gold", members: ["ghg"] },
];

export const CLAN_COLORS: Record<string, string> = {
  grass: "#6fdc5a",
  gold: "#ffd23f",
  diamond: "#4be3d6",
  redstone: "#ff6452",
  amethyst: "#c88ae6",
  pink: "#f0b6e4",
  sky: "#8ccdff",
  lava: "#ff9a2e",
  twitch: "#9146ff",
};

/** Spieler-ID → Clan */
export const CLAN_OF: Record<string, Clan> = Object.fromEntries(CLANS.flatMap((c) => c.members.map((m) => [m.toLowerCase(), c])));
