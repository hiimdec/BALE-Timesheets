#!/bin/bash
# ── ship:ios — the ONLY supported way to get a build onto a device. ──
#
# Xcode builds the Swift. It does NOT refresh the web assets: it reuses
# whatever `npx cap copy ios` last put in ios/App/App/public/. Build in Xcode
# without copying first and you install fresh Swift wrapped around stale
# JavaScript — the version string still reads 2026.11, the build looks new,
# and none of your changes are on the phone.
#
# That has cost two wasted cycles on this project. The second one ran for a
# week: three fixes to a money bug were all verified green on this Mac while
# the founder's phone kept reporting the pre-fix figure, because every install
# carried old app.js.
#
# So the three remembered steps are one command now. Same in-band verdict
# pattern as scripts/gate.sh, and for the same reason: a `| tail` reports
# tail's exit code, not the check's, and that has manufactured a false pass
# here before. The last line is RESULT: SHIPPED or RESULT: FAILED, and the
# exit code is honest too.
#
#   npm run ship:ios              build, copy, verify, open Xcode
#   npm run ship:ios -- --no-open build, copy, verify only
#   npm run ship:ios -- --widget  also compile the widget extension scheme
#
# TM_SHIP_VERIFY_ONLY=1 skips the build and copy and runs the verification
# alone. That exists so the verification can be PROVEN to fail: with build and
# copy always running first, they regenerate both files and the checksum stage
# can never diverge, which would make it decoration — a check that cannot go
# red is not a check. With this hook, corrupting the device copy and running
# verify-only reds it, which is the only way to know it works.
#
set -u
cd "$(dirname "$0")/.."

OPEN_XCODE=1
CHECK_WIDGET=0
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_XCODE=0 ;;
    --widget)  CHECK_WIDGET=1 ;;
    *) echo "unknown option: $arg"; echo "RESULT: FAILED"; exit 2 ;;
  esac
done

SRC="dist/assets/app.js"
DST="ios/App/App/public/assets/app.js"
LOG="$(mktemp -t tm-ship)"

fail() {
  echo ""
  echo "── $1 ──"
  shift
  [ $# -gt 0 ] && printf '%s\n' "$@"
  echo ""
  echo "RESULT: FAILED"
  exit 1
}

echo ""
echo "── ship:ios ──"

if [ "${TM_SHIP_VERIFY_ONLY:-0}" != "1" ]; then
  # 1 ── build ──────────────────────────────────────────────────────────────
  printf '  %-28s' "npm run build"
  if npm run build >"$LOG" 2>&1; then echo "ok"; else
    echo "FAILED"; fail "build failed" "$(tail -25 "$LOG")"
  fi

  # 2 ── copy ───────────────────────────────────────────────────────────────
  printf '  %-28s' "npx cap copy ios"
  if npx cap copy ios >"$LOG" 2>&1; then echo "ok"; else
    echo "FAILED"; fail "cap copy failed" "$(tail -25 "$LOG")"
  fi
else
  echo "  (verify only — build and copy skipped)"
fi

# 3 ── verify ───────────────────────────────────────────────────────────────
# EXISTENCE FIRST. A previous parity check on this project compared two
# MISSING files and called them identical, so absence must fail before
# equality is even asked. Checking app.js, not index.html: dist/index.html is
# a loader shell whose checksum is stable by design, so comparing shells
# proves nothing.
printf '  %-28s' "web assets match"
[ -f "$SRC" ] || { echo "FAILED"; fail "missing $SRC" "the build produced no app bundle"; }
[ -f "$DST" ] || { echo "FAILED"; fail "missing $DST" "cap copy did not place the web assets"; }

SRC_SUM="$(shasum "$SRC" | awk '{print $1}')"
DST_SUM="$(shasum "$DST" | awk '{print $1}')"
[ -n "$SRC_SUM" ] || { echo "FAILED"; fail "could not checksum $SRC"; }

if [ "$SRC_SUM" != "$DST_SUM" ]; then
  echo "FAILED"
  fail "web assets differ — the device would run STALE JavaScript" \
       "  $SRC" "    $SRC_SUM" "  $DST" "    $DST_SUM"
fi
echo "ok"

# 4 ── optional: the widget extension compiles ──────────────────────────────
# Building the App scheme EMBEDS TimeMachineWidgetExtension.appex into
# App.app/PlugIns, and the widget target reads no web assets at all (shared
# data via the App Group, pure Swift), so nothing here affects the copy above.
# This flag is a compile check, not a shipping step.
if [ "$CHECK_WIDGET" -eq 1 ]; then
  printf '  %-28s' "widget extension compiles"
  if xcodebuild -project ios/App/App.xcodeproj -scheme TimeMachineWidgetExtension \
       -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData \
       build >"$LOG" 2>&1; then echo "ok"; else
    echo "FAILED"; fail "widget extension failed to compile" "$(tail -25 "$LOG")"
  fi
fi

# 5 ── what's going on the phone ────────────────────────────────────────────
APP_VERSION="$(grep -m1 -o 'const APP_VERSION = "[^"]*"' index.html | sed 's/.*"\(.*\)"/\1/')"
echo ""
echo "  APP_VERSION   ${APP_VERSION:-<unreadable>}"
echo "  app.js        $SRC_SUM"
echo ""
echo "  On the phone, Settings → Help & data shows the version. The checksum"
echo "  above is what SHOULD be running — if a figure still looks pre-fix"
echo "  after installing, re-run this command and compare before diagnosing."
echo ""

if [ "$OPEN_XCODE" -eq 1 ]; then
  echo "  Opening Xcode. Select your iPhone and press Run."
  open ios/App/App.xcodeproj
else
  echo "  Next: open ios/App/App.xcodeproj, select your iPhone, press Run."
fi

echo ""
echo "RESULT: SHIPPED"
