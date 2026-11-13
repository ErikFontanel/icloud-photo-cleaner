#!/bin/zsh
# Sift never deletes photos: fails when code calls a photo delete API (PhotoKit, AppleScript or photoscript).
# Deleting an album is allowed. Usage: no-delete.sh [file ... | -]   (no arguments: scan all source folders)
cd "$(dirname "$0")/.."
PATTERN='deleteAssets|PHAssetChangeRequest\.delete|delete_photo|delete (every )?(media item|photo)'
if [[ "${1:-}" == - ]]; then
  grep -nEi "$PATTERN"
else
  (( $# )) || set -- Sift mac/sift_mac mac/helper/Sources
  grep -rnEi --include='*.swift' --include='*.py' "$PATTERN" "$@" 2>/dev/null
fi && { echo "error: Sift must never delete photos. Remove the photo delete call above (deleting an album is fine)." >&2; exit 1; }
exit 0
