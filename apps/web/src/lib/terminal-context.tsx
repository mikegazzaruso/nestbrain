"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

export interface TerminalSession {
  id: string;
  cwd: string;
  label: string;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeId: string | null;
  panelOpen: boolean;
  openTerminal: (cwd: string, label: string) => Promise<void>;
  /**
   * Spawn a new terminal tab next to the existing ones. Clones the cwd of
   * the currently-active session when there is one (the "new shell, same
   * dir I'm in" VSCode/iTerm gesture); otherwise falls back to the
   * NestBrain workspace root.
   */
  newTerminal: () => Promise<void>;
  setActive: (id: string) => void;
  closeTerminal: (id: string) => void;
  togglePanel: () => void;
  toggleOrOpen: () => Promise<void>;
}

const TerminalContext = createContext<TerminalState>({
  sessions: [],
  activeId: null,
  panelOpen: false,
  openTerminal: async () => {},
  newTerminal: async () => {},
  setActive: () => {},
  closeTerminal: () => {},
  togglePanel: () => {},
  toggleOrOpen: async () => {},
});

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const openTerminal = useCallback(async (cwd: string, label: string) => {
    if (typeof window === "undefined" || !window.nestbrain) return;
    const { id } = await window.nestbrain.terminal.create({
      cwd,
      cols: 100,
      rows: 24,
    });
    const session: TerminalSession = { id, cwd, label };
    setSessions((s) => [...s, session]);
    setActiveId(id);
    setPanelOpen(true);
  }, []);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const closeTerminal = useCallback(
    (id: string) => {
      if (typeof window !== "undefined" && window.nestbrain) {
        window.nestbrain.terminal.kill(id);
      }
      setSessions((s) => {
        const next = s.filter((x) => x.id !== id);
        if (next.length === 0) setPanelOpen(false);
        return next;
      });
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const remaining = sessions.filter((x) => x.id !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
    },
    [sessions],
  );

  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);

  // Surface the active terminal's cwd to the sidebar branch indicator so it
  // can follow whichever project the user is working in — VSCode-style.
  // Fires on activeId change AND on initial mount, so opening NestBrain on
  // a session-restored terminal still updates the chip.
  useEffect(() => {
    if (!activeId) return;
    const active = sessions.find((s) => s.id === activeId);
    if (!active) return;
    window.dispatchEvent(
      new CustomEvent("nestbrain:terminal-focus", {
        detail: { cwd: active.cwd },
      }),
    );
  }, [activeId, sessions]);

  const newTerminal = useCallback(async () => {
    if (typeof window === "undefined" || !window.nestbrain) return;
    // Clone the active session's cwd so "+" lands the new shell next to where
    // the user is already working. Number the label to avoid collisions in the
    // tab bar (the label is purely cosmetic — sessions are keyed by id).
    let cwd: string;
    const active = sessions.find((s) => s.id === activeId);
    if (active) {
      cwd = active.cwd;
    } else {
      try {
        const bootstrap = await window.nestbrain.getBootstrap();
        cwd = bootstrap.nestBrainPath || process.env.HOME || "/";
      } catch {
        cwd = "/";
      }
    }
    const baseName = cwd.split("/").filter(Boolean).pop() || "shell";
    const dupCount = sessions.filter((s) => s.label.startsWith(baseName)).length;
    const label = dupCount === 0 ? baseName : `${baseName} (${dupCount + 1})`;
    await openTerminal(cwd, label);
  }, [sessions, activeId, openTerminal]);

  // Smart toggle: if there are sessions, just show/hide the panel.
  // If there are none, spawn a new terminal at the NestBrain root.
  const toggleOrOpen = useCallback(async () => {
    if (sessions.length > 0) {
      setPanelOpen((p) => !p);
      return;
    }
    if (typeof window === "undefined" || !window.nestbrain) return;
    try {
      const bootstrap = await window.nestbrain.getBootstrap();
      const cwd = bootstrap.nestBrainPath || process.env.HOME || "/";
      await openTerminal(cwd, "NestBrain");
    } catch { /* ignore */ }
  }, [sessions.length, openTerminal]);

  return (
    <TerminalContext.Provider
      value={{
        sessions,
        activeId,
        panelOpen,
        openTerminal,
        newTerminal,
        setActive,
        closeTerminal,
        togglePanel,
        toggleOrOpen,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  return useContext(TerminalContext);
}
