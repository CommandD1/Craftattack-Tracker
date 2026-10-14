# CraftAttack 14 Tracker

Live unter **https://craftattack.hiorcraft.tv**

> **Hinweis:** Dieses Repo ist der Quellcode des Trackers, der auf craftattack.hiorcraft.tv läuft.
> Es ist nicht als Self-Hosting-Paket gedacht und es gibt dafür keinen Support. Nutz einfach die Live-Seite.
> Für neue Features, Bugfixes oder Ideen sind Pull Requests und Issues aber sehr willkommen.

## Mitmachen

1. Repo forken und klonen, `npm install`
2. `DATABASE_URL` in `.env.local` setzen, dann startet `npm run dev` lokal auf http://localhost:3000.
3. Änderung machen, `npm run lint` und `npx tsc --noEmit` müssen sauber sein.
4. Pull Request gegen `main` mit kurzer Beschreibung, was und warum.

Ideen, die noch offen sind: Twitch-API-Anbindung (Clips, Kategorie), Discord-Benachrichtigungen bei Highlights, Tages- und Wochenstatistiken, Vergleich zweier Spieler.

Inoffizieller Tracker für CraftAttack 14. Fragt `https://craftattack.one/api/stats` standardmäßig in zufälligen Abständen
von 45 bis 75 Sekunden ab (Mittelwert: eine Minute).
Einzelstatistiken (`/api/ext/<id>`) werden höchstens zehn pro Poll und mit mindestens einer Sekunde Abstand angefragt;
erfolgreiche Antworten werden 15 Minuten wiederverwendet. Bei Cloudflare-Challenges, HTTP 403/429 oder Cloudflare-5xx-
Antworten pausiert der Tracker Anfragen an den betroffenen Origin mindestens fünf Minuten. Wiederholte Sperren
verlängern die Pause exponentiell bis höchstens sechs Stunden; `Retry-After` wird zusätzlich als Mindestwartezeit
beachtet. Während der Pause werden keine automatischen Probe-Anfragen gesendet, danach wird automatisch vorsichtig
fortgesetzt. Nach 24 Stunden ohne erneute Sperre beginnt die Eskalation wieder bei fünf Minuten. Bild-Proxys liefern
während einer solchen Pause ebenfalls `503` mit `Retry-After`, statt auf eine alternative Quelle auszuweichen.
Diese Rücksichtnahme kann eine Sperre nicht garantieren zu verhindern; beachte die Nutzungsbedingungen und wende
dich bei einer Sperre an den Betreiber, statt Schutzmaßnahmen zu umgehen.
Der Tracker vergleicht den Stand mit dem vorherigen und schreibt jede Änderung als Ereignis mit Zeitstempel auf.

## Starten

```bash
npm install
npm run dev      # http://localhost:3000
```

Der Poller startet automatisch mit dem Server (`instrumentation.ts`).

## Render (512 MB)

`render.yaml` richtet einen Render-Starter-Web-Service ein. Der Produktionsserver
begrenzt V8s Heap auf 320 MB; Next.js hält höchstens 16 MB Cache im Speicher und
verwendet beim Build einen Worker. Die verbleibende Speichermarge ist für Node.js,
native Module und den Tracker vorgesehen.

Beim Erstellen des Blueprints die abgefragten Variablen eintragen:
`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` sowie
`AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` und
`AWS_SECRET_ACCESS_KEY` für private Datei-Uploads. Twitch-Zugangsdaten sind
optional und können nach dem Erstellen im Render-Dashboard gesetzt werden.

## Datenbank (PostgreSQL)

- `DATABASE_URL` muss gesetzt sein (siehe `.env.example`), damit die App auf PostgreSQL über `pg` zugreift. Tabellen werden beim Start angelegt.
- Mit Neon werden Auth- und Object-Storage-Umgebungsvariablen über `neon env pull` bereitgestellt; `NEON_AUTH_COOKIE_SECRET` muss lokal einmalig mit `openssl rand -base64 32` erzeugt werden.
- `/konto` bietet Neon-Managed-Auth (E-Mail/Passwort) und private persönliche Datei-Uploads. Dateien bis 10 MiB werden im privaten Neon-Bucket `assets` gespeichert; Metadaten und Besitzer-ID liegen in PostgreSQL. Die API prüft den angemeldeten Besitzer bei jedem Aufruf.

Tabellen: `tracker_meta` (Status, Rekorde, letzter API-Snapshot), `players`, `events` (Chronik), `history` (Zeitreihe gesamt, einschließlich Spielerzahl), `player_history` (Spielerwerte, Follower-Gesamtstand, Rang-Snapshot und Twitch-Kategorie je Messpunkt) und `user_files` (Metadaten privater Uploads). Neue Verlaufsfelder werden mit additiven `IF NOT EXISTS`-Spalten ergänzt; bestehende Daten bleiben erhalten.

Die Tracker-Datenseiten werden serverseitig gerendert (SSR, `instant = false`), ohne Lade-Skeleton. Das Konto ergänzt die Oberfläche clientseitig um Anmeldung und Dateiaktionen.

## Was erfasst wird

