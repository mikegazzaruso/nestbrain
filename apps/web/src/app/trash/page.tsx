"use client";

// Trash — soft-deleted files quarantined under <workspace>/.trash/ by the
// sync engines (team + Drive). List, restore, or empty. Electron-only.

import { useCallback, useEffect, useState } from "react";
import { Trash2, RotateCcw, Loader2, FileX2 } from "lucide-react";

interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  size: number;
  deletedAt: number;
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (typeof window === "undefined" || !window.nestbrain?.trash) {
      setItems([]);
      return;
    }
    try {
      setItems(await window.nestbrain.trash.list());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item: TrashItem) => {
    setBusy(item.id);
    try {
      const r = await window.nestbrain!.trash.restore(item.id);
      setToast(`Restored to ${r.restoredTo.split(/[/\\]/).slice(-2).join("/")}`);
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  const empty = async () => {
    if (!window.confirm("Permanently delete everything in the trash? This cannot be undone.")) return;
    setBusy("empty");
    try {
      await window.nestbrain!.trash.empty();
      setToast("Trash emptied.");
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Empty failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-10">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <Trash2 size={22} className="text-accent" />
          <h1 className="text-xl font-semibold">Trash</h1>
        </div>
        {items && items.length > 0 && (
          <button
            onClick={() => void empty()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 text-xs font-medium text-red-400/80 hover:text-red-400 border border-red-400/30 hover:border-red-400/50 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
            Empty trash
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-8">
        Files removed by sync are kept here so nothing is ever lost. Restore them to their original
        location, or empty the trash to reclaim space.
      </p>

      {items === null ? (
        <div className="flex items-center gap-2 text-muted text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 flex flex-col items-center text-center">
          <FileX2 size={28} className="text-muted/40 mb-3" />
          <p className="text-sm text-muted">The trash is empty.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono truncate" title={item.originalPath}>
                  {item.originalPath}
                </p>
                <p className="text-[11px] text-muted/60">
                  {human(item.size)}
                  {item.deletedAt ? ` · deleted ${new Date(item.deletedAt).toLocaleString()}` : ""}
                </p>
              </div>
              <button
                onClick={() => void restore(item)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover border border-accent/30 hover:border-accent/50 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 shrink-0"
              >
                {busy === item.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] bg-card border border-border rounded-xl px-4 py-2.5 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
