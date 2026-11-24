/** Link zum Spielervergleich; ohne `b` öffnet er die Auswahl mit Spieler 1 schon eingetragen */
export const compareHref = (a: string, b?: string) => `/vergleich?a=${encodeURIComponent(a)}${b ? `&b=${encodeURIComponent(b)}` : ""}`;
