#!/usr/bin/env bash
# Keep the executor alive.
#
# It exits(1) when its WebSocket stops recovering or when a tick wedges — the
# only cure for either is a fresh process with a fresh client, so dying loudly
# and being restarted here IS the recovery path.
#
# Two things this wrapper adds beyond a bare loop:
#
#   caffeinate  the game stops dead when the machine sleeps. While this script
#               runs the Mac stays awake (-i idle, -m disk, -s system). Nothing
#               keeps the DISPLAY on, so the screen still dims.
#
#   backoff     restarting instantly during an outage is worse than waiting:
#               every restart opens a fresh database connection, and a storm of
#               them is exactly what gets a pooler to start refusing us. Back
#               off to 30s while it keeps failing, and reset once it survives.
set -u

delay=3
while true; do
  started=$(date +%s)

  if command -v caffeinate >/dev/null 2>&1; then
    caffeinate -ims npx tsx src/executor/index.ts
  else
    npx tsx src/executor/index.ts
  fi
  code=$?

  ran=$(( $(date +%s) - started ))
  # A process that stayed up a while hit a fresh problem — treat it as the
  # first failure, not a continuation of the last one.
  if [ "$ran" -ge 120 ]; then
    delay=3
  else
    delay=$(( delay * 2 ))
    [ "$delay" -gt 30 ] && delay=30
  fi

  echo "[supervisor] executor exited ($code) after ${ran}s, restarting in ${delay}s"
  sleep "$delay"
done
