import type { BoardKey } from "./types";

/**
 * Titel, Untertitel und Farbton der neun Hauptlisten, wie auf https://craftattack.one/stats/.
 * Genutzt von den Rang-Karten im Spielerprofil.
 */
export const BOARD_STYLE: Record<BoardKey, { title: string; sub: string; tone: string }> = {
  playtimeSeconds: { title: "Dauerzocker", sub: "Meiste Spielzeit", tone: "sky" },
  diamonds: { title: "Diamantenbank", sub: "Wer hat, der hat", tone: "diamond" },
  deaths: { title: "Friedhof", sub: "Hier liegen sie. Immer wieder.", tone: "ender" },
  blocksBroken: { title: "Abrissbirne", sub: "Meiste Blöcke abgebaut", tone: "gold" },
  mobsKilled: { title: "Monsterjäger", sub: "Meiste Mobs erledigt", tone: "grass" },
  distance: { title: "Weltenbummler", sub: "Weiteste Strecke", tone: "pink" },
  totemsUsed: { title: "Unsterblich", sub: "Meiste Totems verbraucht", tone: "lava" },
  damageDealt: { title: "Kampfmaschine", sub: "Meisten Schaden ausgeteilt", tone: "redstone" },
  foodEaten: { title: "Vielfraß", sub: "Meiste Mahlzeiten verdrückt", tone: "amethyst" },
};

/** Reihenfolge wie auf craftattack.one/stats */
export const BOARD_ORDER: BoardKey[] = ["playtimeSeconds", "diamonds", "deaths", "blocksBroken", "mobsKilled", "distance", "totemsUsed", "damageDealt", "foodEaten"];
