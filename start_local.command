#!/bin/bash
set -u
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org/"
  read -r -p "Press Enter to close..." _
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Installing the small WebSocket dependency..."
  npm install --no-audit --no-fund || exit 1
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
echo "Starting Happy Games Cup v0.7.0 locally on port ${PORT}..."
(sleep 0.8; open "http://localhost:${PORT}/") >/dev/null 2>&1 &
exec node server.js
