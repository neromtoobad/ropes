#!/usr/bin/env bash
# Production boot (Railway): ONE box runs the whole game. The web app and the
# supervised executor share the volume-backed SQLite — the ledger's design has
# a single machine writing it, so they must never be split across hosts.
# (And never run a second executor anywhere against the same wallet — the SDK
# owns the nonce, and cost/proceeds are measured off wallet-balance deltas.)
set -e
npx prisma db push --skip-generate    # create/upgrade the schema on the volume
./run-executor.sh &
exec npx next start -p "${PORT:-3000}"
