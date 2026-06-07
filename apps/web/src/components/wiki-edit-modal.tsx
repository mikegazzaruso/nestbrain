"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdown } from "@codemirror/lang-markdown";
import {
  Pencil,
  Sparkles,
  Loader2,
  Save,
  X,
  Wand2,
  AlertTriangle,
} from "lucide-react";

interface WikiEditModalProps {
  isOpen: boolean;
  path: string;
  initialContent: string;
  onClose: () => void;
  onSaved: (content: string) => void;
}

type Mode = "manual" | "ai";

export function WikiEditModal({ isOpen, path, initialContent, onClose, onSaved }: WikiEditModalProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<Mode>("manual");
  const [instruction, setInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setContent(initialContent);
      setMode("manual");
      setInstruction("");
      setError(null);
      setAiNote(null);
    }
  }, [isOpen, initialContent]);

  useEffect(() => {
    if (mode === "ai") setTimeout(() => textareaRef.current?.focus(), 50);
  }, [mode]);

  const dirty = content !== initialContent;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !aiBusy && !saving) attemptClose();
    }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, aiBusy, saving, dirty]);

  if (!isOpen || typeof document === "undefined") return null;

  function attemptClose() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }

  async function runAi() {
    const ins = instruction.trim();
    if (!ins) return;
    setAiBusy(true);
    setError(null);
    setAiNote(null);
    try {
      const res = await fetch("/api/wiki/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content, instruction: ins }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI edit failed");
      setContent(data.content ?? content);
      setMode("manual");
      setAiNote("AI rewrote the draft — review it below, then Save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI edit failed");
    }
    setAiBusy(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(content);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  const title = path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ");

  return createPortal(
    <div
      className="z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh" }}
      onClick={attemptClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-[92%] max-w-4xl h-[82vh] flex flex-col overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center shadow-lg shadow-accent/20 shrink-0">
              <Pencil size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold capitalize truncate">{title}</h3>
              <p className="text-[11px] text-muted/40 truncate font-mono">{path}</p>
            </div>
          </div>
          <button onClick={attemptClose} className="text-muted/40 hover:text-muted transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
          <TabPill active={mode === "manual"} onClick={() => setMode("manual")} icon={<Pencil size={13} />} label="Manual" />
          <TabPill active={mode === "ai"} onClick={() => setMode("ai")} icon={<Sparkles size={13} />} label="Ask AI" />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4">
          {mode === "manual" ? (
            <div className="h-full rounded-xl border border-border overflow-hidden">
              <CodeMirror
                value={content}
                onChange={setContent}
                theme={oneDark}
                extensions={[markdown()]}
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
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <label className="block text-[11px] text-muted/70 uppercase tracking-wider mb-2">
                Tell the AI what to fix
              </label>
              <textarea
                ref={textareaRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={aiBusy}
                placeholder={
                  "e.g. “NestBrain is one of our projects — analyze it and correct this page: it’s not about Google Drive Sync, that’s just one feature; describe what NestBrain actually is.”\n\nor: “NestBrain is open source — go to its GitHub repo, analyze it, and fix this article.”"
                }
                className="flex-1 w-full resize-none px-4 py-3 bg-background border border-border rounded-xl text-sm text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 leading-relaxed"
              />
              <div className="flex items-center justify-between mt-3">
                <p className="text-[11px] text-muted/40 flex items-center gap-1.5 max-w-[60%]">
                  <Sparkles size={11} className="shrink-0" />
                  The AI can read your local projects and the web to ground the fix. This can take a minute.
                </p>
                <button
                  onClick={runAi}
                  disabled={aiBusy || !instruction.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-accent to-purple-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-accent/20"
                >
                  {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {aiBusy ? "Working…" : "Generate correction"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border shrink-0">
          <div className="text-[11px] min-w-0 truncate">
            {error ? (
              <span className="flex items-center gap-1.5 text-red-400">
                <AlertTriangle size={12} /> {error}
              </span>
            ) : aiNote ? (
              <span className="text-accent flex items-center gap-1.5">
                <Sparkles size={12} /> {aiNote}
              </span>
            ) : (
              <span className="text-muted/40">
                {dirty ? "Unsaved changes" : "Hand edits may be overwritten on the next compile."}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={attemptClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-muted hover:text-foreground border border-border rounded-lg hover:bg-card-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || aiBusy || !dirty}
              className="px-5 py-2 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active ? "bg-accent/10 text-accent" : "text-muted/60 hover:text-foreground hover:bg-card/60"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
