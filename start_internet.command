#!/bin/bash
set -u
cd "$(dirname "$0")"

BUILD_VERSION="0.7.3"
START_PORT=${PORT:-8787}
PORT="$START_PORT"
SERVER_PID=""
TS=""

pause_close() {
  echo
  read -r -p "Press Enter to close..." _
}

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found."
  echo "Install Node.js 18 or newer, then run this file again."
  echo "https://nodejs.org/"
  pause_close
  exit 1
fi

if command -v tailscale >/dev/null 2>&1; then
  TS="$(command -v tailscale)"
elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
elif [ -x "$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS="$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi

if [ -z "$TS" ]; then
  echo
  echo "Tailscale was not found."
  echo "Install Tailscale, sign in once, then run this file again."
  echo "https://tailscale.com/download/mac"
  pause_close
  exit 1
fi

# Do not accidentally connect Funnel to some old app already using our port.
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt $((START_PORT + 30)) ]; then
    echo "Could not find a free local port."
    pause_close
    exit 1
  fi
done

export PORT

echo
echo "=============================================="
echo " HAPPY GAMES CUP - INTERNET TEST v${BUILD_VERSION}"
echo "=============================================="
echo
echo "1) Clearing any stale Funnel route..."
"$TS" funnel reset >/dev/null 2>&1 || true

echo "2) Starting THIS game build on local port ${PORT}..."
: > happy_games_server.log
node server.js >> happy_games_server.log 2>&1 &
SERVER_PID=$!

READY=0
for i in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    break
  fi
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -q '"ok":true' && printf '%s' "$HEALTH" | grep -q '"version":"0.7.3"'; then
    READY=1
    break
  fi
  sleep 0.2
done

if [ "$READY" -ne 1 ]; then
  echo
echo "ERROR: Happy Games Cup v${BUILD_VERSION} did not start correctly."
echo "Nothing has been published to the internet."
echo
echo "Last server log:"
tail -n 30 happy_games_server.log 2>/dev/null || true
  pause_close
  exit 1
fi

(sleep 0.5; open "http://localhost:${PORT}/") >/dev/null 2>&1 &

echo "   OK - verified build v${BUILD_VERSION}"
echo "   Local game: http://localhost:${PORT}/"
echo
echo "3) Starting PUBLIC Tailscale Funnel..."
echo
echo "Send the HTTPS .ts.net address printed below to Irina and Yulia."
echo "All three players use ROOM: HAPPY"
echo
echo "Keep this Terminal window open while you play."
echo "Press Control+C when finished."
echo
echo "----------------------------------------------"

"$TS" funnel "$PORT"
