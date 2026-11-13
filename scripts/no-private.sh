#!/bin/zsh
# Pre-commit: blocks private files and any value from .env (bundle prefix, team ID, home cities and coordinates)
# in staged files, so the public repo never names the owner or where they live.
set -uo pipefail
cd "$(dirname "$0")/.."
staged=("${(@f)$(git diff --cached --name-only --diff-filter=ACMR)}")
(( ${#staged} )) && [[ -n "${staged[1]}" ]] || exit 0
fail=0

for f in $staged; do
  case $f in
    .env|*.sqlite|*.sqlite-*|*.photoslibrary/*|mac/*.jpg|mac/*.jpeg|mac/*.png|mac/*.heic)
      echo "error: $f is private (local settings, a database or a photo). Unstage it: git restore --staged '$f'" >&2; fail=1 ;;
  esac
done

if [[ -f .env ]]; then
  values=()
  while IFS='=' read -r key value; do
    [[ $key == SIFT_* ]] || continue
    value=${${value#[\"\']}%[\"\']}
    [[ $key == SIFT_BUNDLE_ID_PREFIX && $value == com.example ]] && continue
    for part in ${(s:;:)${value//,/;}}; do
      [[ ${#part} -ge 4 && $part != <->-<->-<-> ]] && values+=("$part")  # skip short parts and `until` dates
    done
  done < .env
  if (( ${#values} )); then
    for f in $staged; do
      [[ $f == .env.example ]] && continue
      hits=$(git show ":$f" 2>/dev/null | grep -nwF "${(@)values/#/-e}" 2>/dev/null)
      [[ -n $hits ]] && { echo "error: $f contains a value from .env (private):" >&2; echo "$hits" | sed "s|^|  $f:|" >&2; fail=1; }
    done
  fi
fi

(( fail )) && echo "Move the value to .env and read it from there, or use a neutral example (Lyon, com.example)." >&2
exit $fail
