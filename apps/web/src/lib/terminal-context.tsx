"use client";

import {
  createContext,
  useCallback,
  useContext,
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
