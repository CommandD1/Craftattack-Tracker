#!/usr/bin/env bash
# Datenbank-Sicherung (täglich per systemd-Timer actracker-backup.timer, siehe scripts/systemd/).
#
#   bash scripts/backup.sh                 sichern, aufräumen, ggf. auswärts hochladen
#   bash scripts/backup.sh --restore-test  zusätzlich die neue Sicherung testweise wiederherstellen
#                                          (geschieht von selbst am 1. jedes Monats)
#
# 1. pg_dump (komprimiert, ohne die abgeschaltete Schätzung: Schemas approx/approx_fill) nach
#    $BACKUP_DIR/daily/actracker-JJJJ-MM-TT.dump, erst als .tmp, geprüft (Inhaltsverzeichnis lesbar, alle
#    Tabellen enthalten), dann umbenannt. Prüfsumme daneben.
# 2. Aufbewahren: 7 tägliche, 8 wöchentliche (Sonntag), 12 monatliche (1. des Monats); feste Links, kein
#    doppelter Platz.
# 3. Auswärts (wenn ~/.config/actracker/backup.env RESTIC_REPOSITORY setzt): restic sichert die Datei
#    verschlüsselt und ohne Doppeltes, behält 14 Tage / 8 Wochen / 24 Monate, prüft sonntags 5 % der Daten.
# 4. Wiederherstellungstest: leere Postgres-Instanz auf der Platte, pg_restore, Zeilen zählen, wegwerfen.
# Ergebnis in ~/.local/state/actracker-backup.json; scripts/watchdog.mjs meldet, wenn etwas zu alt ist.
#
# Wiederherstellen im Ernstfall: siehe scripts/RESTORE.md.

set -euo pipefail

