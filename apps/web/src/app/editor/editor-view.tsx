"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageSupport } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  FileText,
  Save,
  X,
  AlertTriangle,
  Circle,
  Check,
} from "lucide-react";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number }
  | { kind: "error"; message: string };

// Resolves a language pack for the given filename using CodeMirror's
// language-data index (~100 languages). The pack is loaded lazily via
// dynamic import, so only the parser for the actual file is pulled in.
// Unknown extensions return null → editor opens the file as plain text.
async function loadLanguageFor(
  filename: string,
): Promise<LanguageSupport | null> {
  const desc =
    // Match by extension first (cheap)
    languages.find((l) =>
      l.extensions.some((ext) =>
        filename.toLowerCase().endsWith("." + ext.toLowerCase()),
      ),
    ) ??
    // Then by explicit filename (Makefile, Dockerfile, etc.)
    languages.find((l) =>
      l.filename?.test(filename.split("/").pop() ?? filename),
    );
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function EditorView() {
  const router = useRouter();
  const params = useSearchParams();
  const filePath = params.get("path") ?? "";
  const fileName = useMemo(
    () => filePath.split("/").pop() || filePath,
    [filePath],
  );

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [originalContent, setOriginalContent] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // Lazy-load the language pack for this file (syntax highlighting).
  // Unknown types keep langExt empty → plain-text editing still works.
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    loadLanguageFor(filePath).then((pack) => {
      if (cancelled) return;
      setLangExt(pack ? [pack] : []);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const dirty = state.kind === "ready" && content !== originalContent;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Load the file
  useEffect(() => {
    if (!filePath) {
      setState({ kind: "error", message: "No file path provided" });
      return;
    }
    if (typeof window === "undefined" || !window.nestbrain?.fs?.readFile) {
      setState({ kind: "error", message: "Editor requires the desktop app" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    window.nestbrain.fs
      .readFile(filePath)
      .then((res) => {
        if (cancelled) return;
        if (res.tooLarge) {
          setState({ kind: "tooLarge", size: res.size });
        } else if (res.binary) {
          setState({ kind: "binary", size: res.size });
        } else {
          setOriginalContent(res.content);
          setContent(res.content);
          setState({ kind: "ready", content: res.content });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to read file",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleSave = useCallback(async () => {
    if (state.kind !== "ready") return;
    if (!window.nestbrain?.fs?.writeFile) return;
    if (content === originalContent) return;
    setSaving(true);
    setError(null);
    try {
      await window.nestbrain.fs.writeFile(filePath, content);
      setOriginalContent(content);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }, [content, originalContent, filePath, state.kind]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  // Warn on browser/window close if dirty
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Guard client-side navigation via anchor clicks (sidebar Next.js <Link>s
  // don't fire beforeunload). Capture-phase click handler on document.
  useEffect(() => {
    if (!dirty) return;
    function onClickCapture(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      const currentFull =
        window.location.pathname + window.location.search;
      if (href === currentFull || href === window.location.pathname) return;
      const ok = window.confirm(
        `"${fileName}" has unsaved changes. Leave without saving?`,
      );
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [dirty, fileName]);

  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(
        `"${fileName}" has unsaved changes. Close without saving?`,
      );
      if (!ok) return;
    }
    router.push("/");
  }, [dirty, fileName, router]);

  const extensions = useMemo(() => langExt, [langExt]);

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-sidebar">
        <div className="flex items-center gap-2 px-4 py-2 border-r border-border bg-background min-w-0">
          <FileText size={13} className="shrink-0 text-muted/50" />
          <span className="text-[12px] text-foreground truncate" title={filePath}>
            {fileName}
          </span>
          {dirty && (
            <span title="Unsaved changes" className="flex shrink-0">
              <Circle size={8} className="text-accent fill-accent" />
            </span>
          )}
          <button
            onClick={handleClose}
            className="ml-2 text-muted/40 hover:text-foreground transition-colors"
            title={dirty ? "Close (unsaved changes)" : "Close"}
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 px-4">
          {error && (
            <span className="flex items-center gap-1.5 text-[11px] text-red-400">
              <AlertTriangle size={11} />
              {error}
            </span>
          )}
          {savedFlash && (
            <span className="flex items-center gap-1.5 text-[11px] text-green-400/80">
              <Check size={11} />
              Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-background text-[11px] font-medium rounded-md hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Save (⌘S)"
          >
            <Save size={11} />
            Save
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {state.kind === "loading" && (
          <div className="h-full flex items-center justify-center text-muted/50 text-sm">
            Loading…
          </div>
        )}
        {state.kind === "error" && (
          <div className="h-full flex items-center justify-center text-red-400/80 text-sm">
            {state.message}
          </div>
        )}
        {state.kind === "binary" && (
          <div className="h-full flex flex-col items-center justify-center text-muted/60 text-sm gap-2">
            <AlertTriangle size={20} className="text-muted/40" />
            <p>Binary file — not editable</p>
            <p className="text-[11px] text-muted/40">{formatSize(state.size)}</p>
          </div>
        )}
        {state.kind === "tooLarge" && (
          <div className="h-full flex flex-col items-center justify-center text-muted/60 text-sm gap-2">
            <AlertTriangle size={20} className="text-muted/40" />
            <p>File too large to edit ({formatSize(state.size)})</p>
            <p className="text-[11px] text-muted/40">
              The in-app editor is capped at 1 MB.
            </p>
          </div>
        )}
        {state.kind === "ready" && (
          <CodeMirror
            ref={cmRef}
            value={content}
            onChange={setContent}
            theme={oneDark}
            extensions={extensions}
            height="100%"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
            }}
            style={{ height: "100%", fontSize: 13 }}
          />
        )}
      </div>
    </div>
  );
}
