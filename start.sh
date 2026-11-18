#!/usr/bin/env bash
# VIBE SAMURAI starten (Linux / macOS): lokaler Webserver + Browser.
# ES-Module brauchen http://, nicht file://. Nimmt, was da ist: python3, python, node, php oder ruby.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8765}"
URL="http://localhost:$PORT/"

open_browser() {
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL"
  else echo "Bitte im Browser öffnen: $URL"
  fi
}

echo "VIBE SAMURAI läuft auf $URL  –  Beenden mit Strg+C"
open_browser &

if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(sys.version_info[0] < 3)'; then exec python -m http.server "$PORT" --bind 127.0.0.1
elif command -v node >/dev/null 2>&1; then exec node tools/serve.mjs "$PORT"
elif command -v php >/dev/null 2>&1; then exec php -S "127.0.0.1:$PORT"
elif command -v ruby >/dev/null 2>&1; then exec ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  echo "Kein Python, Node, PHP oder Ruby gefunden. Installiere z. B. python3 und starte erneut."
  exit 1
fi
