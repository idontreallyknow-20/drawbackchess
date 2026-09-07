#!/bin/sh
# Keep `next dev` alive.
#
#   scripts/dev-supervisor.sh [logfile]
#
# WHY THIS EXISTS
#
# `next dev` died twice during one long working session, in two different ways,
# and both times the failure was invisible to whatever was using it:
#
#   1. A LEAK. After about seven hours of HMR and route compiles the dev server
#      held 9.1 GB resident, 57% of a 16 GB box, and took everything else with
#      it. Killing it took available memory from 1.1 GB to 12.9 GB in three
#      seconds, before anything else was touched.
#   2. A TURBOPACK PANIC: "an internal panic occurred outside the per-task panic
#      boundary" out of turbo-tasks-backend/.../operation/mod.rs, which aborts
#      the process outright.
#
# Either way the port goes dead and a browser test reads it as a broken page
# rather than a missing server, which is a bad hour to spend. So: poll, and
# bring it back.
#
# Two checks ten seconds apart before restarting. A single failed request during
# a slow first compile of a heavy route is not a dead server, and restarting on
# one would cost more than the outage.
#
# Prints one line per restart and nothing otherwise, so it is quiet until
# something has actually happened.
set -u
LOG="${1:-/tmp/nerfchess-dev.log}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

alive() { curl -s -o /dev/null --max-time 8 http://localhost:3000/ 2>/dev/null; }

while true; do
  if ! alive; then
    sleep 10
    if ! alive; then
      echo "[dev-supervisor] $(date -u +%H:%M:%S) dev server down, restarting"
      pgrep -f "next dev|next-server" | xargs -r kill -9 2>/dev/null
      sleep 2
      nohup npm run dev > "$LOG" 2>&1 &
      sleep 45
    fi
  fi
  sleep 20
done
