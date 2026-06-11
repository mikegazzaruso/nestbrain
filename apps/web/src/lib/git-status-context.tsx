"use client";

import { createContext, useContext, type ReactNode } from "react";

// Open-core stub — the real git-status cache ships with the Dev module
// (private nestbrain-modules repo) and replaces this file in official
// builds. The pure marker helpers stay real so the file tree compiles and
// simply renders no markers (empty repos map).

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
  repos: Record<string, GitRepoStatus | null>;
  registerRepo: (repoPath: string) => void;
  refresh: () => void;
}

const GitStatusContext = createContext<GitStatusState>({
  repos: {},
  registerRepo: () => {},
  refresh: () => {},
});

export function GitStatusProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useGitStatus() {
  return useContext(GitStatusContext);
}

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
