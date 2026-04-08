"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileUp,
  FileText,
} from "lucide-react";

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

export default function IngestPage() {
  const [source, setSource] = useState("");
  const [entries, setEntries] = useState<IngestEntry[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sources, setSources] = useState<IngestedSource[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSources();
  }, []);

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
    await doIngest(src, async () => {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src }),
      });
      return res.json();
    });
  }

  async function doIngest(label: string, fetcher: () => Promise<unknown>) {
    setIngesting(true);
    const idx = entries.length;
    setEntries((prev) => [...prev, { source: label, status: "pending" }]);

    try {
      const data = (await fetcher()) as Record<string, unknown>;
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
      const formData = new FormData();
      formData.append("file", file);
      await doIngest(`📄 ${file.name}`, async () => {
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
    </div>
  );
}
