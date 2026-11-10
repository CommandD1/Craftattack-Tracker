/**
 * Rundgang durch die Seite: eine feste Reihenfolge der wichtigsten Seiten, damit Besucher wissen, wo es weitergeht und
 * wann sie alles gesehen haben. Jede Seite bekommt am Ende eine „Weiter“-Karte (components/NextSteps.tsx): die
 * nächste Station und eine passende Seite dazu. Spielerseiten zeigen auf Rückblick und Verbindungen desselben Spielers.
 */
export interface Step {
  href: string;
  title: string;
  /** Warum man dort hin will, ein Satz */
  why: string;
}

export const TOUR: Step[] = [
  { href: "/", title: "Übersicht", why: "Was gerade auf dem Server los ist und was zuletzt passiert ist." },
  { href: "/spieler", title: "Spieler", why: "Alle Spieler mit Spielzeit, Toden und Streams – jeder mit eigenem Profil." },
  { href: "/spielertypen", title: "Spielertypen", why: "Nachteulen, Wochenend-Spieler, Marathon-Spieler: Wer spielt wann und wie lange?" },
  { href: "/bestenlisten", title: "Bestenlisten", why: "Die Rekorde der Staffel, für jeden Spieler und nicht nur die Top 10." },
  { href: "/verbindungen", title: "Verbindungen", why: "Wer mit wem verbunden ist: Raids, geteilte Chats und Gruppen als Netz." },
  { href: "/zuschauer", title: "Zuschauer", why: "Wohin die Zuschauer gehen, wenn ein Streamer aufhört oder raidet." },
  { href: "/zeitstrahl", title: "Zeitstrahl", why: "Ein ganzer Tag auf dem Server zum Abspielen, alle fünf Minuten ein Bild." },
  { href: "/statistik", title: "Statistik", why: "Die ganze Staffel in Zahlen – alles, was der Tracker je gemessen hat." },
];

const STEP = (href: string) => TOUR.find((s) => s.href === href)!;

/** Seiten außerhalb des Rundgangs: wohin sie am besten weiterführen */
const EXTRA: Record<string, { title: string; next: string[] }> = {
  "/live": { title: "Live", next: ["/zuschauer", "/"] },
  "/events": { title: "Events", next: ["/zeitstrahl", "/ereignisse"] },
  "/ereignisse": { title: "Ereignisse", next: ["/zeitstrahl", "/graph"] },
  "/graph": { title: "Graph", next: ["/statistik", "/bestenlisten"] },
  "/so-funktionierts": { title: "So funktioniert’s", next: ["/", "/spieler"] },
};

/** Weitere Ziele, die nicht im Rundgang stehen */
const OTHER: Record<string, Step> = {
  "/ereignisse": { href: "/ereignisse", title: "Ereignisse", why: "Die ganze Chronik mit Filtern nach Spieler und Art." },
  "/graph": { href: "/graph", title: "Graph", why: "Jede Kennzahl als eigener Graph, für den Server oder einzelne Spieler." },
  "/live": { href: "/live", title: "Live", why: "Wer gerade streamt und wie viele zuschauen." },
};

/** Passende zweite Karte je Station des Rundgangs */
const RELATED: Record<string, string> = {
  "/": "/zeitstrahl",
  "/spieler": "/bestenlisten",
  "/spielertypen": "/zeitstrahl",
  "/bestenlisten": "/graph",
  "/verbindungen": "/zuschauer",
  "/zuschauer": "/live",
  "/zeitstrahl": "/ereignisse",
};

const target = (href: string): Step =>
  TOUR.find((s) => s.href === href) ?? OTHER[href] ?? { href, title: EXTRA[href]?.title ?? href, why: "" };

export interface NextPlan {
  /** Station im Rundgang (1-basiert), null außerhalb */
  step: number | null;
  primary: Step | null;
  secondary: Step | null;
  /** Letzte Station: Rundgang geschafft */
  done: boolean;
}

export function nextFor(path: string): NextPlan | null {
  const player = /^\/spieler\/([^/]+)(\/rueckblick)?\/?$/.exec(path);
  if (player) {
    const id = player[1];
    const q = `spieler=${id}`;
    const connections: Step = { href: `/verbindungen?${q}`, title: "Verbindungen", why: "Mit wem dieser Spieler am meisten zu tun hatte – Raids, geteilte Chats, Gruppen." };
    if (player[2]) {
      return {
        step: null,
        primary: connections,
        secondary: { href: "/spieler", title: "Nächster Spieler", why: "Zurück zur Liste und den Rückblick eines anderen Spielers ansehen." },
        done: false,
      };
    }
    return {
      step: null,
      primary: { href: `/spieler/${id}/rueckblick`, title: "Staffel-Rückblick", why: "Die ganze Staffel dieses Spielers auf einer Seite, mit Einordnung." },
      secondary: connections,
      done: false,
    };
  }
  const i = TOUR.findIndex((s) => s.href === path);
  if (i >= 0) {
    const last = i === TOUR.length - 1;
    return {
      step: i + 1,
      primary: last ? null : TOUR[i + 1],
      secondary: last ? STEP("/") : RELATED[path] ? target(RELATED[path]) : null,
      done: last,
    };
  }
  const extra = EXTRA[path];
  if (extra) return { step: null, primary: target(extra.next[0]), secondary: target(extra.next[1]), done: false };
  return null;
}
