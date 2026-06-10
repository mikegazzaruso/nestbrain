"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

// VS Code-style update toast: appears bottom-right when a new version has been
// downloaded in the background. "Restart now" installs immediately; "Later"
// dismisses — the update still installs automatically on next quit.
export function UpdateToast() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const updates = typeof window !== "undefined" ? window.nestbrain?.updates : null;
    if (!updates) return;
    updates.getState().then(setState).catch(() => {});
    const off = updates.onStateChanged(setState);
    return () => off?.();
  }, []);

  if (!state || state.status !== "ready" || !state.available) return null;
  if (dismissed === state.available) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 rounded-xl border border-accent/30 bg-card shadow-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <RefreshCw size={14} className="text-accent" />
        <p className="text-sm font-medium">Update ready</p>
      </div>
      <p className="text-[12px] text-muted/70 leading-relaxed mb-3">
        NestBrain {state.available} has been downloaded. Restart to apply it now, or it will
        install automatically the next time you quit.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void window.nestbrain?.updates.restart()}
          className="px-3 py-1.5 rounded-lg bg-accent text-background text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          Restart now
        </button>
        <button
          onClick={() => setDismissed(state.available ?? null)}
          className="px-3 py-1.5 rounded-lg text-xs text-muted/70 hover:text-foreground transition-colors"
        >
          Later
        </button>
      </div>
    </div>
  );
}
