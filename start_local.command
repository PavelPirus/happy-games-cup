#!/bin/bash
set -u
cd "$(dirname "$0")"
BUILD_VERSION="0.7.2.1"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js 18+ is required."
  echo "Install it from https://nodejs.org/ and run this file again."
  echo
  read -r -p "Press Enter to close..." _
  exit 1
fi
START_PORT=${PORT:-8787}
PORT="$START_PORT"
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt $((START_PORT + 30)) ]; then
    echo "Could not find a free local port."
    read -r -p "Press Enter to close..." _
    exit 1
  fi
done
export PORT
echo
echo "=============================================="
echo " HAPPY GAMES CUP - LOCAL v${BUILD_VERSION}"
echo "=============================================="
echo
echo "Starting on http://localhost:${PORT}/"
echo "Keep this Terminal window open while you play."
echo "Press Control+C when finished."
echo
(sleep 0.8; open "http://localhost:${PORT}/") >/dev/null 2>&1 &
exec node server.js
