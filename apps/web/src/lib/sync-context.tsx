"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SyncPreferences, SyncState } from "@nestbrain/shared";
import { DEFAULT_SYNC_PREFS } from "@nestbrain/shared";

interface SyncContextValue {
  state: SyncState;
  /** Available = window.nestbrain is present (Electron). */
  available: boolean;
  setPreferences: (prefs: Partial<SyncPreferences>) => Promise<void>;
  syncNow: () => Promise<void>;
  cancel: () => Promise<void>;
}

const DEFAULT_STATE: SyncState = {
  status: "disabled",
  prefs: DEFAULT_SYNC_PREFS,
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SyncState>(DEFAULT_STATE);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain) return;
    setAvailable(true);
    const sync = window.nestbrain.sync;
    let cancelled = false;

    sync.getState()
      .then((s) => { if (!cancelled && s) setState(s); })
      .catch(() => { /* keep default */ });

    const off = sync.onStateChanged((s) => setState(s));
    return () => { cancelled = true; off(); };
  }, []);

  const setPreferences = useCallback(async (prefs: Partial<SyncPreferences>) => {
    if (!window.nestbrain) return;
    await window.nestbrain.sync.setPreferences(prefs);
  }, []);

  const syncNow = useCallback(async () => {
    if (!window.nestbrain) return;
    await window.nestbrain.sync.syncNow();
  }, []);

  const cancel = useCallback(async () => {
    if (!window.nestbrain) return;
    await window.nestbrain.sync.cancel();
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ state, available, setPreferences, syncNow, cancel }),
    [state, available, setPreferences, syncNow, cancel],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
