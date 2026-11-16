#!/usr/bin/env bash
# Automatisches Ausrollen: Neue Commits auf main (CommandD1/Craftattack-Tracker) → scripts/deploy.sh im Live-Klon.
# Läuft per Timer jede Minute (scripts/systemd/actracker-autodeploy.*). Meldet Erfolg/Fehler per ntfy (NTFY_URL).
# Ein fehlgeschlagener Stand wird nicht erneut versucht, erst der nächste Push.
set -uo pipefail

# Alles in main(): deploy.sh macht `git pull`, das dieses Skript während des Laufs ändern kann
main() {
LIVE="${ACTRACKER_LIVE:-$HOME/actracker-live}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/actracker"
mkdir -p "$STATE"
cd "$LIVE"
exec 9>"$STATE/autodeploy.lock"
flock -n 9 || exit 0

git fetch -q origin main || { echo "[autodeploy] fetch fehlgeschlagen"; exit 0; }
remote="$(git rev-parse origin/main)"
[[ "$remote" == "$(git rev-parse HEAD)" ]] && exit 0
git merge-base --is-ancestor HEAD origin/main || exit 0   # lokal neuer → nichts tun
[[ "$(cat "$STATE/autodeploy.failed" 2>/dev/null)" == "$remote" ]] && exit 0

notify() {
  [[ -n "${NTFY_URL:-}" ]] && curl -s -o /dev/null --max-time 10 -H "Title: Tracker-Deploy" -d "$1" "$NTFY_URL" || true
}
msg="$(git log -1 --format='%h %an: %s' origin/main)"
echo "[autodeploy] neuer Stand $msg"
# Dienste, die während des Builds pausieren, weil der Speicher knapp ist (Leerzeichen-getrennt, in der Unit gesetzt,
# z. B. Environment=AUTODEPLOY_PAUSE_UNITS=mein-dienst); sie starten nach dem Deploy wieder, auch wenn er scheitert
paused=()
for u in ${AUTODEPLOY_PAUSE_UNITS:-}; do
  if systemctl --user is-active --quiet "$u" && systemctl --user stop "$u"; then paused+=("$u"); echo "[autodeploy] $u pausiert"; fi
done
resume() { for u in "${paused[@]}"; do systemctl --user start "$u" && echo "[autodeploy] $u läuft wieder"; done; paused=(); }
trap resume EXIT
if bash scripts/deploy.sh; then
  rm -f "$STATE/autodeploy.failed"
  echo "[autodeploy] live: $msg"
  notify "Live: $msg"
  resume
else
  echo "$remote" > "$STATE/autodeploy.failed"
  echo "[autodeploy] FEHLGESCHLAGEN, alte Version läuft weiter: $msg"
  notify "Deploy fehlgeschlagen, alte Version läuft weiter: $msg"
  resume
fi
exit 0
}
main "$@"
