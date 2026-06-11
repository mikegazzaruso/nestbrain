#!/usr/bin/env bash
# Copy the proprietary module implementations from the sibling
# nestbrain-modules checkout into this working tree (gitignored paths).
# Run after pulling nestbrain-modules; required for desktop:dev with the
# Dev module and for local packaging.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/../nestbrain-modules"
[ -d "$SRC/apps" ] || { echo "nestbrain-modules not found at $SRC" >&2; exit 1; }
rsync -a --delete "$SRC/apps/desktop/src/dev-impl/" "$(dirname "$0")/../apps/desktop/src/dev-impl/"
echo "✅ modules synced (apps/desktop/src/dev-impl)"
