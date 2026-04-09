"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileUp,
  FileText,
  ArrowUp,
  Settings as SettingsIcon,
} from "lucide-react";
import { useCompile } from "@/lib/compile-context";

interface IngestEntry {
  source: string;
  status: "pending" | "success" | "error";
  result?: { filePath: string; title: string; sourceType: string };
  error?: string;
}

interface IngestedSource {
  fileName: string;
  title: string;
  sourceType: string;
  ingestedAt: string;
}

interface DuplicateInfo {
  source: string;
  existingTitle: string;
  retryFn: () => Promise<void>;
}

export default function IngestPage() {
  const [source, setSource] = useState("");
  const [entries, setEntries] = useState<IngestEntry[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sources, setSources] = useState<IngestedSource[]>([]);
  const [showCompileToast, setShowCompileToast] = useState(false);
  const [autoCompile, setAutoCompile] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicateInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { compile, status: compileStatus } = useCompile();

  useEffect(() => {
    loadSources();
    loadAutoCompileSetting();
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  async function loadAutoCompileSetting() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setAutoCompile(data.autoCompile ?? false);
    } catch { /* ignore */ }
  }

  function triggerPostIngest() {
    if (autoCompile) {
      if (compileStatus !== "compiling") compile();
    } else {
      setShowCompileToast(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setShowCompileToast(false), 6000);
    }
  }

  async function loadSources() {
    try {
      const res = await fetch("/api/ingest");
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch {
      // ignore
    }
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!source.trim() || ingesting) return;

    const src = source.trim();
    setSource("");
    await doIngest(src, (skipDup) => fetchIngestUrl(src, skipDup));
  }

  async function fetchIngestUrl(src: string, skipDuplicateCheck: boolean) {
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src, skipDuplicateCheck }),
    });
    return res.json();
  }

  async function doIngest(label: string, fetcher: (skipDup: boolean) => Promise<Record<string, unknown>>) {
    setIngesting(true);
    const idx = entries.length;
    setEntries((prev) => [...prev, { source: label, status: "pending" }]);

    try {
      const data = await fetcher(false);

      if (data.duplicate) {
        // Remove pending entry and show duplicate dialog
        setEntries((prev) => prev.filter((_, i) => i !== idx));
        setIngesting(false);
        setDuplicatePrompt({
          source: label,
          existingTitle: data.existingTitle as string,
          retryFn: async () => {
            setDuplicatePrompt(null);
            await doIngest(label, () => fetcher(true));
          },
        });
        return;
      }

      if (data.error) {
        setEntries((prev) =>
          prev.map((e, i) =>
            i === idx
              ? { ...e, status: "error", error: data.error as string }
              : e
          )
        );
      } else {
        setEntries((prev) =>
          prev.map((e, i) =>
            i === idx
              ? {
                  ...e,
                  status: "success",
                  result: data as IngestEntry["result"],
                }
              : e
          )
        );
        loadSources();
        triggerPostIngest();
      }
    } catch {
      setEntries((prev) =>
        prev.map((e, i) =>
          i === idx ? { ...e, status: "error", error: "Network error" } : e
        )
      );
    }
    setIngesting(false);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      await doIngest(`📄 ${file.name}`, async (skipDup) => {
        const formData = new FormData();
        formData.append("file", file);
        if (skipDup) formData.append("skipDuplicateCheck", "true");
        const res = await fetch("/api/ingest/upload", {
          method: "POST",
          body: formData,
        });
        return res.json();
      });
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Ingest</h1>
        <p className="text-sm text-muted mb-8">
          Add sources to your knowledge base. Paste a URL, or upload files.
        </p>

        {/* URL input */}
        <form onSubmit={handleIngest} className="mb-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Globe
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="URL (web, GitHub, arXiv, YouTube, RSS) or file path"
                className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
                disabled={ingesting}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={ingesting || !source.trim()}
              className="px-5 py-3 bg-accent text-background text-sm font-medium rounded-xl hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Upload size={16} />
              Ingest
            </button>
          </div>
        </form>

        {/* File upload drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-8 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all text-center ${
            dragging
              ? "border-accent bg-accent/5"
              : "border-border hover:border-accent/40 hover:bg-card"
          }`}
        >
          <FileUp
            size={32}
            className={`mx-auto mb-3 transition-colors ${
              dragging ? "text-accent" : "text-muted/40"
            }`}
          />
          <p className="text-sm text-muted mb-1">
            Drop files here or{" "}
            <span className="text-accent">click to browse</span>
          </p>
          <p className="text-xs text-muted/60">Supports .md, .pdf files</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.pdf,.txt"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </div>

        {/* Current session activity */}
        {entries.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
              Activity
            </h2>
            {entries.map((entry, i) => (
              <div
                key={i}
                className="p-4 rounded-xl border border-border bg-card flex items-start gap-3"
              >
                {entry.status === "pending" && (
                  <Loader2
                    size={16}
                    className="text-accent mt-0.5 animate-spin shrink-0"
                  />
                )}
                {entry.status === "success" && (
                  <CheckCircle
                    size={16}
                    className="text-green-500 mt-0.5 shrink-0"
                  />
                )}
                {entry.status === "error" && (
                  <AlertCircle
                    size={16}
                    className="text-red-400 mt-0.5 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm truncate">{entry.source}</p>
                  {entry.result && (
                    <p className="text-xs text-muted mt-1">
                      {entry.result.title} ({entry.result.sourceType}) →{" "}
                      {entry.result.filePath}
                    </p>
                  )}
                  {entry.error && (
                    <p className="text-xs text-red-400 mt-1">{entry.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* All ingested sources (persisted) */}
        {sources.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
              Ingested Sources ({sources.length})
            </h2>
            {sources.map((src) => (
              <div
                key={src.fileName}
                className="p-4 rounded-xl border border-border bg-card flex items-start gap-3"
              >
                <FileText
                  size={16}
                  className="text-accent mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm">{src.title}</p>
                  <p className="text-xs text-muted mt-1">
                    {src.sourceType} · {src.ingestedAt} · {src.fileName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Duplicate source dialog */}
      {duplicatePrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-toast-in">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle size={20} className="text-amber-400 shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">
                Duplicate source
              </h3>
            </div>
            <p className="text-xs text-muted/70 leading-relaxed mb-5">
              <span className="font-medium text-foreground">&ldquo;{duplicatePrompt.existingTitle}&rdquo;</span>{" "}
              has already been ingested. Do you want to add it again?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDuplicatePrompt(null)}
                className="px-4 py-2 text-xs text-muted hover:text-foreground border border-border rounded-lg hover:bg-card-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => duplicatePrompt.retryFn()}
                className="px-4 py-2 text-xs bg-accent text-background font-medium rounded-lg hover:bg-accent-hover transition-colors"
              >
                Add anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compile reminder toast */}
      {showCompileToast && (
        <>
          {/* Arrow pointing to compile button in sidebar */}
          <div className="fixed left-[60px] top-[88px] z-[60] animate-compile-arrow">
            <div className="flex items-center gap-1">
              <ArrowUp
                size={28}
                className="text-accent -rotate-90 animate-pulse"
                strokeWidth={3}
              />
            </div>
          </div>

          {/* Toast notification */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-toast-in">
            <div className="bg-card border border-border rounded-xl shadow-lg px-5 py-4 max-w-md flex items-start gap-3">
              <AlertCircle size={18} className="text-accent shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-foreground font-medium mb-1">
                  Don&apos;t forget to compile!
                </p>
                <p className="text-muted/70 text-xs leading-relaxed">
                  Click the compile button in the sidebar to process your new sources. Or enable auto-compile in{" "}
                  <button
                    onClick={() => router.push("/settings")}
                    className="text-accent hover:underline font-medium inline-flex items-center gap-0.5"
                  >
                    <SettingsIcon size={11} />
                    Settings
                  </button>
                  .
                </p>
              </div>
              <button
                onClick={() => setShowCompileToast(false)}
                className="text-muted/40 hover:text-muted text-lg leading-none shrink-0 ml-2"
              >
                &times;
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
