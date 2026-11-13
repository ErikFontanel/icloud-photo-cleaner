#!/bin/zsh
# Makes Sift.xcodeproj from project.yml, with the bundle ID prefix and team ID from .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] && { set -a; source .env; set +a; }
export SIFT_BUNDLE_ID_PREFIX="${SIFT_BUNDLE_ID_PREFIX:-com.example}" SIFT_DEVELOPMENT_TEAM="${SIFT_DEVELOPMENT_TEAM:-}"
xcodegen generate --quiet
