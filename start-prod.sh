#!/usr/bin/env bash
# Railway boot: the EXECUTOR only.
#
# The web app lives on Vercel and the ledger in Postgres, so this box has
# exactly one job — run the game loop, supervised, 24/7. No next start (Vercel
# serves it). Railway sets PORT, which turns on the loop's /health endpoint;
# railway.json points the platform health check at it, so a wedged loop shows
# as unhealthy.
#
# ONE EXECUTOR AT A TIME. Stop the laptop's before this one goes live — two
# executors on one wallet race the nonce and poison every measured number.
set -e

# Make sure the schema is there before the loop asks for it.
#
# This used to say "no schema push — the database is already provisioned",
# which was true right up until the database wasn't. The ledger lived on a
# Supabase free-tier project; the free plan allows two active projects, a third
# project was created on 16 sep, and the game's database was paused to make
# room. Every tick then died on
#
#     FATAL: (ENOTFOUND) tenant/user climb.flprhfxryvpe
#
# and the fix — a fresh Postgres — needed a schema that only a laptop could
# push, which was the one thing nobody had. So the box provisions itself now.
#
# `db push` is idempotent: against a database that already matches it prints
# "already in sync" and changes nothing, so this costs a couple of seconds a
# boot and is a no-op every time but the first. It is deliberately NOT fatal —
# the loop's own connection handling gives a better error than a dead container,
# and a push that fails on a database that is actually fine must never be the
# reason the game does not start.
echo "[boot] ensuring schema is present…"
npx prisma db push --skip-generate || echo "[boot] WARNING: schema push failed — continuing; the loop will report the real error"

exec ./run-executor.sh
