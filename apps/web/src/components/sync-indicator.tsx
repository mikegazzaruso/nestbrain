"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useSync } from "@/lib/sync-context";
import { useT, type AppDict } from "@/lib/app-i18n";

// Status-bar sync widget. Click it to open a popover with details + Sync now.
export function SyncIndicator() {
  const { t } = useT();
  const { state, available, syncNow } = useSync();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!available) return null;

  const { status, progress, error, lastSyncAt, prefs } = state;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  const busy = status === "scanning" || status === "syncing";

  // Icon + accent color per status.
  let Icon = Cloud;
  let tone = "text-muted/70";
  if (status === "disabled") { Icon = CloudOff; tone = "text-muted/40"; }
  else if (status === "error") { Icon = AlertCircle; tone = "text-red-400"; }
  else if (busy) { Icon = RefreshCw; tone = "text-accent"; }
  else if (lastSyncAt) { Icon = CheckCircle2; tone = "text-green-500/80"; }

  return (
    <div ref={ref} className="relative h-full flex items-stretch">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 h-full hover:bg-card transition-colors ${tone}`}
        title={titleFor(t.tree.sync, status, lastSyncAt, error)}
      >
        <Icon size={12} className={busy ? "animate-spin" : ""} />
        {busy && progress ? (
          <>
            <span className="font-mono">{pct}%</span>
            <span className="text-muted/60 truncate max-w-[160px]">
              {progress.currentFile ?? ""}
            </span>
          </>
        ) : (
          <span>{labelFor(t.tree.sync, status, prefs.enabled)}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-7 right-0 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
            <Icon size={14} className={tone} />
            <span className="text-xs font-medium">{titleFor(t.tree.sync, status, lastSyncAt, error)}</span>
          </div>

          {busy && progress && (
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] text-muted/60 mb-1.5">
                {t.tree.sync.filesProgress(progress.done, progress.total)}
                {progress.skipped > 0 && t.tree.sync.skipped(progress.skipped)}
              </div>
              <div className="h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {progress.currentFile && (
                <div className="mt-2 text-[10px] font-mono text-muted/60 truncate">
                  {progress.currentFile}
                </div>
              )}
            </div>
          )}

          {status === "error" && error && (
            <div className="px-3 py-2.5 border-b border-border text-[11px] text-red-400 leading-relaxed">
              {error}
            </div>
          )}

          <div className="px-3 py-2.5 flex items-center gap-2">
            <button
              onClick={async () => { setOpen(false); await syncNow(); }}
              disabled={!prefs.enabled || busy}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background hover:bg-card-hover text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {t.tree.sync.syncNow}
            </button>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="h-8 px-3 flex items-center justify-center rounded-md text-xs text-muted/70 hover:text-foreground hover:bg-card-hover transition-colors"
            >
              {t.tree.sync.settings}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

type SyncDict = AppDict["tree"]["sync"];

function labelFor(d: SyncDict, status: import("@nestbrain/shared").SyncStatus, enabled: boolean): string {
  if (status === "disabled") return enabled ? d.paused : d.off;
  if (status === "error") return d.error;
  if (status === "scanning") return d.scanning;
  if (status === "syncing") return d.syncing;
  return d.sync;
}

function titleFor(
  d: SyncDict,
  status: import("@nestbrain/shared").SyncStatus,
  lastSyncAt: number | undefined,
  error: string | undefined,
): string {
  if (status === "disabled") return d.disabledTitle;
  if (status === "error") return error ?? d.error;
  if (status === "scanning") return d.scanningWorkspace;
  if (status === "syncing") return d.inProgress;
  if (lastSyncAt) return d.lastSync(new Date(lastSyncAt).toLocaleString());
  return d.idle;
}
