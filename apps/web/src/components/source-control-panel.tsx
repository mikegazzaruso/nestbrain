"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommit,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  Archive,
  ArchiveRestore,
  Minus,
} from "lucide-react";

interface GitFileStatus {
  index: string;
  worktree: string;
}

interface GitRepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  files: Record<string, GitFileStatus>;
}

interface Stash {
  ref: string;
  message: string;
}

interface SourceControlPanelProps {
  repoPath: string;
  onClose: () => void;
  /** Anchor rect of the trigger element so we can position the popover above it. */
  anchorRect: DOMRect | null;
}

interface FileRow {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  /** One-char marker that drives the colored badge. */
  marker: string;
}

function buildRows(status: GitRepoStatus): { staged: FileRow[]; changes: FileRow[] } {
  const staged: FileRow[] = [];
  const changes: FileRow[] = [];
  for (const [path, f] of Object.entries(status.files)) {
    const isStaged = f.index !== " " && f.index !== "?";
    const isUnstaged = f.worktree !== " ";
    if (isStaged) {
      staged.push({
        path,
        index: f.index,
        worktree: f.worktree,
        staged: true,
        unstaged: false,
        marker: f.index === "R" ? "R" : f.index === "A" ? "A" : f.index === "D" ? "D" : "M",
      });
    }
    if (isUnstaged) {
      const m =
        f.worktree === "?" && f.index === "?"
          ? "U"
          : f.worktree === "D"
            ? "D"
            : "M";
      changes.push({
        path,
        index: f.index,
        worktree: f.worktree,
        staged: false,
        unstaged: true,
        marker: m,
      });
    }
  }
  staged.sort((a, b) => a.path.localeCompare(b.path));
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { staged, changes };
}

