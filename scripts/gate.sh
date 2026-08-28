#!/bin/bash
# ── The audit gate. One command, one verdict, green means green. ──
#
# Three checks on this project have passed while testing nothing: a cap-copy
# parity check comparing two missing files as identical, the audit:web
# raw-path blind spot, and a commit that landed on a red storage pin because
# `npm run audit:storage | tail` reports tail's exit code, not the audit's.
#
# This script is the permanent fix. It runs the build and every audit and
# prints the verdict IN BAND as the last line — RESULT: GREEN only when every
# stage passed — so piping its output through tail/grep can never manufacture
# a pass: a red gate prints RESULT: RED plus the failing stage's log tail.
# The exit code is honest too (nonzero on any failure), for chains that
# check it. Commit only on RESULT: GREEN.
set -u
cd "$(dirname "$0")/.."
LOG="$(mktemp -t tm-gate)"
names=()
results=()
fail=0
run() {
  local name="$1"; shift
  echo "───── $name ─────" >>"$LOG"
  if "$@" >>"$LOG" 2>&1; then
    results+=("PASS"); names+=("$name")
  else
    results+=("FAIL"); names+=("$name"); fail=1
    # Snapshot the failing stage's tail immediately so the summary can show
    # the RIGHT stage even if a later one also writes.
    echo "──── failing stage: $name ────" >>"$LOG.fail"
    tail -30 "$LOG" >>"$LOG.fail"
  fi
}
run "build"         npm run --silent build
run "audit:build"   npm run --silent audit:build
run "audit:storage" npm run --silent audit:storage
run "audit:web"     npm run --silent audit:web

echo "── gate ──"
for i in "${!names[@]}"; do
  echo "  ${results[$i]}  ${names[$i]}"
done
if [ "$fail" -ne 0 ]; then
  echo "── failure detail ──"
  cat "$LOG.fail" 2>/dev/null || tail -40 "$LOG"
  echo "RESULT: RED"
  exit 1
fi
echo "RESULT: GREEN"
exit 0
