/**
 * Neuerungen für Besucher (Startseite, „Neu auf der Seite“).
 * Nur neue Auswertungen und Ansichten – keine Fehlerbehebungen, Feinschliff oder Technik im Hintergrund.
 * Neueste zuerst; `date` als TT.MM.
 */
export interface ChangelogEntry {
  date: string;
  title: string;
  text: string;
  href: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "17.11.",
    title: "Filter „Nur CraftAttack“",
    text: "Verbindungen, Zuschauer und Raids zählen auf Wunsch nur, was passierte, während einer oder beide auf dem Server waren.",
    href: "/verbindungen?ca=beide",
  },
  {
    date: "15.11.",
    title: "Eigene Seite für jedes Ereignis",
    text: "Ein Ereignis anklicken: Verlauf, Auslöser, Zusammenhänge und wer es noch geschafft hat.",
    href: "/ereignisse",
  },
  {
    date: "15.11.",
    title: "Raids: Wer raidet wen?",
    text: "Wer wen wie oft raidet, mit wie vielen Zuschauern, und wen man hätte raiden können.",
    href: "/raids",
  },
  {
    date: "06.11.",
    title: "Staffel-Rückblick je Spieler",
    text: "Die Staffel eines Spielers in Zahlen, im Profil über „Staffel-Rückblick“.",
    href: "/spieler",
  },
  {
    date: "06.11.",
    title: "Spielertypen",
    text: "Wann jemand spielt (Spielrhythmus) und welchem Typ das entspricht.",
    href: "/spielertypen",
  },
  {
    date: "05.11.",
    title: "Graph: VOD an der Stelle öffnen",
    text: "Im Graphen auf einen Zeitpunkt klicken und das passende VOD öffnen.",
    href: "/graph?metric=viewers",
  },
  {
    date: "05.11.",
    title: "Verbindungen: Netz, Distanz und Gruppen",
    text: "Alles auf einer Seite; wer wem am nächsten steht und wer eine Gruppe bildet.",
    href: "/verbindungen?ansicht=distanz",
  },
  {
    date: "03.11.",
    title: "Zuschauerwanderung",
    text: "Wohin Zuschauer gehen, wenn ein Stream endet oder raidet – je Tag, Staffel und Streamer.",
    href: "/zuschauer",
  },
  {
    date: "03.11.",
    title: "Fortschritte wie im Spiel",
    text: "Im Profil als Baum: geschafft, vermutet und was noch fehlt.",
    href: "/spieler",
  },
  {
    date: "02.11.",
    title: "Gruppen als Gebiete",
    text: "Gruppen im Netz als farbige Flächen, auch im Verlauf der Staffel.",
    href: "/verbindungen?gruppen=1",
  },
  {
    date: "02.11.",
    title: "Graph: Wer steckt dahinter?",
    text: "Klick in den Graphen zeigt, welche Spieler und Ereignisse eine Veränderung ausgelöst haben.",
    href: "/graph?metric=onlineCount&zeit=3d",
  },
  {
    date: "31.10.",
    title: "Gruppen mit Anführer, Kern und Rand",
    text: "Wer eine Gruppe anführt, wer zum Kern gehört und warum jemand dazuzählt.",
    href: "/verbindungen?gruppen=1",
  },
  {
    date: "01.11.",
    title: "Top-Clips",
    text: "Die meistgesehenen Clips auf der Übersicht und im Profil.",
    href: "/ereignisse?t=clip",
  },
  {
    date: "29.10.",
    title: "Twitch-Einnahmen (geschätzt)",
    text: "Aus Abos und Bits auf dem Server, je Spieler und gesamt.",
    href: "/graph?metric=twitchEarnings&zeit=alle",
  },
  {
    date: "27.10.",
    title: "Graph: Tagesverlauf",
    text: "Alle Tage übereinander auf 0–24 Uhr, für jede Kennzahl.",
    href: "/graph?metric=onlineCount&zeit=7d&ansicht=tag",
  },
  {
    date: "25.10.",
    title: "Bits und Cheers",
    text: "Cheers in den Streams als Kennzahl und Bestenliste.",
    href: "/graph?metric=twitchBits&zeit=alle",
  },
  {
    date: "24.10.",
    title: "Verbindungen",
    text: "Netz aus Raids, geteilten Chats, Titeln und Chat-Nachrichten.",
    href: "/verbindungen",
  },
  {
    date: "22.10.",
    title: "Graph-Seite",
    text: "Beliebige Kennzahlen, Ränge und Items für beliebige Spieler vergleichen.",
    href: "/graph",
  },
  {
    date: "22.10.",
    title: "Mehr Bestenlisten",
    text: "Nach Rubriken sortiert, 17 neue Listen und einzelne Blöcke und Mobs.",
    href: "/bestenlisten",
  },
  {
    date: "22.10.",
    title: "Tageshighlights im Profil",
    text: "Die wichtigsten Momente eines Spielers an jedem Tag.",
    href: "/spieler",
  },
  {
    date: "21.10.",
    title: "Rang-Verlauf und Chat im Profil",
    text: "Platz in jeder Bestenliste über die Zeit und mit wem ein Spieler chattet.",
    href: "/spieler",
  },
  {
    date: "12.10.",
    title: "Twitch-Abos",
    text: "Abos, Resubs und Geschenk-Abos aus dem Chat, mit eigener Bestenliste.",
    href: "/bestenlisten?liste=twitchSubs",
  },
  {
    date: "11.10.",
    title: "Zeitstrahl und Zeitraffer",
    text: "Wer wann online war, und ein ganzer Tag zum Abspielen.",
    href: "/zeitstrahl",
  },
];
