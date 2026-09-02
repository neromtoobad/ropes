#!/usr/bin/env bash
# Railway boot: the EXECUTOR only.
#
# The web app lives on Vercel and the ledger in Supabase Postgres, so this box
# has exactly one job — run the game loop, supervised, 24/7. No schema push
# (the database is already provisioned), no next start (Vercel serves it).
# Railway sets PORT, which turns on the loop's /health endpoint; railway.json
# points the platform health check at it, so a wedged loop shows as unhealthy.
#
# ONE EXECUTOR AT A TIME. Stop the laptop's before this one goes live — two
# executors on one wallet race the nonce and poison every measured number.
set -e
exec ./run-executor.sh
