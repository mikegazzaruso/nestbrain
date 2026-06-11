"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  ExternalLink,
  Cloud,
  GitBranch,
  ArrowRight,
  FolderInput,
  Sparkles,
} from "lucide-react";
import { useSync } from "@/lib/sync-context";
import { useModules } from "@/lib/modules-context";
import { FileIcon } from "./file-icon";
import { useGitStatus, pickMarker, markerClass } from "@/lib/git-status-context";
import { useTerminal } from "@/lib/terminal-context";

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FileTreeProps {
  rootPath: string;
  onNewProject: () => void;
}

type CreateKind = "file" | "dir";

export function FileTree({ rootPath, onNewProject }: FileTreeProps) {
  const router = useRouter();
  const { has: hasModule } = useModules();
  const devModule = hasModule("dev");
  const { state: syncState } = useSync();
  const syncEnabled = syncState.prefs.enabled && syncState.status !== "disabled";

  // Compute the workspace-relative POSIX path so it matches the sync manifest.
  function toRelPath(absPath: string): string {
    if (!absPath.startsWith(rootPath + "/")) return absPath;
    return absPath.slice(rootPath.length + 1).split(/[/\\]/).join("/");
  }
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set([rootPath, `${rootPath}/Projects`]),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  // selectedPath can be a file or a directory. The "effective parent"
  // for creation = selectedPath if it's a directory, else its parent,
  // else rootPath.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDir, setSelectedIsDir] = useState<boolean>(false);
  const [creating, setCreating] = useState<{
    kind: CreateKind;
    parent: string;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<{
    absPath: string;
    name: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    name: string;
    isDir: boolean;
  } | null>(null);

  const toggle = useCallback((path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectEntry = useCallback((path: string, isDir: boolean) => {
    setSelectedPath(path);
    setSelectedIsDir(isDir);
  }, []);

  const openFile = useCallback(
    (path: string) => {
      router.push(`/editor?path=${encodeURIComponent(path)}`);
    },
    [router],
  );

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Import an external folder into Projects/ and make it knowledge-ready.
  const importProject = useCallback(async () => {
    if (!window.nestbrain?.projects) return;
    try {
      const res = await window.nestbrain.projects.import();
      if (res) {
        setExpanded((s) => new Set(s).add(`${rootPath}/Projects`));
        refresh();
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Import failed");
    }
  }, [refresh, rootPath]);

  // A directory that's a direct child of Projects/ (a project root).
  const isProjectDir = useCallback(
    (p: string): boolean => {
      const norm = p.replace(/\\/g, "/");
      const base = `${rootPath.replace(/\\/g, "/")}/Projects/`;
      if (!norm.startsWith(base)) return false;
      const rest = norm.slice(base.length);
      return rest.length > 0 && !rest.includes("/");
    },
    [rootPath],
  );

  async function handleMakeReady(targetPath: string) {
    if (!window.nestbrain?.projects) return;
    try {
      await window.nestbrain.projects.makeReady(targetPath);
      window.alert("Project is now knowledge-ready — commits will feed the knowledge base.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to make knowledge-ready");
    }
  }

  // Auto refresh when window gains focus
  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Auto refresh when the native file watcher reports a change
  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain?.fs?.onChange) {
      return;
    }
    const off = window.nestbrain.fs.onChange(refresh);
    return off;
  }, [refresh]);

  // Dismiss context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onGlobalClick() {
      setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    window.addEventListener("click", onGlobalClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onGlobalClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback(
    (e: React.MouseEvent, path: string, name: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, path, name, isDir });
    },
    [],
  );

  async function handleRename(oldPath: string, newName: string) {
    if (!window.nestbrain?.fs?.rename) return;
    const oldBase = oldPath.slice(oldPath.lastIndexOf("/") + 1);
    // Same name (or blur/esc) → just close the rename input, don't hit IPC
    if (!newName || newName === oldBase) {
      setRenamingPath(null);
      return;
    }
    try {
      await window.nestbrain.fs.rename(oldPath, newName);
      setRenamingPath(null);
      // Clear stale selection (path changed under us)
      if (selectedPath === oldPath) setSelectedPath(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Rename failed");
      setRenamingPath(null);
    }
  }

  async function handleDelete(targetPath: string, name: string, isDir: boolean) {
    if (!window.nestbrain) return;
    const kind = isDir ? "folder" : "file";
    const relPath = toRelPath(targetPath);

    // Sync ON + single file → soft-delete via the sync engine. The file is
    // moved to .trash/ and the Drive copy follows. Other devices see the
    // move on their next pull, so nothing is lost anywhere.
    if (syncEnabled && !isDir && !relPath.startsWith(".trash/")) {
      try {
        await window.nestbrain.sync.softDelete(relPath);
        if (selectedPath === targetPath) setSelectedPath(null);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Move-to-trash failed");
      }
      return;
    }

    // Otherwise (sync off, or folder, or already in .trash/) → plain delete.
    const extraMsg = relPath.startsWith(".trash/")
      ? "\nThis item is in .trash/ — deleting will remove it permanently from this device."
      : isDir
        ? "\nAll its contents will be permanently removed."
        : "";
    const ok = window.confirm(
      `Delete ${kind} "${name}"?${extraMsg}\n\nThis action cannot be undone.`,
    );
    if (!ok) return;
    try {
      await window.nestbrain.fs.delete(targetPath);
      if (selectedPath === targetPath) setSelectedPath(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // Hard-delete uses a custom modal instead of window.prompt (Electron
  // blocks native prompts). The actual deletion happens in confirmHardDelete
  // below, called by the HardDeleteDialog when the user types DELETE.
  function handleHardDelete(targetPath: string, name: string, isDir: boolean) {
    if (!window.nestbrain) return;
    if (isDir) {
      window.alert("Folder hard-delete isn't supported yet — delete files individually.");
      return;
    }
    setHardDeleteTarget({ absPath: targetPath, name });
  }

  async function confirmHardDelete() {
    if (!window.nestbrain || !hardDeleteTarget) return;
    const { absPath } = hardDeleteTarget;
    const relPath = toRelPath(absPath);
    try {
      await window.nestbrain.sync.hardDelete(relPath);
      if (selectedPath === absPath) setSelectedPath(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Hard delete failed");
    } finally {
      setHardDeleteTarget(null);
    }
  }

  function effectiveParent(): string {
    if (!selectedPath) return rootPath;
    if (selectedIsDir) return selectedPath;
    // File selected → create sibling (in its parent)
    const lastSlash = selectedPath.lastIndexOf("/");
    return lastSlash > 0 ? selectedPath.slice(0, lastSlash) : rootPath;
  }

  function startCreate(kind: CreateKind) {
    const parent = effectiveParent();
    setCreating({ kind, parent });
    setCreateError(null);
    // Ensure the parent directory is expanded so the new item appears
    setExpanded((s) => new Set(s).add(parent));
  }

  async function confirmCreate(name: string) {
    if (!creating || !window.nestbrain?.fs) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(null);
      return;
    }
    if (trimmed.includes("/") || trimmed === "." || trimmed === "..") {
      setCreateError("Invalid name");
      return;
    }
    const fullPath = `${creating.parent}/${trimmed}`;
    try {
      if (creating.kind === "dir") {
        await window.nestbrain.fs.createDir(fullPath);
      } else {
        await window.nestbrain.fs.writeFile(fullPath, "");
      }
      setCreating(null);
      setCreateError(null);
      // File watcher will auto-refresh. Open the new file in the editor.
      if (creating.kind === "file") {
        router.push(`/editor?path=${encodeURIComponent(fullPath)}`);
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create",
      );
    }
  }

  const parentLabel = creating
    ? creating.parent === rootPath
      ? "NestBrain"
      : creating.parent.replace(rootPath + "/", "")
    : "";

  return (
    <div className="flex-shrink-0 border-b border-sidebar-border">
      {/* New / Import — one row, New project emphasized (Dev module only) */}
      {devModule && (
      <div className="px-3 pt-3 pb-2 flex items-stretch gap-1.5">
        <button
          onClick={onNewProject}
          title="Create a new project in NestBrain/Projects"
          className="group flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[12px] font-medium text-foreground/90 bg-card hover:bg-card-hover border border-border hover:border-accent/40 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-5 h-5 rounded-md bg-accent/15 text-accent group-hover:bg-accent/20 transition-colors">
              <Plus size={12} strokeWidth={2.5} />
            </span>
            <span className="truncate">New project</span>
          </span>
          <ArrowRight
            size={12}
            className="shrink-0 text-muted/30 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-accent/70 transition-all"
          />
        </button>
        <button
          onClick={importProject}
          title="Import an existing folder into Projects — made knowledge-ready automatically"
          className="shrink-0 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] text-muted/70 hover:text-foreground bg-card/50 hover:bg-card border border-border/60 hover:border-border transition-colors"
        >
          <FolderInput size={12} className="shrink-0 text-muted/50" />
          <span>Import</span>
        </button>
      </div>
      )}

      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider">
          NestBrain
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => startCreate("file")}
            className="p-1 text-muted/40 hover:text-foreground hover:bg-card rounded transition-colors"
            title="New file in selected folder"
          >
            <FilePlus size={12} />
          </button>
          <button
            onClick={() => startCreate("dir")}
            className="p-1 text-muted/40 hover:text-foreground hover:bg-card rounded transition-colors"
            title="New folder in selected folder"
          >
            <FolderPlus size={12} />
          </button>
        </div>
      </div>

      {creating && (
        <CreateInput
          kind={creating.kind}
          parentLabel={parentLabel}
          error={createError}
          onConfirm={confirmCreate}
          onCancel={() => {
            setCreating(null);
            setCreateError(null);
          }}
        />
      )}

      <div className="max-h-[300px] overflow-y-auto pb-2 pr-1">
        <TreeNode
          path={rootPath}
          name="NestBrain"
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onOpenFile={openFile}
          onSelect={selectEntry}
          onContextMenu={openContextMenu}
          onRenameConfirm={handleRename}
          renamingPath={renamingPath}
          selectedPath={selectedPath}
          isDir
          isRoot
          refreshKey={refreshKey}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDir={contextMenu.isDir}
          onOpen={
            contextMenu.isDir
              ? undefined
              : () => {
                  openFile(contextMenu.path);
                  setContextMenu(null);
                }
          }
          onRename={() => {
            setRenamingPath(contextMenu.path);
            setContextMenu(null);
          }}
          onDelete={() => {
            const { path, name, isDir } = contextMenu;
            setContextMenu(null);
            handleDelete(path, name, isDir);
          }}
          onHardDelete={
            syncEnabled && !contextMenu.isDir
              ? () => {
                  const { path, name, isDir } = contextMenu;
                  setContextMenu(null);
                  handleHardDelete(path, name, isDir);
                }
              : undefined
          }
          onMakeReady={
            contextMenu.isDir && isProjectDir(contextMenu.path)
              ? () => {
                  const { path } = contextMenu;
                  setContextMenu(null);
                  handleMakeReady(path);
                }
              : undefined
          }
          syncEnabled={syncEnabled}
        />
      )}
      {hardDeleteTarget && (
        <HardDeleteDialog
          name={hardDeleteTarget.name}
          onCancel={() => setHardDeleteTarget(null)}
          onConfirm={confirmHardDelete}
        />
      )}
    </div>
  );
}

function HardDeleteDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed === "DELETE";

  async function doConfirm() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[460px] max-w-[90vw] rounded-2xl bg-card border border-red-500/30 shadow-2xl shadow-black/60 p-6 space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Trash2 size={16} className="text-red-400" />
            <h2 className="text-base font-semibold text-red-400">
              Delete on all devices?
            </h2>
          </div>
          <p className="text-[12px] text-muted/80 leading-relaxed">
            <span className="font-mono text-foreground">{name}</span> will be
            permanently removed from your Google Drive. Other devices signed in
            to NestBrain with this account will move their local copy to{" "}
            <code className="text-accent/80 bg-accent/5 px-1 rounded">
              .trash/
            </code>{" "}
            on their next sync — but the file will no longer be recoverable from
            Drive. This cannot be undone.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] text-muted/60 uppercase tracking-wider">
            Type DELETE to confirm
          </label>
          <input
            autoFocus
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) doConfirm();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="DELETE"
            className="w-full px-3 py-2 bg-background border border-red-500/30 rounded-lg text-sm font-mono placeholder:text-muted/30 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-xs text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={doConfirm}
            disabled={!ready || busy}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  isDir: boolean;
  onOpen?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHardDelete?: () => void;
  onMakeReady?: () => void;
  syncEnabled: boolean;
}