function markerClass(marker: string): string {
  switch (marker) {
    case "M":
      return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    case "U":
    case "A":
      return "text-emerald-300 bg-emerald-400/10 border-emerald-400/30";
    case "D":
      return "text-red-400 bg-red-400/10 border-red-400/30";
    case "R":
      return "text-violet-400 bg-violet-400/10 border-violet-400/30";
    default:
      return "text-muted/60 bg-muted/10 border-muted/30";
  }
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function SourceControlPanel({ repoPath, onClose, anchorRect }: SourceControlPanelProps) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [stashOpen, setStashOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !window.nestbrain?.git) return;
    try {
      const s = await window.nestbrain.git.status(repoPath);
      setStatus(s);
      const list = await window.nestbrain.git.stashList(repoPath);
      setStashes(list.stashes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [repoPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close on outside click + Esc
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { staged, changes } = useMemo(
    () => (status ? buildRows(status) : { staged: [], changes: [] }),
    [status],
  );

  async function run<T>(
    label: string,
    op: () => Promise<T & { ok: boolean; stderr: string }>,
  ): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      const res = await op();
      if (!res.ok) {
        setError(res.stderr?.trim() || `${label} failed`);
        return res;
      }
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const stage = (paths: string[]) =>
    window.nestbrain &&
    run("stage", () => window.nestbrain!.git.stage(repoPath, paths));
  const unstage = (paths: string[]) =>
    window.nestbrain && run("unstage", () => window.nestbrain!.git.unstage(repoPath, paths));
  const discard = async (paths: string[]) => {
    if (!window.nestbrain) return;
    if (
      !window.confirm(
        paths.length === 1
          ? `Discard changes to ${basename(paths[0])}? This cannot be undone.`
          : `Discard changes to ${paths.length} files? This cannot be undone.`,
      )
    )
      return;
    return run("discard", () => window.nestbrain!.git.discard(repoPath, paths));
  };
  const stageAll = () => stage(changes.map((c) => c.path));
  const unstageAll = () => unstage(staged.map((c) => c.path));
  const commit = async () => {
    if (!message.trim() || !window.nestbrain) return;
    const r = await run("commit", () => window.nestbrain!.git.commit(repoPath, message.trim()));
    if (r && r.ok) setMessage("");
  };
  const push = () =>
    window.nestbrain && run("push", () => window.nestbrain!.git.push(repoPath));
  const pull = () =>
    window.nestbrain && run("pull", () => window.nestbrain!.git.pull(repoPath));
  const sync = async () => {
    if (!window.nestbrain) return;
    setBusy("sync");
    setError(null);
    try {
      const a = await window.nestbrain.git.pull(repoPath);
      if (!a.ok) {
        setError(a.stderr.trim() || "pull failed");
        return;
      }
      const b = await window.nestbrain.git.push(repoPath);
      if (!b.ok) setError(b.stderr.trim() || "push failed");
    } finally {
      setBusy(null);
      void refresh();
    }
  };
  const stash = async () => {
    if (!window.nestbrain) return;
    const m = window.prompt("Stash message (optional)", "");
    if (m === null) return; // cancelled
    await run("stash", () => window.nestbrain!.git.stashPush(repoPath, m || undefined, true));
  };
  const stashPop = (ref: string) =>
    window.nestbrain && run("stashPop", () => window.nestbrain!.git.stashPop(repoPath, ref));
  const stashDrop = async (ref: string) => {
    if (!window.nestbrain) return;
    if (!window.confirm(`Drop ${ref}? This cannot be undone.`)) return;
    return run("stashDrop", () => window.nestbrain!.git.stashDrop(repoPath, ref));
  };

  // Position the popover above the trigger. Falls back to bottom-left of the
  // viewport when no anchor rect was provided.
  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) {
      return { left: 12, bottom: 12 };
    }
    return {
      left: Math.max(8, anchorRect.left - 4),
      bottom: window.innerHeight - anchorRect.top + 8,
    };
  }, [anchorRect]);

  const totalChanges = staged.length + changes.length;
  const branchName = status?.branch || "(detached)";

  return (
    <div
      className="fixed inset-0 z-[150]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Subtle backdrop for click-out */}
      <div className="absolute inset-0 bg-background/30 backdrop-blur-[1px]" />

      <div
        ref={panelRef}
        style={style}
        className="absolute w-[420px] max-w-[calc(100vw-16px)] max-h-[80vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/50 flex flex-col animate-pop-in"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-accent/5 via-fuchsia-500/5 to-purple-500/5 shrink-0">
          <GitBranch size={14} className="text-accent" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-mono font-medium truncate text-foreground">{branchName}</span>
              {status && status.ahead > 0 && (
                <span className="inline-flex items-center gap-0.5 text-emerald-300/80">
                  <ArrowUp size={10} />
                  {status.ahead}
                </span>
              )}
              {status && status.behind > 0 && (
                <span className="inline-flex items-center gap-0.5 text-amber-300/80">
                  <ArrowDown size={10} />
                  {status.behind}
                </span>
              )}
              {totalChanges > 0 && (
                <span className="text-[10px] text-muted/60">
                  {totalChanges} change{totalChanges === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted/50 truncate" title={repoPath}>
              {repoPath}
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            className="p-1 text-muted/50 hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-muted/50 hover:text-foreground transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Commit input */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
            }}
            placeholder="Message (⌘+Enter to commit)"
            rows={2}
            className="w-full text-[12px] font-mono px-3 py-2 rounded-lg bg-background border border-border focus:border-accent/60 focus:ring-1 focus:ring-accent/30 outline-none resize-none placeholder:text-muted/40"
          />
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={() => void commit()}
              disabled={!message.trim() || staged.length === 0 || busy !== null}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-accent text-background text-[11px] font-medium rounded-md hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={
                staged.length === 0
                  ? "Stage changes first"
                  : "Commit staged changes (⌘+Enter)"
              }
            >
              {busy === "commit" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Commit
            </button>
            <button
              onClick={() => void sync()}
              disabled={busy !== null || !status?.hasUpstream}
              className="px-2 py-1.5 text-[11px] text-muted/70 rounded-md border border-border hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={status?.hasUpstream ? "Pull then Push" : "No upstream — set one with `git push -u origin <branch>`"}
            >
              {busy === "sync" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            </button>
            <button
              onClick={() => void pull()}
              disabled={busy !== null || !status?.hasUpstream}
              className="px-2 py-1.5 text-[11px] text-muted/70 rounded-md border border-border hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
              title={status?.hasUpstream ? "Pull" : "No upstream"}
            >
              {busy === "pull" ? <Loader2 size={11} className="animate-spin" /> : <ArrowDown size={11} />}
            </button>
            <button
              onClick={() => void push()}
              disabled={busy !== null || !status?.hasUpstream}
              className="px-2 py-1.5 text-[11px] text-muted/70 rounded-md border border-border hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
              title={status?.hasUpstream ? "Push" : "No upstream — set one with `git push -u origin <branch>`"}
            >
              {busy === "push" ? <Loader2 size={11} className="animate-spin" /> : <ArrowUp size={11} />}
            </button>
            <button
              onClick={() => void stash()}
              disabled={busy !== null || totalChanges === 0}
              className="px-2 py-1.5 text-[11px] text-muted/70 rounded-md border border-border hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-30 inline-flex items-center gap-1"
              title="Stash changes"
            >
              {busy === "stash" ? <Loader2 size={11} className="animate-spin" /> : <Archive size={11} />}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[10px] font-mono text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 whitespace-pre-wrap break-words">
              {error}
            </p>
          )}
          {status && !status.hasUpstream && (
            <p className="mt-2 text-[10px] text-muted/60">
              No upstream. Set one from a terminal: <span className="font-mono text-muted/80">git push -u origin {branchName}</span>
            </p>
          )}
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-1 pb-2 min-h-0">
          <Section
            title="Staged Changes"
            open={stagedOpen}
            onToggle={() => setStagedOpen((v) => !v)}
            count={staged.length}
            actions={
              staged.length > 0 && (
                <button
                  onClick={() => void unstageAll()}
                  className="p-1 text-muted/40 hover:text-foreground transition-colors"
                  title="Unstage all"
                >
                  <Minus size={12} />
                </button>
              )
            }
          >
            {staged.map((row) => (
              <FileRowView
                key={"s:" + row.path}
                row={row}
                actions={
                  <>
                    <RowButton
                      icon={<Minus size={12} />}
                      title="Unstage"
                      onClick={() => void unstage([row.path])}
                    />
                  </>
                }
              />
            ))}
          </Section>

          <Section
            title="Changes"
            open={changesOpen}
            onToggle={() => setChangesOpen((v) => !v)}
            count={changes.length}
            actions={
              changes.length > 0 && (
                <button
                  onClick={() => void stageAll()}
                  className="p-1 text-muted/40 hover:text-foreground transition-colors"
                  title="Stage all"
                >
                  <Plus size={12} />
                </button>
              )
            }
          >
            {changes.map((row) => (
              <FileRowView
                key={"c:" + row.path}
                row={row}
                actions={
                  <>
                    <RowButton
                      icon={<RotateCcw size={12} />}
                      title="Discard changes"
                      onClick={() => void discard([row.path])}
                      hoverClass="hover:text-red-300"
                    />
                    <RowButton
                      icon={<Plus size={12} />}
                      title="Stage"
                      onClick={() => void stage([row.path])}
                    />
                  </>
                }
              />
            ))}
          </Section>

          {stashes.length > 0 && (
            <Section
              title="Stashed"
              open={stashOpen}
              onToggle={() => setStashOpen((v) => !v)}
              count={stashes.length}
            >
              {stashes.map((s) => (
                <div
                  key={s.ref}
                  className="group flex items-center gap-2 px-2 py-1 mx-1 rounded text-[11px] hover:bg-card-hover transition-colors"
                  title={s.ref}
                >
                  <GitCommit size={11} className="text-violet-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-muted/80">{s.message}</span>
                  <span className="font-mono text-[10px] text-muted/40 shrink-0">{s.ref}</span>
                  <RowButton
                    icon={<ArchiveRestore size={12} />}
                    title="Pop stash"
                    onClick={() => void stashPop(s.ref)}
                  />
                  <RowButton
                    icon={<Trash2 size={12} />}
                    title="Drop stash"
                    onClick={() => void stashDrop(s.ref)}
                    hoverClass="hover:text-red-300"
                  />
                </div>
              ))}
            </Section>
          )}

          {totalChanges === 0 && stashes.length === 0 && (
            <div className="text-center py-10 text-muted/50">
              <Check size={20} className="mx-auto mb-2 opacity-40" />
              <p className="text-[12px]">Working tree clean</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 pl-2 pr-2 py-1 text-[10px] uppercase tracking-wider text-muted/50 group">
        <button onClick={onToggle} className="flex items-center gap-1 hover:text-foreground transition-colors">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>{title}</span>
          <span className="text-muted/40 ml-1">{count}</span>
        </button>
        <div className="flex-1" />
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">{actions}</div>
      </div>
      {open && count > 0 && <div className="pb-1">{children}</div>}
    </div>
  );
}

function FileRowView({ row, actions }: { row: FileRow; actions: React.ReactNode }) {
  const name = basename(row.path);
  const dir = dirname(row.path);
  return (
    <div
      className="group grid grid-cols-[auto,1fr,auto] gap-2 items-center px-2 py-1 mx-1 rounded text-[12px] hover:bg-card-hover transition-colors"
      title={row.path}
    >
      <span
        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border min-w-[18px] text-center ${markerClass(row.marker)}`}
      >
        {row.marker}
      </span>
      <span className="truncate min-w-0">
        <span className="text-foreground/90">{name}</span>
        {dir && <span className="text-muted/40 ml-1.5 text-[11px]">{dir}</span>}
      </span>
      <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {actions}
      </span>
    </div>
  );
}

function RowButton({
  icon,
  title,
  onClick,
  hoverClass = "hover:text-foreground",
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  hoverClass?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={`p-1 text-muted/50 ${hoverClass} transition-colors`}
    >
      {icon}
    </button>
  );
}
