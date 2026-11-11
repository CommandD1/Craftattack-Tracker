# Cookies und Speicher im Browser

Grundlage für den Abschnitt „Cookies und lokale Speicherung“ der Datenschutzerklärung von
https://craftattack.hiorcraft.tv. Stand: 10.11.2026, geprüft am Code (`main` sowie die offenen PRs #130 und #131)
und an den Antworten der Live-Seite.

## Kurzfassung

- **Die Seite selbst setzt keine Cookies.** Weder der Code noch der Server (Next.js, `scripts/cached-server.mjs`)
  senden `Set-Cookie`; am 10.11.2026 lieferte keine Seite der Live-Website ein Cookie aus.
- Einige **Einstellungen werden im Browser gespeichert** (`localStorage` / `sessionStorage`). Sie verlassen das Gerät
  nie, werden nicht an den Server übertragen und dienen nur der Bedienung (technisch notwendig bzw. vom Nutzer
  ausdrücklich gewünscht, § 25 Abs. 2 Nr. 2 TDDDG). Eine Einwilligung ist dafür nicht nötig.
- **Cookies Dritter** gibt es nur nach Einwilligung: Der Twitch-Player wird erst nach Klick geladen (Zwei-Klick-Lösung);
  dann kann Twitch eigene Cookies setzen.
- Cloudflare (CDN und Schutzdienst vor der Seite) kann in Sonderfällen eigene, technisch notwendige Cookies setzen.
- Kein Tracking, keine Analyse- oder Werbe-Cookies, keine eingebundenen Schriften oder Skripte von Dritten.

## 1. Speicher im Browser (eigene Seite)

Alle Einträge liegen nur im Browser des Besuchers, unter der Adresse der Seite. Löschen: Website-Daten im Browser
löschen; `sessionStorage` verschwindet mit dem Schließen des Tabs.

| Schlüssel | Speicher | Inhalt | Zweck | Dauer | Seit |
| --- | --- | --- | --- | --- | --- |
| `ac-theme` | localStorage | `light` oder `dark` | Gewähltes Farbschema (Umschalter oben rechts) | bis zum Löschen | live |
| `ac-twitch-consent` | localStorage | `1` | Merkt die Einwilligung, nur wenn der Haken „Twitch künftig immer laden“ gesetzt wird; „Zustimmung widerrufen“ löscht ihn | bis zum Widerruf oder Löschen | live |
| `ac.fold.v1` | localStorage | Kennungen der eingeklappten Abschnitte | Ausgeblendete Abschnitte bleiben ausgeblendet | bis zum Löschen | live |
| `ac.verbindungen.v2` | localStorage | Einstellungen der Seite „Verbindungen“ (Gewichtung, Filter, Gruppenzahl, Ansicht) | Einstellungen bleiben erhalten | bis zum Löschen | live |
| `ac.verbindungen.offen` | localStorage | Welche Einstellungsbereiche auf „Verbindungen“ aufgeklappt sind | Bedienung | bis zum Löschen | live |
| `ac.scroll.v1` | sessionStorage | Pfad und Scroll-Position | Beim automatischen Aktualisieren (höchstens einmal pro Minute) bleibt die Position erhalten; wird danach sofort gelöscht | Sekunden | live |
| `ac.adv.tab` | sessionStorage | Gewählter Reiter der Fortschritte im Spielerprofil | Bedienung | bis der Tab geschlossen wird | live |
| `ca:besuch` | localStorage | Zwei Zeitpunkte: Ende des vorigen Besuchs, zuletzt aktiv | „Neu seit deinem letzten Besuch“: Zahl an „Verlauf“, Linie im Feed, „Neu für dich“ im Changelog; „Alles gesehen“ setzt ihn neu | bis zum Löschen | PR #130 (noch nicht live) |

Hinweise zu `ca:besuch`: Es werden nur Uhrzeiten gespeichert, keine Kennung, keine besuchten Seiten. Die Zahl neuer
Ereignisse holt der Browser aus `/api/neu`; diese Antwort ist für alle Besucher gleich, die Uhrzeit des letzten
Besuchs wird nicht mitgeschickt.

