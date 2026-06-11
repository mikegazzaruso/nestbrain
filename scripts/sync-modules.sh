#!/usr/bin/env bash
# Copy the proprietary module implementations from the sibling
# nestbrain-modules checkout into this working tree. Desktop impl lands in a
# gitignored dir; web impls OVERWRITE tracked stub files, so we mark those
# skip-worktree to keep `git status` clean. Run after pulling nestbrain-modules.
# Undo: scripts/unsync-modules.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../nestbrain-modules"
[ -d "$SRC/apps" ] || { echo "nestbrain-modules not found at $SRC" >&2; exit 1; }

rsync -a --delete "$SRC/apps/desktop/src/dev-impl/" "$ROOT/apps/desktop/src/dev-impl/"
rsync -a "$SRC/apps/web/src/" "$ROOT/apps/web/src/"

cd "$ROOT"
STUBS=(
  apps/web/src/lib/terminal-context.tsx
  apps/web/src/lib/git-status-context.tsx
  apps/web/src/components/terminal-panel.tsx
  apps/web/src/components/branch-indicator.tsx
  apps/web/src/components/new-project-modal.tsx
  apps/web/src/components/project-filter.tsx
)
for f in "${STUBS[@]}"; do git update-index --skip-worktree "$f"; done
echo "✅ modules synced (desktop dev-impl + web dev UI; stubs marked skip-worktree)"
