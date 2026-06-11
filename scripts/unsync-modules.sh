#!/usr/bin/env bash
# Restore the public (stub) state: clear skip-worktree, restore stubs from
# the index, remove the gitignored private files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STUBS=(
  apps/web/src/lib/terminal-context.tsx
  apps/web/src/lib/git-status-context.tsx
  apps/web/src/components/terminal-panel.tsx
  apps/web/src/components/branch-indicator.tsx
  apps/web/src/components/new-project-modal.tsx
  apps/web/src/components/project-filter.tsx
)
for f in "${STUBS[@]}"; do git update-index --no-skip-worktree "$f" 2>/dev/null || true; done
git checkout -- "${STUBS[@]}"
rm -rf apps/desktop/src/dev-impl
rm -f apps/web/src/components/integrated-terminal.tsx apps/web/src/components/source-control-panel.tsx
echo "✅ back to public (stub) state"
