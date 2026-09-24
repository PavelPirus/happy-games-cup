#!/bin/bash
set -e
TS=""
if command -v tailscale >/dev/null 2>&1; then
  TS="$(command -v tailscale)"
elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
elif [ -x "$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS="$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi

if [ -z "$TS" ]; then
  echo "Tailscale was not found."
  read -r -p "Press Enter to close..."
  exit 1
fi

"$TS" funnel reset || true
echo
echo "Tailscale Funnel configuration was reset."
read -r -p "Press Enter to close..."