main() {
  local env_file="${ENV_FILE:-$HOME/.config/actracker/web.env}"
  local backup_env="${BACKUP_ENV:-$HOME/.config/actracker/backup.env}"
  local dir="${BACKUP_DIR:-$HOME/backups/actracker}"
  local state="${BACKUP_STATE:-$HOME/.local/state/actracker-backup.json}"
  local pgbin="${PG_BIN:-/usr/lib/postgresql/18/bin}"
  local restore_test=""
  [[ "${1:-}" == "--restore-test" || "$(date -u +%d)" == "01" ]] && restore_test=1

  local url
  url="$(grep -h '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2- | tr -d "\"'")"
  [[ -n "$url" ]] || { echo "[backup] DATABASE_URL fehlt in $env_file"; exit 1; }
  url="${url%%\?*}?sslmode=prefer"
  # shellcheck disable=SC1090
  [[ -f "$backup_env" ]] && { set -a; . "$backup_env"; set +a; }

  mkdir -p "$dir/daily" "$dir/weekly" "$dir/monthly" "$(dirname "$state")"
  local day file tmp start
  day="$(date -u +%F)"
  file="$dir/daily/actracker-$day.dump"
  tmp="$file.tmp"
  start=$(date +%s)

  # 1. Sichern und prüfen
  rm -f "$tmp"
  nice -n 10 pg_dump "$url" -Fc -Z 6 -N approx_fill -N approx -f "$tmp"
  local tables expected
  tables="$(pg_restore --list "$tmp" | grep -c ' TABLE DATA ')"
  expected="$(psql "$url" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
  if [[ "$tables" -lt "$expected" ]]; then
    echo "[backup] unvollständig: $tables von $expected Tabellen"
    rm -f "$tmp"
    exit 1
  fi
  mv -f "$tmp" "$file"
  (cd "$dir/daily" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  local bytes
  bytes="$(stat -c %s "$file")"
  echo "[backup] $file: $((bytes / 1048576)) MB, $tables Tabellen, $(( $(date +%s) - start )) s"

  # 2. Aufbewahren (feste Links: wöchentliche/monatliche kosten keinen zusätzlichen Platz)
  if [[ "$(date -u +%u)" == "7" ]]; then ln -f "$file" "$file.sha256" "$dir/weekly/"; fi
  if [[ "$(date -u +%d)" == "01" ]]; then ln -f "$file" "$file.sha256" "$dir/monthly/"; fi
  prune "$dir/daily" 7
  prune "$dir/weekly" 8
  prune "$dir/monthly" 12

  # 3. Auswärts
  local offsite="" offsite_error=""
  if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
    local restic="${RESTIC_BIN:-$HOME/.local/bin/restic}"
    if out="$("$restic" backup --quiet --host actracker --tag actracker "$file" 2>&1)" &&
      out="$("$restic" forget --quiet --host actracker --keep-daily 14 --keep-weekly 8 --keep-monthly 24 --prune 2>&1)"; then
      offsite="$(date -u +%FT%TZ)"
      echo "[backup] auswärts gesichert ($RESTIC_REPOSITORY)"
      if [[ "$(date -u +%u)" == "7" ]]; then
        "$restic" check --read-data-subset=5% > /dev/null 2>&1 || { offsite=""; offsite_error="restic check fehlgeschlagen"; }
      fi
    else
      offsite_error="$(echo "$out" | tail -1)"
      echo "[backup] auswärts fehlgeschlagen: $offsite_error"
    fi
  fi

  # 4. Wiederherstellungstest
  local restored=""
  if [[ -n "$restore_test" ]]; then
    local t="$dir/.restore-test"
    rm -rf "$t"
    mkdir -p "$t"
    "$pgbin/initdb" -U postgres --auth=trust -D "$t/pg" > /dev/null
    "$pgbin/pg_ctl" -D "$t/pg" -o "-p 55439 -k $t -c listen_addresses='' -c shared_buffers=64MB -c maintenance_work_mem=64MB -c fsync=off" -l "$t/pg.log" -w start > /dev/null
    local ok=""
    if createdb -h "$t" -p 55439 -U postgres r && nice -n 10 pg_restore -h "$t" -p 55439 -U postgres -d r --no-owner --no-acl "$file"; then
      local got want
      got="$(psql -h "$t" -p 55439 -U postgres r -Atc "SELECT count(*) FROM player_history")"
      want="$(psql "$url" -Atc "SELECT count(*) FROM public.player_history WHERE at < '$day'::date + 1")"
      # Die Sicherung ist etwas älter als die Zählung jetzt
      if [[ "$got" -gt 0 && $((got * 100)) -ge $((want * 99)) ]]; then ok=1; fi
      echo "[backup] Wiederherstellungstest: player_history $got (live $want)"
    fi
    "$pgbin/pg_ctl" -D "$t/pg" -m fast stop > /dev/null || true
    rm -rf "$t"
    if [[ -n "$ok" ]]; then restored="$(date -u +%FT%TZ)"; else echo "[backup] Wiederherstellungstest fehlgeschlagen"; fi
  fi

  # Zustand für den Wächter (vorherige Werte behalten, wenn dieser Lauf etwas nicht gemacht hat)
  "${NODE:-$HOME/.local/node/bin/node}" -e '
    const fs = require("fs");
    const [path, file, bytes, offsite, offsiteError, restored, configured, tried] = process.argv.slice(1);
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
    s.lastOk = new Date().toISOString();
    s.file = file;
    s.bytes = Number(bytes);
    s.offsiteConfigured = configured === "1";
    if (offsite) { s.offsite = offsite; delete s.offsiteError; }
    if (offsiteError) s.offsiteError = offsiteError;
    if (restored) s.restoreTest = restored;
    if (tried && !restored) s.restoreError = new Date().toISOString();
    else if (restored) delete s.restoreError;
    fs.writeFileSync(path, JSON.stringify(s));
  ' "$state" "$file" "$bytes" "$offsite" "$offsite_error" "$restored" "$([[ -n "${RESTIC_REPOSITORY:-}" ]] && echo 1 || echo 0)" "$restore_test"
  [[ -z "$offsite_error" ]] || exit 2
  [[ -z "$restore_test" || -n "$restored" ]] || exit 3
}

# Nur die neuesten $2 Sicherungen in $1 behalten
prune() {
  local n=0 f
  while IFS= read -r f; do
    n=$((n + 1))
    if [[ $n -gt $2 ]]; then rm -f -- "$f" "$f.sha256"; fi
  done < <(find "$1" -maxdepth 1 -name 'actracker-*.dump' -printf '%f\n' | sort -r | sed "s|^|$1/|")
}

main "$@"
