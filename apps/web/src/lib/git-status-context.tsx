"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface GitFileStatus {
  index: string; // 1 char
  worktree: string;
}

export interface GitRepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: Record<string, GitFileStatus>;
}

interface GitStatusState {
  /** Map of repo path → latest status (or null if not a repo). */
  repos: Record<string, GitRepoStatus | null>;
  /** Register a path as a candidate git repo; idempotent. */
  registerRepo: (repoPath: string) => void;
  /** Force-refresh all registered repos right now. */
  refresh: () => void;
}

const GitStatusContext = createContext<GitStatusState>({
  repos: {},
  registerRepo: () => {},
  refresh: () => {},
});

/**
 * Centralized git-status cache for the file tree. The tree calls
 * `registerRepo(projectPath)` on the first render of each top-level
 * project; the provider re-fetches every repo on a debounced filesystem-
 * change event (the existing nestbrain:fs:changed channel) and on an
 * interval as a safety net for git ops that don't touch the tree (commit,
 * checkout). The state is shared so the FileTree and the status bar both
 * see the same numbers.
 */
export function GitStatusProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Record<string, GitRepoStatus | null>>({});
  const registered = useRef<Set<string>>(new Set());

  const fetchOne = useCallback(async (path: string) => {
    if (typeof window === "undefined" || !window.nestbrain?.git) return;
    try {
      const status = await window.nestbrain.git.status(path);
      setRepos((cur) => ({ ...cur, [path]: status }));
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(() => {
    for (const path of registered.current) void fetchOne(path);
  }, [fetchOne]);

  const registerRepo = useCallback(
    (repoPath: string) => {
      if (registered.current.has(repoPath)) return;
      registered.current.add(repoPath);
      void fetchOne(repoPath);
    },
    [fetchOne],
  );

  // Debounce filesystem-change events: many small writes (a save, a git
  // command's intermediate stages) cluster into a single refresh.
  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain?.fs) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.nestbrain.fs.onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [refresh]);

  // Periodic safety net — catches commits / checkouts done from an
  // external terminal that don't touch any watched files.
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({ repos, registerRepo, refresh }),
    [repos, registerRepo, refresh],
  );

  return <GitStatusContext.Provider value={value}>{children}</GitStatusContext.Provider>;
}

export function useGitStatus() {
  return useContext(GitStatusContext);
}

/**
 * Convenience: derive the single-char marker for a path relative to a
 * registered repo. Returns "" when the path isn't tracked by the repo's
 * status. The marker is the worktree column when it carries information
 * (modified, untracked) and falls back to the index column otherwise
 * (staged add, staged delete) — that matches VSCode's behavior.
 */
export function pickMarker(file: GitFileStatus | undefined): string {
  if (!file) return "";
  const w = file.worktree;
  const i = file.index;
  if (w === "?" && i === "?") return "U"; // untracked
  if (w === "M" || i === "M") return "M";
  if (i === "A") return "A";
  if (w === "D" || i === "D") return "D";
  if (w === "!" || i === "!") return "!"; // ignored
  if (i === "R") return "R";
  return (w !== " " ? w : i).trim();
}

export function markerClass(marker: string): string {
  switch (marker) {
    case "M":
      return "text-amber-400";
    case "U":
    case "A":
      return "text-emerald-400";
    case "D":
      return "text-red-400";
    case "R":
      return "text-violet-400";
    default:
      return "text-muted/40";
  }
}