## 2. Twitch (nur nach Einwilligung)

Auf Spieler-Seiten können Stream und Chat eingebettet werden (`components/TwitchGate.tsx`, `TwitchEmbed.tsx`).
Bis zum Klick auf „Stream und Chat laden“ wird **nichts** von Twitch geladen, auch kein Vorschaubild. Danach laden Iframes von
`player.twitch.tv` und `www.twitch.tv/embed/…/chat`; Twitch Interactive, Inc. (USA, Amazon) erhält dabei die
IP-Adresse und kann eigene Cookies und Speicher setzen (z. B. Geräte- und Sitzungskennungen, Spracheinstellungen,
ggf. Anmeldung). Art, Zweck und Dauer bestimmt Twitch: https://www.twitch.tv/p/legal/cookie-policy/

Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Optional gemerkt in
`ac-twitch-consent` (siehe oben), jederzeit widerrufbar über „Zustimmung widerrufen“ unter dem Player.

## 3. Cloudflare

Die Seite läuft über Cloudflare (CDN, Schutz vor Angriffen). Bei normalen Aufrufen setzt Cloudflare derzeit **keine**
Cookies (geprüft am 10.11.2026). In Sonderfällen kann Cloudflare technisch notwendige Cookies setzen, z. B.:

| Cookie | Wann | Zweck | Dauer |
| --- | --- | --- | --- |
| `__cf_bm` | wenn Bot-Schutz aktiv wird | Unterscheidet Menschen von Bots | 30 Minuten |
| `cf_clearance` | nach einer bestandenen Sicherheitsabfrage | Merkt, dass die Abfrage bestanden wurde | bis zu 1 Jahr, je nach Einstellung |

Rechtsgrundlage: berechtigtes Interesse an Sicherheit und Erreichbarkeit (Art. 6 Abs. 1 lit. f DSGVO); unbedingt
erforderlich im Sinne von § 25 Abs. 2 Nr. 2 TDDDG. Übersicht: https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/

## 4. Weitere Verbindungen zu Dritten (keine Cookies, aber für die Datenschutzerklärung relevant)

- **Clip-Vorschaubilder** (Startseite „Top-Clips“, Spielerseite, Staffel-Rückblick) laden über den eigenen Server
  (`/api/clip-thumb/<id>`), der sie bei `static-cdn.jtvnw.net` holt. Der Browser verbindet sich dabei nicht mit Twitch.
- **Spielerköpfe und Skins** laden über den eigenen Server (`/api/head`, `/api/skin`), der sie bei craftattack.one,
  mc-heads.net oder minotar.net holt. Der Browser des Besuchers verbindet sich dabei nicht mit diesen Diensten.
- **Schriften** liegen auf dem eigenen Server (`public/fonts`), keine Google Fonts.
- **Links** zu Twitch, GitHub, craftattack.one usw. sind normale Links; erst ein Klick verbindet mit dem Dienst.
- **Server-Protokolle:** Die Anwendung selbst protokolliert keine IP-Adressen von Besuchern. Cloudflare verarbeitet
  Verbindungsdaten (u. a. IP-Adresse) als Auftragsverarbeiter.

## Pflege

Wer neuen Browser-Speicher, Cookies oder Inhalte von Dritten einbaut, ergänzt diese Datei im selben Pull Request.
Prüfen mit:

```bash
git grep -n -E 'document\.cookie|cookies\(\)|[sS]et-[cC]ookie|localStorage|sessionStorage|indexedDB' -- ':!*.md'
curl -s -D - -o /dev/null https://craftattack.hiorcraft.tv/ | grep -i set-cookie
```

> Keine Rechtsberatung. Die Datei beschreibt, was die Seite technisch tut; die Formulierung in der
> Datenschutzerklärung sollte entsprechend geprüft werden.
