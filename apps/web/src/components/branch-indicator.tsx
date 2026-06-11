"use client";

import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useModules } from "@/lib/modules-context";
import { SourceControlPanel } from "./source-control-panel";

interface RepoView {
  repoPath: string;
  branch: string;
  ahead: number;
  behind: number;
  dirtyCount: number;
}

/**
 * Compact branch chip in the sidebar footer. Follows whatever has the
 * user's focus — VSCode-style. Two focus channels:
 *
 *   • `nestbrain:editor-file`     — fires when a file opens in the editor
 *   • `nestbrain:terminal-focus`  — fires when a terminal tab activates
 *
 * Most recently received focus wins. For each focus we ask the main process
 * `git:findRepo(path)` which walks up looking for a `.git` toplevel, so the
 * chip works even when the file tree hasn't pre-registered the project as
 * a git repo. The lookup is debounced and the chip listens on
 * `nestbrain:fs:changed` so a commit / checkout reflected anywhere on disk
 * refreshes the visible branch.
 *
 * Renders nothing when no focus has been set yet, or when the focus path
 * lives outside any git repo.
 */
export function BranchIndicator() {
  const { has } = useModules();
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoView | null>(null);
  const fetchSeq = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Only the terminal drives the indicator. When the user opens a new
  // terminal at a project folder (via the git icon in the tree or the "+"
  // button), the terminal-context dispatches `nestbrain:terminal-focus`
  // with that session's cwd; we resolve it to its repo and stick there
  // until the next terminal becomes active.
  useEffect(() => {
    function onTerminalFocus(e: Event) {
      const detail = (e as CustomEvent<{ cwd?: string }>).detail;
      if (detail?.cwd) setFocusPath(detail.cwd);
    }
    window.addEventListener("nestbrain:terminal-focus", onTerminalFocus as EventListener);
    return () => {
      window.removeEventListener("nestbrain:terminal-focus", onTerminalFocus as EventListener);
    };
  }, []);

  // Resolve the current focus path to its owning repo via IPC.
  // `fetchSeq` guards against out-of-order resolutions when the user switches
  // focus rapidly (only the latest call's result is committed to state).
  // We KEEP the previous repo visible while a new fetch is in flight — the
  // chip only clears once we *know* the new path isn't inside a repo. That
  // avoids the layout flash where the footer briefly loses its branch when
  // the user clicks between terminal tabs.
  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain?.git) return;
    if (!focusPath) {
      setRepo(null);
      return;
    }
    const seq = ++fetchSeq.current;
    void window.nestbrain.git.findRepo(focusPath).then((res) => {
      if (seq !== fetchSeq.current) return;
      if (!res) {
        setRepo(null);
        return;
      }
      setRepo({
        repoPath: res.repoPath,
        branch: res.status.branch,
        ahead: res.status.ahead,
        behind: res.status.behind,
        dirtyCount: Object.keys(res.status.files).length,
      });
    });
  }, [focusPath]);

  // Refresh the current repo's status on filesystem changes — picks up
  // commits, checkouts, and edits made anywhere in the workspace.
  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain?.fs) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.nestbrain.fs.onChange(() => {
      if (!focusPath || !window.nestbrain?.git) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!focusPath || !window.nestbrain?.git) return;
        const seq = ++fetchSeq.current;
        void window.nestbrain.git.findRepo(focusPath).then((res) => {
          if (seq !== fetchSeq.current) return;
          if (!res) {
            setRepo(null);
            return;
          }
          setRepo({
            repoPath: res.repoPath,
            branch: res.status.branch,
            ahead: res.status.ahead,
            behind: res.status.behind,
            dirtyCount: Object.keys(res.status.files).length,
          });
        });
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [focusPath]);

  if (!has("dev")) return null;
  if (!repo) return null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null);
          setPanelOpen((v) => !v);
        }}
        className="flex items-center gap-1 text-[11px] text-muted/70 truncate min-w-0 hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-card-hover"
        title={`${repo.repoPath}\nClick for source control`}
      >
        <GitBranch size={11} className="text-accent/70 shrink-0" />
        <span className="font-mono truncate">
          {repo.branch || "(detached)"}
          {repo.dirtyCount > 0 && <span className="text-amber-400">*</span>}
        </span>
        {repo.ahead > 0 && (
          <span className="inline-flex items-center gap-0.5 text-emerald-300/80 shrink-0">
            <ArrowUp size={9} />
            {repo.ahead}
          </span>
        )}
        {repo.behind > 0 && (
          <span className="inline-flex items-center gap-0.5 text-amber-300/80 shrink-0">
            <ArrowDown size={9} />
            {repo.behind}
          </span>
        )}
      </button>
      {panelOpen && (
        <SourceControlPanel
          repoPath={repo.repoPath}
          onClose={() => setPanelOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
}
