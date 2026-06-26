// Registry of settings panels contributed by overlaid (third-party) modules,
// keyed by module id. The Modules page renders a registered panel inline, and
// the sidebar skips a generic nav entry for any module that registers one —
// so a third-party module's options live next to the first-party ones instead
// of as a standalone surface.
//
// This is the PUBLIC stub: empty in source builds (no third-party modules).
// A module overlay (e.g. dev-besidetech) replaces this file to register its
// panel. Kept skip-worktree by scripts/sync-modules.sh so the overlay doesn't
// dirty `git status`.

import type { ComponentType, ReactNode } from "react";

export interface ModulePanel {
  name: string;
  icon: ReactNode;
  Panel: ComponentType;
}

export const moduleSettings: Record<string, ModulePanel> = {};
