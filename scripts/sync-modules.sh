#!/usr/bin/env bash
# Copy the proprietary module implementations from the sibling
# nestbrain-modules checkout into this working tree. The private repo groups
# files by module (modules/<name>/...); inside each module the layout mirrors
# this monorepo, so the overlay is a plain copy. Desktop impl lands in a
# gitignored dir; web impls OVERWRITE tracked stub files, so those are marked
# skip-worktree to keep `git status` clean. Undo: scripts/unsync-modules.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../nestbrain-modules"
[ -d "$SRC/modules" ] || { echo "nestbrain-modules not found at $SRC" >&2; exit 1; }

for mod in "$SRC"/modules/*/; do
  [ -d "$mod" ] || continue
  echo "  overlay: $(basename "$mod")"
  rsync -a "$mod" "$ROOT/"
done

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
echo "✅ modules synced (per-module overlay; stubs marked skip-worktree)"
