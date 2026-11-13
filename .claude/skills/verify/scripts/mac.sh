#!/bin/zsh
# Mac review page for verification, isolated from the user's own: its own SIFT_HOME (the "Sift Test" library,
# scanned read-only), its own port, stopped by its saved PID.
# Usage: mac.sh start | doctor | shot <name> [path] | stop
set -euo pipefail
ROOT=${0:A:h:h:h:h:h}
PORT=${SIFT_VERIFY_PORT:-8766}
LIB="$HOME/Pictures/Sift Test.photoslibrary"
RUN="$ROOT/build/verify/.mac"          # scratch: state, PID, log (removed by stop)
OUT="$ROOT/build/verify"               # evidence (kept)
URL="http://127.0.0.1:$PORT"
alive() { [[ -f $RUN/pid ]] && kill -0 "$(<$RUN/pid)" 2>/dev/null; }

case ${1:-} in
start)
  alive && { echo "already running: $URL (pid $(<$RUN/pid))"; exit 0; }
  [[ -d $LIB ]] || { echo "error: $LIB not found. Create it in Photos (hold Option at launch) with a few test photos." >&2; exit 1; }
  if lsof -nP -w -iTCP:$PORT -sTCP:LISTEN >/dev/null; then echo "error: port $PORT is taken by another process; set SIFT_VERIFY_PORT" >&2; exit 1; fi
  geo="${SIFT_HOME:-$HOME/.sift-mac}/geonames"
  [[ -f $geo/cities1000.txt ]] || { echo "error: no GeoNames data in $geo. Run once: cd mac && uv run sift-mac setup" >&2; exit 1; }
  mkdir -p "$RUN/home" "$OUT"
  ln -sfn "$geo" "$RUN/home/geonames"   # read-only place names, shared with the user's install
  pnpm --dir "$ROOT/mac/web" build >/dev/null || { echo "error: the review page did not build; run pnpm install" >&2; exit 1; }
  cd "$ROOT/mac" && uv sync -q
  SIFT_HOME="$RUN/home" .venv/bin/sift-mac scan --library "$LIB"
  SIFT_HOME="$RUN/home" nohup .venv/bin/sift-mac review --port $PORT >"$RUN/log" 2>&1 &
  echo $! >"$RUN/pid"
  for _ in {1..50}; do curl -sf "$URL/api/table/state" >/dev/null && { echo "ready: $URL (pid $(<$RUN/pid))"; exit 0; }; sleep 0.2; done
  echo "error: no answer on $URL; log:" >&2; cat "$RUN/log" >&2; exit 1 ;;
doctor)
  alive || { echo "DOWN: no review server started by this skill"; exit 1; }
  pid=$(<$RUN/pid); listener=$(lsof -nP -w -tiTCP:$PORT -sTCP:LISTEN || true)
  [[ $listener == $pid ]] || { echo "BAD: port $PORT listener is '${listener:-none}', not our pid $pid"; exit 1; }
  echo "UP: pid $pid, $(ps -o command= -p $pid)"
  echo "state: $(curl -sf "$URL/api/table/state")"
  echo "assets in scratch db: $(sqlite3 "$RUN/home/state.sqlite" 'select status, count(*) from assets group by status')" ;;
shot)
  name=${2:?usage: mac.sh shot <name> [path]}; stamp=$(date +%Y%m%d-%H%M%S)
  profile=$(mktemp -d)
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
    --user-data-dir="$profile" --window-size=1440,900 --virtual-time-budget=5000 \
    --screenshot="$OUT/mac-$stamp-$name.png" "$URL${3:-/}" 2>/dev/null
  rm -rf "$profile"; echo "$OUT/mac-$stamp-$name.png" ;;
stop)
  if alive; then kill -TERM "$(<$RUN/pid)"; fi
  rm -rf "$RUN"; echo "stopped; evidence kept in $OUT" ;;
*) sed -n 2,4p "$0"; exit 2 ;;
esac
