#!/usr/bin/env bash
# Keep the executor alive. It exits(1) when its WebSocket stops recovering,
# which is the only way to get a fresh SDK client — the SDK does not reconnect.
while true; do
  npx tsx src/executor/index.ts
  echo "[supervisor] executor exited ($?), restarting in 3s"
  sleep 3
done
