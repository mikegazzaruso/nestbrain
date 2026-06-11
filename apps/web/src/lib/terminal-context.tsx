"use client";

import { createContext, useContext, type ReactNode } from "react";

// Open-core stub — the real terminal session manager ships with the Dev
// module (private nestbrain-modules repo) and replaces this file in official
// builds. Public source builds keep the same API surface as inert no-ops so
// every consumer compiles unchanged.

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
  return <>{children}</>;
}

export function useTerminal() {
  return useContext(TerminalContext);
}
