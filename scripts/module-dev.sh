#!/usr/bin/env bash
# Module author harness: overlay the private modules onto this public checkout
# and launch the app with one module force-unlocked (no licensed Team Server
# needed). The override is dev-only (gated on NESTBRAIN_DEV) and still
# intersected with what's actually compiled in.
#
#   bash scripts/module-dev.sh dev-besidetech
#
# Requires the sibling nestbrain-modules checkout (see scripts/sync-modules.sh).
set -euo pipefail
MOD="${1:?usage: scripts/module-dev.sh <module-id>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/sync-modules.sh"
echo "▶ launching NestBrain with module unlocked: $MOD"
NESTBRAIN_DEV_MODULES="$MOD" pnpm -C "$ROOT" desktop:dev