function ContextMenu({
  x,
  y,
  onOpen,
  onRename,
  onDelete,
  onHardDelete,
  onMakeReady,
  syncEnabled,
}: ContextMenuProps) {
  // Clamp within viewport so it doesn't clip on the right/bottom
  const MENU_W = 220;
  const MENU_H = onHardDelete ? 170 : 120;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[200] w-56 py-1 bg-card border border-border rounded-lg shadow-xl shadow-black/40 text-[12px]"
      style={{ left, top }}
    >
      {onOpen && (
        <>
          <MenuItem
            icon={<ExternalLink size={12} />}
            label="Open"
            onClick={onOpen}
          />
          <div className="my-1 h-px bg-border/60" />
        </>
      )}
      {onMakeReady && (
        <>
          <MenuItem
            icon={<Sparkles size={12} />}
            label="Make knowledge-ready"
            onClick={onMakeReady}
          />
          <div className="my-1 h-px bg-border/60" />
        </>
      )}
      <MenuItem
        icon={<Pencil size={12} />}
        label="Rename"
        onClick={onRename}
      />
      <MenuItem
        icon={<Trash2 size={12} />}
        label={syncEnabled ? "Move to .trash/" : "Delete"}
        onClick={onDelete}
        danger
      />
      {onHardDelete && (
        <MenuItem
          icon={<Cloud size={12} />}
          label="Delete on all devices…"
          onClick={onHardDelete}
          danger
        />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        danger
          ? "text-red-400/90 hover:bg-red-500/10"
          : "text-foreground hover:bg-accent/10"
      }`}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

interface RenameInputProps {
  initialValue: string;
  depth: number;
  isDir: boolean;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function RenameInput({
  initialValue,
  depth,
  isDir,
  onConfirm,
  onCancel,
}: RenameInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select filename stem (without extension) like most editors
    const dot = initialValue.lastIndexOf(".");
    if (!isDir && dot > 0) {
      input.setSelectionRange(0, dot);
    } else {
      input.select();
    }
  }, [initialValue, isDir]);

  const indent = depth * 10;

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5"
      style={{ paddingLeft: `${indent + 8}px` }}
    >
      <div className="w-[11px] shrink-0" />
      {isDir ? (
        <Folder size={13} className="shrink-0 text-accent/70" />
      ) : (
        <FileIcon name={value || "file"} size={13} />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (value.trim() && value.trim() !== initialValue) {
              onConfirm(value.trim());
            } else {
              onCancel();
            }
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={() => onCancel()}
        className="flex-1 min-w-0 px-1 py-0 bg-background border border-accent/60 rounded text-[12px] text-foreground focus:outline-none"
      />
    </div>
  );
}

interface CreateInputProps {
  kind: CreateKind;
  parentLabel: string;
  error: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function CreateInput({
  kind,
  parentLabel,
  error,
  onConfirm,
  onCancel,
}: CreateInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-3 py-2 border-t border-b border-border/50 bg-card/40">
      <div className="text-[10px] text-muted/50 mb-1 truncate">
        New {kind === "file" ? "file" : "folder"} in{" "}
        <span className="text-muted/80 font-mono">{parentLabel}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {kind === "file" ? (
          <FileIcon name={value || "file"} size={12} />
        ) : (
          <Folder size={12} className="shrink-0 text-muted/40" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onConfirm(value);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          onBlur={() => {
            if (!value.trim()) onCancel();
          }}
          placeholder={kind === "file" ? "filename.md" : "folder-name"}
          className="flex-1 min-w-0 px-1.5 py-0.5 bg-background border border-accent/40 rounded text-[12px] text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/70"
        />
      </div>
      {error && (
        <div className="mt-1 text-[10px] text-red-400/80">{error}</div>
      )}
    </div>
  );
}

interface TreeNodeProps {
  path: string;
  name: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelect: (path: string, isDir: boolean) => void;
  onContextMenu: (
    e: React.MouseEvent,
    path: string,
    name: string,
    isDir: boolean,
  ) => void;
  onRenameConfirm: (oldPath: string, newName: string) => void;
  renamingPath: string | null;
  selectedPath: string | null;
  isDir: boolean;
  isRoot?: boolean;
  /** Bumped to force open folders to re-read their children in place
   *  (without remounting the tree — that caused the visible flash). */
  refreshKey: number;
}

function TreeNode({
  path,
  name,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  onSelect,
  onContextMenu,
  onRenameConfirm,
  renamingPath,
  selectedPath,
  isDir,
  isRoot,
  refreshKey,
}: TreeNodeProps) {
  const { has: hasModule } = useModules();
  const devModule = hasModule("dev");
  const isOpen = expanded.has(path);
  const isSelected = selectedPath === path;
  const isRenaming = renamingPath === path;
  const [children, setChildren] = useState<FsEntry[] | null>(null);

  // Git integration. For every folder rendered in the tree, we ask the
  // main process "is this the top of a git repo?" once. If yes, we both
  // register it in the shared status context (so the file rows under it
  // get per-file markers) AND show a small GitBranch icon that opens a
  // new terminal at the repo + lights up the branch indicator.
  const { repos, registerRepo } = useGitStatus();
  const { openTerminal } = useTerminal();
  const [isRepoTop, setIsRepoTop] = useState(false);
  useEffect(() => {
    if (!isDir) return;
    if (typeof window === "undefined" || !window.nestbrain?.git) return;
    let cancelled = false;
    void window.nestbrain.git.findRepo(path).then((res) => {
      if (cancelled) return;
      if (res && res.repoPath === path) {
        setIsRepoTop(true);
        registerRepo(path);
      } else {
        setIsRepoTop(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDir, path, registerRepo]);

  // Resolve the ancestor repo for marker computation. We pick the LONGEST
  // matching prefix so nested checkouts (a sub-repo inside a project) win
  // over the outer one.
  const ancestor = useMemo(() => {
    let best: { repoPath: string; relPath: string } | null = null;
    for (const repoPath of Object.keys(repos)) {
      if (!repos[repoPath]) continue;
      if (path === repoPath || path.startsWith(repoPath + "/")) {
        const rel = path === repoPath ? "" : path.slice(repoPath.length + 1);
        if (!best || repoPath.length > best.repoPath.length) {
          best = { repoPath, relPath: rel };
        }
      }
    }
    return best;
  }, [path, repos]);

  const marker = useMemo(() => {
    if (!ancestor) return "";
    const status = repos[ancestor.repoPath];
    if (!status) return "";
    return pickMarker(status.files[ancestor.relPath]);
  }, [ancestor, repos]);

  useEffect(() => {
    if (!isDir || !isOpen) return;
    if (typeof window === "undefined" || !window.nestbrain) return;
    let cancelled = false;
    window.nestbrain.fs.list(path).then((list) => {
      // Update children in place — React reconciles by entry.path, so
      // unchanged rows don't remount (no flash) and open folders stay open.
      if (!cancelled) setChildren(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, path, isDir, refreshKey]);

  const indent = depth * 10;

  // Rename input replaces the button in place (file or folder)
  if (isRenaming) {
    return (
      <RenameInput
        initialValue={name}
        depth={depth}
        isDir={isDir}
        onConfirm={(newName) => onRenameConfirm(path, newName)}
        onCancel={() => onRenameConfirm(path, name)}
      />
    );
  }

  if (!isDir) {
    return (
      <button
        onClick={() => {
          onSelect(path, false);
          // Surface the ancestor repo to the status bar (debounced
          // implicitly via React's batched updates — see status-bar.tsx).
          if (ancestor) {
            window.dispatchEvent(
              new CustomEvent("nestbrain:focus-project", {
                detail: { repoPath: ancestor.repoPath },
              }),
            );
          }
        }}
        onDoubleClick={() => onOpenFile(path)}
        onContextMenu={(e) => onContextMenu(e, path, name, false)}
        className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-[13px] rounded transition-colors ${
          isSelected
            ? "bg-accent/15 text-foreground"
            : "text-muted/60 hover:text-foreground hover:bg-card"
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
        title="Double-click to open · Right-click for options"
      >
        <div className="w-[11px] shrink-0" />
        <FileIcon name={name} size={14} />
        <span className="truncate flex-1 text-left">{name}</span>
        {marker && (
          <span
            className={`text-[10px] font-mono ${markerClass(marker)} shrink-0`}
            title={`git: ${marker}`}
          >
            {marker}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div
        className={`group w-full flex items-center gap-1.5 px-2 py-1 text-[13px] rounded transition-colors ${
          isSelected
            ? "bg-accent/15 text-foreground"
            : "text-muted hover:text-foreground hover:bg-card"
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        <button
          onClick={() => {
            onSelect(path, true);
            onToggle(path);
          }}
          onContextMenu={(e) => onContextMenu(e, path, name, true)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <ChevronRight
            size={12}
            className={`shrink-0 transition-transform ${
              isOpen ? "rotate-90" : ""
            } text-muted/50`}
          />
          {isOpen ? (
            <FolderOpen size={14} className="shrink-0 text-accent/70" />
          ) : (
            <Folder size={14} className="shrink-0 text-muted/50" />
          )}
          <span className={`truncate ${isRoot ? "font-semibold" : ""} flex-1 text-left`}>
            {name}
          </span>
        </button>
        {isRepoTop && devModule && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void openTerminal(path, name);
            }}
            className="shrink-0 p-0.5 text-accent/40 hover:text-accent transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title={`Open terminal here · focus branch indicator on ${name}`}
          >
            <GitBranch size={12} />
          </button>
        )}
      </div>
      {isOpen && children && (
        <div>
          {children
            .filter((entry) => devModule || !(isRoot && entry.isDirectory && entry.name === "Projects"))
            .map((entry) => (
            <TreeNode
              key={entry.path}
              path={entry.path}
              name={entry.name}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onRenameConfirm={onRenameConfirm}
              renamingPath={renamingPath}
              selectedPath={selectedPath}
              isDir={entry.isDirectory}
              refreshKey={refreshKey}
            />
          ))}
          {children.length === 0 && (
            <div
              className="text-[11px] text-muted/30 italic py-0.5"
              style={{ paddingLeft: `${(depth + 1) * 10 + 28}px` }}
            >
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}
