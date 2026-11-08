# Datenbank wiederherstellen

Sicherungen macht `scripts/backup.sh` täglich (Timer `actracker-backup.timer`):

- auf dem Server: `~/backups/actracker/{daily,weekly,monthly}/actracker-JJJJ-MM-TT.dump` (7 / 8 / 12 Stück)
- auswärts (wenn eingerichtet): restic-Repository aus `~/.config/actracker/backup.env`
- Zustand: `~/.local/state/actracker-backup.json`; der Wächter meldet, wenn eine Sicherung älter als 30 Std ist

## 1. Sicherung holen

Vom Server: neueste Datei in `~/backups/actracker/daily/`, Prüfsumme kontrollieren:

    cd ~/backups/actracker/daily && sha256sum -c actracker-JJJJ-MM-TT.dump.sha256

Von auswärts (Server weg): restic installieren, `backup.env` (Repository, Passwort, Zugangsdaten) wiederherstellen –
**Passwort und Zugangsdaten müssen außerhalb des Servers aufbewahrt sein** (Passwortmanager) –, dann:

    set -a; . backup.env; set +a
    restic snapshots --tag actracker
    restic restore latest --tag actracker --target ./restore

## 2. Einspielen

Dienste anhalten, damit niemand schreibt:

    systemctl --user stop actracker-tracker actracker-vodchat actracker-vodbackfill

In eine **leere** Datenbank (neu angelegt, Besitzer = Benutzer aus DATABASE_URL):

    pg_restore -d "$DATABASE_URL" --no-owner --no-acl -j 2 actracker-JJJJ-MM-TT.dump

Danach Dienste starten und `/api/tracker` auf 127.0.0.1:3020 prüfen. Die abgeschaltete Schätzung (Schemas
`approx`, `approx_fill`) ist nicht in den Sicherungen.

## Test

`bash scripts/backup.sh --restore-test` spielt die neue Sicherung in eine leere, vorübergehende Postgres-Instanz
ein und vergleicht die Zeilen (läuft automatisch am 1. jedes Monats).
