/**
 * Changelog der Seite (/changelog): was sich für Besucher geändert hat, neueste zuerst.
 * Bei jeder sichtbaren Änderung oben einen Eintrag ergänzen (siehe CLAUDE.md). Rein interne Arbeit (Deploy, Wächter,
 * Aufräumen) gehört nicht hierher. `at` = Zeitpunkt, ab dem es live ist (UTC), für „Neu für dich“ (lib/visit.ts).
 */
export type ChangeKind = "neu" | "besser" | "daten" | "fix";

export interface Change {
  at: string;
  kind: ChangeKind;
  title: string;
  text?: string;
  /** Wo man es sieht */
  href?: string;
  /** Pull Requests auf GitHub */
  pr?: number[];
}

export const KIND_LABEL: Record<ChangeKind, string> = { neu: "Neu", besser: "Verbessert", daten: "Daten", fix: "Behoben" };
export const KIND_TONE: Record<ChangeKind, string> = { neu: "grass", besser: "diamond", daten: "gold", fix: "redstone" };

export const CHANGES: Change[] = [
  // ---------- November ----------
  { at: "2026-11-10T14:00:00Z", kind: "neu", title: "Changelog", text: "Diese Seite: alles, was sich an der Seite geändert hat, seit dem ersten Tag.", href: "/changelog" },
  {
    at: "2026-11-10T14:00:00Z",
    kind: "neu",
    title: "Neu seit deinem letzten Besuch",
    text: "Eine Zahl an „Verlauf“ zeigt, wie viele Ereignisse dazugekommen sind. Im Feed trennt eine rote Linie Neues von schon Gesehenem; „Alles gesehen“ setzt es zurück. Gespeichert wird das nur in deinem Browser.",
    href: "/",
    pr: [130],
  },
  {
    at: "2026-11-10T14:00:00Z",
    kind: "neu",
    title: "Rundgang mit Weiter-Karten",
    text: "Am Ende jeder Seite geht es zur nächsten Station. Nach acht Stationen hast du alles Wichtige gesehen; Spielerprofile führen weiter zu Rückblick und Verbindungen.",
    pr: [130],
  },
  { at: "2026-11-08T10:11:00Z", kind: "daten", title: "Tägliche Sicherung", text: "Alle Daten werden jede Nacht gesichert und die Sicherung regelmäßig probehalber wiederhergestellt.", pr: [125] },
  {
    at: "2026-11-07T21:59:00Z",
    kind: "daten",
    title: "Lücken im Live-Chat werden aus VODs gefüllt",
    text: "Der Tracker merkt genau, wann er einen Chat nicht mitlesen konnte, und trägt Abos, Raids, Cheers und Zuschauerwanderung aus dem VOD nach.",
    pr: [122],
  },
  {
    at: "2026-11-07T21:13:00Z",
    kind: "daten",
    title: "Abos, Cheers und Zuschauerwanderung nachgetragen",
    text: "Einzelne Abos und Cheers vom 19. bis 29. Oktober und die Zuschauerwanderung ab Staffelstart werden aus den VOD-Chats nachgelesen.",
    href: "/zuschauer",
    pr: [121],
  },
  { at: "2026-11-06T12:36:00Z", kind: "neu", title: "Staffel-Rückblick je Spieler", text: "Die ganze Staffel eines Spielers auf einer Seite, mit Erklärungen. Pausen bis eine Stunde zählen zur Session.", href: "/spieler", pr: [119, 120] },
  { at: "2026-11-06T12:27:00Z", kind: "neu", title: "Spielertypen", text: "Spielrhythmus aller Spieler: Nachteulen, Wochenend-Spieler, Marathon-Spieler und mehr.", href: "/spielertypen", pr: [118] },
  { at: "2026-11-06T08:17:00Z", kind: "besser", title: "Distanz: zoomen und ziehen", text: "Die Distanz-Ansicht startet näher an den Köpfen und zeigt Verbindungen auch ohne gewählten Spieler.", href: "/verbindungen?ansicht=distanz", pr: [117] },
  { at: "2026-11-06T07:57:00Z", kind: "fix", title: "Ausgeblendete Abschnitte blitzen nicht mehr auf", pr: [116] },
  { at: "2026-11-05T23:36:00Z", kind: "besser", title: "Bestenlisten: Wert öffnet den Verlauf", text: "Ein Klick auf einen Wert zeigt seine Entwicklung im Graphen.", href: "/bestenlisten", pr: [115] },
  { at: "2026-11-05T22:49:00Z", kind: "neu", title: "Graph: VOD an der Zeigerposition öffnen", text: "Im Graphen springt ein Klick ins VOD genau zu diesem Zeitpunkt; dazu Links zu den Profilen.", href: "/graph", pr: [112, 113, 114] },
  { at: "2026-11-05T20:53:00Z", kind: "besser", title: "Einheitliche Datumsauswahl mit Kalender", pr: [111] },
  {
    at: "2026-11-05T18:23:00Z",
    kind: "besser",
    title: "Verbindungen auf einer Seite",
    text: "Netz, Distanz und Gruppen sind Ansichten einer Seite mit gemeinsamen Einstellungen und Spielerauswahl, dazu „Nur auf dem Server“.",
    href: "/verbindungen",
    pr: [105, 107, 108, 109],
  },
  { at: "2026-11-05T15:58:00Z", kind: "besser", title: "Graph-Erklärung per Rechtsklick", text: "Rechtsklick in den Graphen erklärt die Stelle; der Bereich lässt sich mit rechts ziehen.", href: "/graph", pr: [103, 104] },
  { at: "2026-11-05T14:19:00Z", kind: "daten", title: "Offday 26./27. Oktober korrigiert", text: "Der Server war am FOMO-Offday zu; falsche Werte aus dieser Zeit sind bereinigt.", pr: [101] },
  { at: "2026-11-05T07:57:00Z", kind: "besser", title: "Seiten laden schneller", text: "Seiten kommen sofort aus dem Zwischenspeicher und werden im Hintergrund aufgefrischt; das Profil ist schlanker.", pr: [99] },
  { at: "2026-11-05T07:29:00Z", kind: "daten", title: "Ranglisten der Nether- und End-Events übernommen", text: "Für die Fortschritte im Profil.", pr: [98] },
  { at: "2026-11-04T22:31:00Z", kind: "besser", title: "Zuschauer-Graph: Ereignisse nach Bedeutung filtern", href: "/zuschauer", pr: [97] },
  { at: "2026-11-03T18:16:00Z", kind: "daten", title: "Abos vom 12. bis 28. Oktober wieder da", pr: [96] },
  { at: "2026-11-03T17:32:00Z", kind: "neu", title: "Fortschritte wie im Spiel", text: "Die Erfolge eines Spielers als Baum wie im Spiel, mit 3D-Blöcken, Vermutungen und Vergleich.", href: "/spieler", pr: [90, 91, 95] },
  { at: "2026-11-03T16:26:00Z", kind: "besser", title: "Abos, Bits und Einnahmen zählen überall gleich", text: "Bits sind eine vollwertige Kennzahl.", pr: [94] },
  { at: "2026-11-03T15:31:00Z", kind: "besser", title: "Profil neu sortiert", text: "Abschnitte verschwinden nach einem Update nicht mehr; Erklärungen bleiben im Fenster.", pr: [92, 93] },
  { at: "2026-11-03T12:00:00Z", kind: "besser", title: "Vorberechnete Auswertungen, Datenstand sichtbar", text: "Teure Auswertungen werden im Hintergrund gerechnet; jede Seite zeigt, wie aktuell ihre Daten sind. Updates ohne Ausfall.", pr: [88, 89] },
  {
    at: "2026-11-03T11:13:00Z",
    kind: "neu",
    title: "Zuschauer: Wanderung als Fluss",
    text: "Wohin Zuschauer gehen, wenn ein Stream endet, einbricht oder raidet: Fluss-Ansicht, Trends, Hypes und Abstürze mit Erklärung, die Staffel im Vergleich zu ganz Twitch.",
    href: "/zuschauer",
    pr: [85, 86, 87],
  },
  { at: "2026-11-02T21:35:00Z", kind: "neu", title: "Navigation in fünf Bereichen", text: "Jetzt, Spieler, Bestenlisten, Verlauf und Community, jeder mit eigenen Reitern; dazu eine einheitliche Spielerauswahl.", pr: [84] },
  { at: "2026-11-02T19:31:00Z", kind: "neu", title: "Gruppen über die Zeit", text: "Wie sich Gruppen im Lauf der Staffel bilden und auflösen, als farbige Gebiete im Netz.", href: "/verbindungen?gruppen=1", pr: [74, 75, 76, 77, 80, 83] },
  { at: "2026-11-02T12:10:00Z", kind: "besser", title: "Kompakteres Layout", text: "Abschnitte lassen sich ausblenden, Erklärungen kommen auf Klick.", pr: [81, 82] },
  { at: "2026-11-02T11:09:00Z", kind: "besser", title: "Verbindungen: Stream-Titel zählen mit", text: "Wer einen anderen Spieler im Titel nennt, ist mit ihm verbunden; geteilter Chat zählt nach Dauer.", href: "/verbindungen", pr: [79] },
  { at: "2026-11-02T09:50:00Z", kind: "neu", title: "Graph: Wer steckt hinter einer Veränderung?", text: "Zeitraum ziehen und verschieben; der Graph zeigt, welche Spieler einen Anstieg ausgelöst haben.", href: "/graph", pr: [72, 73, 78] },
  { at: "2026-11-02T05:53:00Z", kind: "besser", title: "Bestenlisten: Titel verlinkt, Pfeile öffnen den Graphen", href: "/bestenlisten", pr: [71] },
  { at: "2026-11-01T22:41:00Z", kind: "besser", title: "Ruhigerer Feed", text: "Zähler-Ereignisse erscheinen erst ab einer Schwelle, die sich nach dem Tag richtet; Sammel-Sprünge nach Lücken fallen raus. Clips sind sichtbar.", href: "/", pr: [66, 67, 68] },
  { at: "2026-10-31T16:01:00Z", kind: "daten", title: "Chat aus VODs nachgetragen", text: "Nachrichten aus Zeiten, in denen der Tracker nicht mitlesen konnte, kommen aus der Chat-Wiedergabe der VODs.", pr: [64] },
  { at: "2026-10-31T10:42:00Z", kind: "neu", title: "Twitch-Verlauf aus VODs und Clips", text: "Streams werden auch für Tracker-Lücken aus den VODs rekonstruiert; beliebte Clips erscheinen auf der Startseite.", href: "/", pr: [63] },
  { at: "2026-10-31T07:32:00Z", kind: "neu", title: "Gruppen mit Anführer, Kern und Rand", text: "Mit Erklärung, warum jemand zu einer Gruppe gehört, und Filter „Nur gegenseitige Verbindungen“.", href: "/verbindungen?gruppen=1", pr: [58, 59, 60, 61, 62] },
  { at: "2026-10-30T23:28:00Z", kind: "besser", title: "Netz: Fokus auf einen Spieler, unscharfe Suche", href: "/verbindungen", pr: [57] },
  { at: "2026-10-30T16:42:00Z", kind: "neu", title: "Schätzung mit gefüllten Datenlücken", text: "Eine eigene Ansicht füllte Lücken im Tracker mit Schätzungen. Inzwischen wieder abgeschaltet.", pr: [55, 56] },
  { at: "2026-10-29T17:59:00Z", kind: "neu", title: "Steckbrief des Trackers", text: "Unter /bot steht, wie der Tracker craftattack.one abfragt und woran man ihn erkennt.", href: "/bot", pr: [53] },
  { at: "2026-10-29T09:47:00Z", kind: "neu", title: "Twitch-Einnahmen als Kennzahl", text: "Geschätzte Einnahmen aus Abos und Bits, Anteil je Kanal, genaue Werte im laufenden Stream.", pr: [51, 52] },
  { at: "2026-10-27T22:02:00Z", kind: "neu", title: "Graph: Tagesverlauf", text: "Beliebige Kennzahlen über mehrere Tage übereinander, von 0 bis 24 Uhr.", href: "/graph", pr: [50] },
  { at: "2026-10-25T15:14:00Z", kind: "neu", title: "Bits und Cheers", text: "Cheers werden erfasst; ab 1.000 Bits erscheinen sie als Ereignis.", pr: [45] },
  { at: "2026-10-24T22:56:00Z", kind: "besser", title: "Genauere AFK-Erkennung", text: "Mit dem AFK-Zähler des Servers; wer stillsteht und farmt, gilt als AFK-Farm.", pr: [27, 35, 43] },
  { at: "2026-10-24T22:18:00Z", kind: "fix", title: "Ältere Tode, Raids und Streams bleiben sichtbar", text: "Seltene Ereignisse bleiben die ganze Staffel im Feed und behalten ihren VOD-Link.", pr: [42] },
  { at: "2026-10-24T21:56:00Z", kind: "besser", title: "Offizielle Events zuverlässig", text: "Die Termine von craftattack.one mit Uhrzeit und Teilnehmern.", href: "/events", pr: [14, 41] },
  { at: "2026-10-24T15:27:00Z", kind: "neu", title: "Verbindungen", text: "Wer mit wem zu tun hat: Raids, geteilte Chats und Chat-Nachrichten als Netz, mit Gewichtung je Art.", href: "/verbindungen", pr: [38, 39, 40] },
  { at: "2026-10-24T10:55:00Z", kind: "besser", title: "Hält tausende Besucher gleichzeitig aus", text: "Ein Zwischenspeicher vor der Seite.", pr: [37] },
  { at: "2026-10-23T23:31:00Z", kind: "fix", title: "Stabiler bei Datenbank-Ausfällen", pr: [33, 36] },
  { at: "2026-10-23T16:16:00Z", kind: "fix", title: "Sicherheitsupdate für Next.js", pr: [32] },
  { at: "2026-10-23T09:58:00Z", kind: "daten", title: "Offline-Spieler nachgeholt", text: "Werte von Spielern, die länger nicht online waren, wurden einmalig nachgeladen; Zähler-Graphen ohne Lücken.", pr: [29] },
  { at: "2026-10-22T21:47:00Z", kind: "besser", title: "Ereignisse: mehrere Spieler filtern", text: "Ein Klick auf eine Kachel springt zur Stelle in der Chronik.", href: "/ereignisse", pr: [28] },
  { at: "2026-10-22T13:24:00Z", kind: "neu", title: "Graph-Seite", text: "Jede Kennzahl, jeder Rang und jeder Block als Graph, für den Server oder einzelne Spieler; der Link lässt sich teilen.", href: "/graph", pr: [25, 26] },
  { at: "2026-10-22T11:10:00Z", kind: "neu", title: "So funktioniert’s", text: "Erklärt, woher die Zahlen kommen, statt langer Textblöcke auf jeder Seite.", href: "/so-funktionierts", pr: [24] },
  { at: "2026-10-22T10:39:00Z", kind: "neu", title: "Tageshighlights im Profil", href: "/spieler", pr: [23] },
  { at: "2026-10-22T10:33:00Z", kind: "besser", title: "Bestenlisten nach Rubriken", text: "Alle Zusatzwerte, einzelne Blöcke und Mobs, mit ▲▼ für Aufsteiger und Platz im Profil.", href: "/bestenlisten", pr: [21, 22] },
  { at: "2026-10-22T09:27:00Z", kind: "besser", title: "Köpfe mit Namen, Mörder als Kopf", text: "Tode durch andere Spieler zeigen beide Köpfe.", pr: [17, 18] },
  { at: "2026-10-21T17:59:00Z", kind: "besser", title: "Eine Farbe je Kennzahl, ruhigere Seiten", pr: [15, 16] },
  { at: "2026-10-21T09:49:00Z", kind: "besser", title: "Seiten öffnen sofort", text: "Platzhalter erscheinen sofort, die Daten werden nachgeladen.", pr: [8, 9] },
  { at: "2026-10-21T08:05:00Z", kind: "neu", title: "Geteilter Chat (Stream Together)", text: "Wer seinen Chat mit wem teilt, mit Beginn und Ende.", pr: [7] },
  { at: "2026-10-21T07:01:00Z", kind: "neu", title: "Chat im Profil, Rang-Karten", text: "Was ein Spieler in fremden Chats schreibt, Rang-Karten für die neun Hauptwerte, Rang-Verlauf für alle Werte.", href: "/spieler", pr: [5, 6] },
  // ---------- Oktober, vor den Pull Requests ----------
  { at: "2026-10-19T12:00:00Z", kind: "neu", title: "Chat-Nachrichten zwischen Spielern", text: "Wenn ein Spieler im Twitch-Chat eines anderen schreibt, wird das erfasst." },
  { at: "2026-10-18T12:00:00Z", kind: "neu", title: "Schaden, Totems und Essen", text: "Neue Kennzahlen; Erfolge erscheinen im Feed." },
  { at: "2026-10-16T12:00:00Z", kind: "besser", title: "Ereignisse mit VOD-Zeit", text: "Ereignisse während eines Streams verlinken die passende Stelle im VOD; offene Seiten aktualisieren sich jede Minute." },
  { at: "2026-10-14T12:00:00Z", kind: "besser", title: "Geschenk-Abos zusammengefasst", text: "Mehrere Geschenk-Abos auf einmal erscheinen als eine Kachel." },
  { at: "2026-10-13T12:00:00Z", kind: "neu", title: "Raids und Follower", text: "Raids zwischen Spielern und Follower-Zuwachs werden erfasst." },
  { at: "2026-10-13T11:00:00Z", kind: "besser", title: "Rücksichtsvollere Abfragen", text: "Zufällige Abstände und Pausen, falls craftattack.one den Tracker bremst." },
  { at: "2026-10-12T21:00:00Z", kind: "neu", title: "Abos", text: "Abos, Resubs und Geschenk-Abos aus dem Twitch-Chat, mit eigener Bestenliste.", href: "/bestenlisten?liste=twitchSubs", pr: [1] },
  { at: "2026-10-11T18:52:00Z", kind: "neu", title: "AFK und AFK-Farmen", text: "Wer fünf Minuten stillsteht, ist AFK; wer dabei Mobs oder Blöcke farmt, hat eine AFK-Farm." },
  { at: "2026-10-11T14:48:00Z", kind: "besser", title: "Live: Zeitraum wählbar", text: "Peak, Zuschauerkurve und Chronik für eine Stunde bis die ganze Staffel.", href: "/live" },
  { at: "2026-10-11T13:45:00Z", kind: "neu", title: "Ausführliches Spielerprofil", text: "Rang-Verlauf, Online-Heatmap, Raten pro Stunde, Sessions und Streams in einer Liste." },
  { at: "2026-10-11T13:06:00Z", kind: "neu", title: "Dunkles Design", text: "Umschalter oben rechts." },
  { at: "2026-10-11T10:04:00Z", kind: "neu", title: "Zeitstrahl und Zeitraffer", text: "Wer wann online war, und ein ganzer Tag zum Abspielen; Tode mit VOD-Link.", href: "/zeitstrahl" },
  {
    at: "2026-10-10T13:24:00Z",
    kind: "neu",
    title: "Start des Trackers",
    text: "Am ersten Tag der Staffel: Spieler, Bestenlisten über die Top 10 hinaus, Verlaufskurven, Statistik mit Rekorden, Ereignisse mit Filtern, 3D-Skin im Profil.",
    href: "/",
  },
];

/** Neuester Eintrag (ms) */
export const LATEST_CHANGE = Math.max(...CHANGES.map((c) => Date.parse(c.at)));
