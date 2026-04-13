"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";

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
    if (typeof window === "undefined" || !window.mindnest?.fs?.onChange) {
      return;
    }
    const off = window.mindnest.fs.onChange(refresh);
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
    if (!window.mindnest?.fs?.rename) return;
    const oldBase = oldPath.slice(oldPath.lastIndexOf("/") + 1);
    // Same name (or blur/esc) → just close the rename input, don't hit IPC
    if (!newName || newName === oldBase) {
      setRenamingPath(null);
      return;
    }
    try {
      await window.mindnest.fs.rename(oldPath, newName);
      setRenamingPath(null);
      // Clear stale selection (path changed under us)
      if (selectedPath === oldPath) setSelectedPath(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Rename failed");
      setRenamingPath(null);
    }
  }

  async function handleDelete(targetPath: string, name: string, isDir: boolean) {
    if (!window.mindnest?.fs?.delete) return;
    const kind = isDir ? "folder" : "file";
    const ok = window.confirm(
      `Delete ${kind} "${name}"?${isDir ? "\nAll its contents will be permanently removed." : ""}\n\nThis action cannot be undone.`,
    );
    if (!ok) return;
    try {
      await window.mindnest.fs.delete(targetPath);
      if (selectedPath === targetPath) setSelectedPath(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
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
    if (!creating || !window.mindnest?.fs) return;
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
        await window.mindnest.fs.createDir(fullPath);
      } else {
        await window.mindnest.fs.writeFile(fullPath, "");
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
      {/* Prominent New Project CTA */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={onNewProject}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-gradient-to-br from-accent to-purple-500 hover:from-accent-hover hover:to-purple-400 text-white text-[12px] font-semibold rounded-lg shadow-lg shadow-accent/25 hover:shadow-accent/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
          title="Create a new project in NestBrain/Projects"
        >
          <Plus size={14} className="shrink-0" strokeWidth={3} />
          <span>New Project</span>
        </button>
      </div>

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
          key={refreshKey}
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
        />
      )}
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
}

function ContextMenu({
  x,
  y,
  onOpen,
  onRename,
  onDelete,
}: ContextMenuProps) {
  // Clamp within viewport so it doesn't clip on the right/bottom
  const MENU_W = 160;
  const MENU_H = 120;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[200] w-40 py-1 bg-card border border-border rounded-lg shadow-xl shadow-black/40 text-[12px]"
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
      <MenuItem
        icon={<Pencil size={12} />}
        label="Rename"
        onClick={onRename}
      />
      <MenuItem
        icon={<Trash2 size={12} />}
        label="Delete"
        onClick={onDelete}
        danger
      />
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
        <FileText size={13} className="shrink-0 text-muted/40" />
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
          <FileText size={12} className="shrink-0 text-muted/40" />
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
}: TreeNodeProps) {
  const isOpen = expanded.has(path);
  const isSelected = selectedPath === path;
  const isRenaming = renamingPath === path;
  const [children, setChildren] = useState<FsEntry[] | null>(null);

  useEffect(() => {
    if (!isDir || !isOpen) return;
    if (typeof window === "undefined" || !window.mindnest) return;
    let cancelled = false;
    window.mindnest.fs.list(path).then((list) => {
      if (!cancelled) setChildren(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, path, isDir]);

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
        onClick={() => onSelect(path, false)}
        onDoubleClick={() => onOpenFile(path)}
        onContextMenu={(e) => onContextMenu(e, path, name, false)}
        className={`w-full text-left flex items-center gap-1 px-2 py-0.5 text-[12px] rounded transition-colors ${
          isSelected
            ? "bg-accent/15 text-foreground"
            : "text-muted/60 hover:text-foreground hover:bg-card"
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
        title="Double-click to open · Right-click for options"
      >
        <div className="w-[11px] shrink-0" />
        <FileText size={13} className="shrink-0 text-muted/40" />
        <span className="truncate">{name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          onSelect(path, true);
          onToggle(path);
        }}
        onContextMenu={(e) => onContextMenu(e, path, name, true)}
        className={`w-full flex items-center gap-1 px-2 py-0.5 text-[12px] rounded transition-colors ${
          isSelected
            ? "bg-accent/15 text-foreground"
            : "text-muted hover:text-foreground hover:bg-card"
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${
            isOpen ? "rotate-90" : ""
          } text-muted/50`}
        />
        {isOpen ? (
          <FolderOpen size={13} className="shrink-0 text-accent/70" />
        ) : (
          <Folder size={13} className="shrink-0 text-muted/50" />
        )}
        <span className={`truncate ${isRoot ? "font-semibold" : ""}`}>
          {name}
        </span>
      </button>
      {isOpen && children && (
        <div>
          {children.map((entry) => (
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
