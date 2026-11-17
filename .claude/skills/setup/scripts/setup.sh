#!/bin/zsh
# Installs what Sift needs on this Mac. Each step skips what is already there, so run it again after a fix.
# Usage: setup.sh check [ios] | mac | ios
#   check: one line per item: "ok", "todo" (mac/ios installs it) or "user" (only the user can do it). Exit 1 if not all ok.
set -euo pipefail
ROOT=${0:A:h:h:h:h:h}
cd "$ROOT"
[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
[[ -f .env ]] && { set -a; source .env; set +a; }
DEVICE="${SIFT_SIM:-iPhone 17 Pro}"
HELPERS=(mac/helper/.build/release/sift-vision mac/helper/.build/release/sift-places)
missing=0

ok() { print -r -- "ok    $1"; }
todo() { print -r -- "todo  $1"; missing=1; }
user() { print -r -- "user  $1"; missing=1; }
has() { command -v "$1" >/dev/null; }
python_ok() { for p in python3 python3.{12..15}; do has $p && $p -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null && return; done; return 1; }
# A venv moved with the repo keeps the old path in its shebangs and editable install, so run it, don't just look for it.
venv_ok() { mac/.venv/bin/sift-mac --help >/dev/null 2>&1; }
xcode_ok() { [[ $(xcode-select -p 2>/dev/null) == *Xcode*.app/* ]]; }
sim_udid() { xcrun simctl list devices available | grep -m1 "    $DEVICE (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }

check_mac() {
  has brew && ok "Homebrew" || user 'Homebrew: run  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"  (asks for the admin password)'
  xcode-select -p >/dev/null 2>&1 && ok "Command Line Tools" || user "Command Line Tools: run  xcode-select --install  and click Install in the dialog"
  python_ok && ok "Python 3.12+" || todo "Python 3.12+ (brew install python@3.13)"
  for tool in uv node pnpm; do has $tool && ok $tool || todo "$tool (brew install $tool)"; done
  if [[ ! -f .env ]]; then todo ".env (copied from .env.example)"
  elif cmp -s .env .env.example; then user ".env still has the example values: set SIFT_HOMES (and for iOS the bundle ID prefix and team ID)"
  else ok ".env"; fi
  [[ -d node_modules ]] && ok "pnpm packages and git hooks" || todo "pnpm packages and git hooks (pnpm install)"
  [[ -f mac/sift_mac/web/index.html ]] && ok "review page build" || todo "review page build (pnpm --dir mac/web build)"
  if venv_ok; then ok "Python packages"
  elif [[ -d mac/.venv ]]; then todo "Python packages: mac/.venv does not run (moved repo?), setup.sh mac makes it again"
  else todo "Python packages (uv sync --all-groups in mac/)"; fi
  [[ -x $HELPERS[1] && -x $HELPERS[2] ]] && ok "Swift helpers" || todo "Swift helpers (swift build in mac/helper)"
  [[ -f ${SIFT_HOME:-$HOME/.sift-mac}/geonames/cities1000.txt ]] && ok "GeoNames data" || todo "GeoNames data (sift-mac setup)"
  if venv_ok; then
    local hf=${HF_HUB_CACHE:-${HF_HOME:-$HOME/.cache/huggingface}/hub} m
    for m in $(mac/.venv/bin/python -c 'from sift_mac.setup import OLLAMA_MODELS as o, HF_MODELS as h; print(*o, *h)'); do
      if [[ $m == */* ]]; then [[ -d $hf/models--${m//\//--} ]]
      else [[ -f $HOME/.ollama/models/manifests/registry.ollama.ai/library/${m%%:*}/${m#*:} ]]; fi && ok "model $m" || todo "model $m (sift-mac setup)"
    done
    # Full Disk Access: osxphotos reads the Photos database. Reads 1 byte to /dev/null, nothing from any photo.
    local lib=$(mac/.venv/bin/python -c 'from osxphotos.utils import get_system_library_path as p; print(p() or "")' 2>/dev/null)
    if [[ -z $lib ]]; then user "Photos library: open Photos.app once so macOS makes a System Photo Library"
    elif head -c1 "$lib/database/Photos.sqlite" >/dev/null 2>&1; then ok "Photos library access"
    else user "Full Disk Access: System Settings > Privacy & Security > Full Disk Access, turn on ${TERM_PROGRAM:-your terminal app}, then restart it"; fi
  else
    todo "models (sift-mac setup, after the Python packages)"
  fi
}

check_ios() {
  if ! ls -d /Applications/Xcode*.app >/dev/null 2>&1; then user 'Xcode 26.1+: install it from the App Store (open "macappstore://apps.apple.com/app/id497799835"), then open it once'
  elif ! xcode_ok; then user "Xcode is installed but not selected: run  sudo xcode-select -s /Applications/Xcode.app"
  else
    local v=$(xcodebuild -version | awk 'NR==1 {print $2}')
    is-at-least 26.1 $v && ok "Xcode $v" || user "Xcode $v is too old: update it to 26.1+ in the App Store"
    xcodebuild -license check >/dev/null 2>&1 && ok "Xcode license" || user "Xcode license: run  sudo xcodebuild -license accept"
    xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 && ok "Xcode first launch" || user "Xcode components: run  sudo xcodebuild -runFirstLaunch"
    xcrun simctl list runtimes | grep -q '^iOS 26' && ok "iOS 26 simulator runtime" || todo "iOS 26 simulator runtime (xcodebuild -downloadPlatform iOS, several GB)"
    [[ -n $(sim_udid) ]] && ok "simulator $DEVICE" || todo "simulator $DEVICE (simctl create)"
  fi
  has xcodegen && ok xcodegen || todo "xcodegen (brew install xcodegen)"
  [[ -d Sift.xcodeproj ]] && ok "Sift.xcodeproj" || todo "Sift.xcodeproj (scripts/generate.sh)"
  [[ -n ${SIFT_DEVELOPMENT_TEAM:-} ]] && ok "team ID" || ok "team ID not set: fine for the simulator; an iPhone needs SIFT_DEVELOPMENT_TEAM in .env"
}

install_mac() {
  has brew || { echo "error: Homebrew is missing. Run: setup.sh check" >&2; exit 1; }
  python_ok || brew install python@3.13
  for tool in uv node pnpm; do has $tool || brew install $tool; done
  [[ -f .env ]] || cp .env.example .env
  pnpm install
  pnpm --dir mac/web build
  [[ -d mac/.venv ]] && ! venv_ok && rm -rf mac/.venv
  (cd mac && uv sync --all-groups)
  swift build -c release --package-path mac/helper
  (cd mac && uv run sift-mac setup)
}

install_ios() {
  xcode_ok || { echo "error: Xcode is not installed or not selected. Run: setup.sh check ios" >&2; exit 1; }
  has xcodegen || brew install xcodegen
  xcrun simctl list runtimes | grep -q '^iOS 26' || xcodebuild -downloadPlatform iOS
  if [[ -z $(sim_udid) ]]; then
    local type=$(xcrun simctl list devicetypes | grep -m1 "^$DEVICE (" | sed -E 's/.*\((.*)\)$/\1/')
    local runtime=$(xcrun simctl list runtimes | grep '^iOS ' | tail -1 | awk '{print $NF}')
    xcrun simctl create "$DEVICE" "${type:?no device type named $DEVICE}" "$runtime"
  fi
  scripts/generate.sh
}

autoload -Uz is-at-least
case ${1:-} in
check) check_mac; [[ ${2:-} == ios ]] && check_ios; exit $missing ;;
mac) install_mac; echo "Mac companion installed." ;;
ios) install_ios; echo "iOS app ready: open Sift.xcodeproj or run scripts/test.sh." ;;
*) sed -n 3,4p "$0"; exit 2 ;;
esac