| Ereignis | Quelle | Wo |
| --- | --- | --- |
| Join / Leave (inkl. Session-Dauer) | `online[]` | Server |
| Tod, Diamanten, Blöcke, Mobs, Strecke | Anstieg in `/api/ext/<id>` bzw. den Top-10-Boards | Server |
| Tode, die keinem bekannten Spieler zuzuordnen sind | `totals.deaths` | Server (ohne Spieler) |
| Stream an / aus / Titel geändert, Peak-Zuschauer | `live[]` | Twitch |
| Twitch-Abos (inkl. Resubs und Geschenk-Abos; normale Summen ab 10 Subs, Geschenke von bekannten Streamern im Feed je Geber und Minute zusammengefasst; nur wenn der Kanal-Streamer auf dem Spielserver online ist) | Twitch IRC `USERNOTICE` | Twitch |
| Raids zwischen bekannten Spielern (mit Zuschauerzahl, falls Twitch sie mitsendet) | Twitch IRC `USERNOTICE` | Twitch |
| Twitch-Subs gesamt, Tagesverlauf und aktuelle Streamsumme | gespeicherte IRC-Abo-Ereignisse | Twitch |
| Follower-Zuwachs während des Serveraufenthalts und Verlauf | Differenz öffentlicher Twitch-GQL-Followerstände zwischen Messungen, bei denen der Spieler online ist | Twitch + Server |
| Follower-Schub (mehr als 20 neue Follower pro Minute auf dem Server) | Differenz der Twitch-GQL-Follower-Messungen während aufeinanderfolgender Server-Messungen | Twitch + Server |
| Server online / offline | `serverOnline` | Server |
| Erster Auftritt eines Spielers (seit Tracker-Start) | `online[]` | Server |
| Rang-Aufstieg in die Top 3 einer Bestenliste | Boards | Server |
| Meilensteine (z. B. 24 h Spielzeit, 1.000 Diamanten, 10. Tod) | Boards | Server |
| Rekorde: meiste gleichzeitig online / live / Zuschauer | Snapshot | Server |
| Pro Spieler: Zeitreihe aller Werte, Follower-Gesamtstand, Rang-Snapshot und Twitch-Kategorie, längste Session, Online-Zeit | abgeleitet | – |

Koordinaten liefert die API nicht. „Wo“ bedeutet daher: auf dem Server oder auf Twitch.

## Seiten

- `/` Übersicht im Look der offiziellen Stats-Seite plus Ereignis-Feed und Verlaufskurven
- `/ereignisse` komplette Chronik mit Filtern (Kategorie, Ort, Spieler) und Seiten
- `/spieler` und `/spieler/<id>` alle erfassten Spieler mit Verlauf, Sessions, Graphen und bei Live-Streamern Twitch-Player plus Chat
- `/events` offizielle Termine von craftattack.one (stündlich abgeglichen)
- `/live` Twitch-Übersicht, Zuschauerkurve und Stream-Chronik
- `/bestenlisten?liste=twitchSubs` Twitch-Abo-Bestenliste; Profile zeigen Gesamtzahl, Tagesgraph und – wenn live – Subs im aktuellen Stream
- `/bestenlisten?liste=followers` Bestenliste des Follower-Zuwachses während der Serverzeit; Profile und eigener Graph zeigen den erfassten Verlauf, keine globalen Twitch-Gesamtstände
- `/konto` Registrierung, Anmeldung und private Datei-Uploads/Downloads
- `/api/tracker?limit=200&player=<id>&type=<typ>` JSON-Export, `/api/tracker/poll` löst eine Abfrage manuell aus

## Konfiguration

- `DATABASE_URL` PostgreSQL-Verbindung, z. B. `postgres://user:pass@localhost:5432/actracker`
- `CA_STATS_URL` andere API-Adresse
- `NEON_AUTH_BASE_URL` Neon Managed Auth URL; `NEON_AUTH_COOKIE_SECRET` lokales Next.js-Cookie-Secret (mindestens 32 Zeichen).
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` und `AWS_REGION` für den privaten Neon-Object-Storage-Bucket `assets`.
- `CA_EXT_URL` Basis-Adresse der Einzelstatistik (Standard `https://craftattack.one/api/ext`)
- `CA_POLL_INTERVAL_MS` mittleres Abfrageintervall in Millisekunden (Standard 60000, mit ±25 % Jitter; nicht unter die Vorgaben des API-Betreibers setzen)
- `CA_AFK_MINUTES` Minuten ohne Streckenzuwachs, bevor ein Online-Spieler als AFK gilt (Standard 20); historische AFK-Zeiten und Ereignisse werden beim Start neu bewertet.
- `TWITCH_IRC_NICK` und `TWITCH_IRC_TOKEN` optional für Twitch-IRC mit `chat:read`; alle bekannten Kanäle werden mit höchstens 20 JOINs in 10 Sekunden (einer alle 500 ms) abonniert. Erfasst werden bekannte Sub-`USERNOTICE`s sowie Raids, wenn sowohl der raidende Spieler als auch der Zielkanal einem Spieler zugeordnet sind.
- Twitch-Subzahlen werden ab Beginn der IRC-Erfassung gezählt und nur erfasst, wenn der Kanal-Streamer bei Eingang der Meldung auf dem Spielserver online ist (AFK zählt als online). Geschenk-USERNOTICEs von bekannten Spielern an einen anderen Streamer werden im Feed pro Geber, Stream und Minute mit Geberbild und aufsummierter Anzahl angezeigt; die einzelnen IRC-Meldungen bleiben für die Statistiken gespeichert. Bereits gespeicherte Minutensummen lassen sich mangels Geberdaten nicht rückwirkend solchen Gebern zuordnen.
- `NEXT_PUBLIC_TWITCH_URL`, `NEXT_PUBLIC_DISCORD_URL`, `NEXT_PUBLIC_GITHUB_URL` optionale Footer-Links (werden beim Build eingebettet)
