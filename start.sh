#!/usr/bin/env bash
# VIBE SAMURAI starten (Linux / macOS): lokaler Webserver + Browser.
# ES-Module brauchen http://, nicht file://. Nimmt, was da ist: python3, python, node, php oder ruby.
#   PORT=9000 bash start.sh      anderer Port
#   NO_BROWSER=1 bash start.sh   nur den Server starten
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8765}"

open_browser() {
  [ -n "$NO_BROWSER" ] && return
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$1"
  else echo "Bitte im Browser öffnen: $1"
  fi
}

# Lauscht schon jemand auf diesem Port?
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# ... und ist es dieses Spiel?
is_game() { command -v curl >/dev/null 2>&1 && curl -s -m 2 "http://127.0.0.1:$1/" 2>/dev/null | grep -q 'VIBE SAMURAI'; }

if port_busy "$PORT"; then
  if is_game "$PORT"; then
    # Das Spiel läuft schon (z. B. in einem anderen Terminal-Fenster): einfach nur öffnen.
    echo "VIBE SAMURAI läuft bereits auf http://localhost:$PORT/ – öffne den Browser."
    open_browser "http://localhost:$PORT/"
    exit 0
  fi
  # Ein anderes Programm belegt den Port: den nächsten freien nehmen.
  FIRST="$PORT"
  while port_busy "$PORT"; do
    PORT=$((PORT + 1))
    if [ "$PORT" -gt $((FIRST + 20)) ]; then echo "Kein freier Port zwischen $FIRST und $PORT gefunden."; exit 1; fi
  done
  echo "Port $FIRST ist von einem anderen Programm belegt – nehme $PORT."
fi

URL="http://localhost:$PORT/"
echo "VIBE SAMURAI läuft auf $URL  –  Beenden mit Strg+C"
(sleep 1; open_browser "$URL") &

# Python liefert von Haus aus ohne Cache-Angabe aus: der Browser mischt dann nach einem Update alte und neue
# Dateien. Darum ein Server, der das Zwischenspeichern verbietet.
PYSERVE='import sys, http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()'
if command -v python3 >/dev/null 2>&1; then exec python3 -c "$PYSERVE" "$PORT"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(sys.version_info[0] < 3)'; then exec python -c "$PYSERVE" "$PORT"
elif command -v node >/dev/null 2>&1; then exec node tools/serve.mjs "$PORT"
elif command -v php >/dev/null 2>&1; then exec php -S "127.0.0.1:$PORT"
elif command -v ruby >/dev/null 2>&1; then exec ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  echo "Kein Python, Node, PHP oder Ruby gefunden. Installiere z. B. python3 und starte erneut."
  exit 1
fi
