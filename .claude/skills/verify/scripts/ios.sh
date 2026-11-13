#!/bin/zsh
# iOS app on the simulator for verification. XCUITest is the driver; evidence goes to build/verify.
# Usage: ios.sh doctor | screens [light|dark] | test <TestName> | shot <name>
set -euo pipefail
ROOT=${0:A:h:h:h:h:h}
OUT="$ROOT/build/verify"
DEVICE="${SIFT_SIM:-iPhone 17 Pro}"
UDID=$(xcrun simctl list devices available | grep -m1 "    $DEVICE (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[[ -n $UDID ]] || { echo "error: no available simulator named '$DEVICE' (set SIFT_SIM)" >&2; exit 1; }
APP="$ROOT/build/Build/Products/Debug-iphonesimulator/Sift.app"
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"

# Runs one UI test with a result bundle, then exports its screenshots and the result to build/verify.
uitest() {
  local bundle="$OUT/ios-$stamp-$1.xcresult"
  "$ROOT/scripts/test.sh" -quiet -only-testing:"SiftUITests/ReviewFlowUITests/$1" -resultBundlePath "$bundle" && rc=0 || rc=$?
  local dir="$OUT/ios-$stamp-$1"
  xcrun xcresulttool export attachments --path "$bundle" --output-path "$dir" >/dev/null 2>&1 || true
  [[ -f $dir/manifest.json ]] && /usr/bin/jq -r '.[].attachments[] | "\(.exportedFileName)\t\(.suggestedHumanReadableName)"' "$dir/manifest.json" |
    while IFS=$'\t' read -r file name; do mv "$dir/$file" "$dir/${name%%_[0-9]_*}.${file##*.}"; done  # snap("2-review") -> 2-review.png
  echo "result: $bundle (exit $rc)"; ls "$OUT/ios-$stamp-$1" 2>/dev/null | sed "s|^|  $OUT/ios-$stamp-$1/|"
  return $rc
}

case ${1:-} in
doctor)
  state=$(xcrun simctl list devices | grep "$UDID" | grep -oE '\((Booted|Shutdown)\)' || true)
  echo "simulator: $DEVICE $UDID $state"
  [[ -d $APP ]] || { echo "app: not built (run ios.sh screens or scripts/test.sh)"; exit 1; }
  id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
  echo "app: $id, built $(stat -f %Sm "$APP")"
  xcrun simctl get_app_container "$UDID" "$id" >/dev/null 2>&1 && echo "installed: yes" || echo "installed: no" ;;
screens)
  look=${2:-light}
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" >/dev/null
  xcrun simctl ui "$UDID" appearance "$look"
  stamp="$stamp-$look"; uitest testCaptureScreens ;;
test)
  uitest "${2:?usage: ios.sh test <TestName>}" ;;
shot)
  xcrun simctl io "$UDID" screenshot "$OUT/ios-$stamp-${2:?usage: ios.sh shot <name>}.png" >/dev/null && echo "$OUT/ios-$stamp-$2.png" ;;
*) sed -n 2,3p "$0"; exit 2 ;;
esac
