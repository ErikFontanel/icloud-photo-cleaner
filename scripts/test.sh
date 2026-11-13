#!/bin/zsh
# Builds Sift and runs all tests on the iOS simulator.
# The UI tests accept the photo permission alert and seed sample photos themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${SIFT_SIM:-iPhone 17 Pro}"
UDID=$(xcrun simctl list devices available | grep -m1 "    $DEVICE (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[[ -n "$UDID" ]] || { echo "error: no available simulator named '$DEVICE'"; exit 1; }

scripts/generate.sh
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" >/dev/null

xcodebuild test -project Sift.xcodeproj -scheme Sift \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath build "$@"
