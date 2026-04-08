"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type CompileStatus = "idle" | "compiling" | "success" | "error";

interface CompileState {
  status: CompileStatus;
  message: string;
  phase: string;
  compile: (force?: boolean) => Promise<void>;
}

const CompileContext = createContext<CompileState>({
  status: "idle",
  message: "",
  phase: "",
  compile: async () => {},
});

export function CompileProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<CompileStatus>("idle");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/compile/status");
      const data = await res.json();
      setStatus(data.status);
      setMessage(data.message ?? "");
      setPhase(data.phase ?? "");

      if (data.status !== "compiling") {
        stopPolling();
      }
    } catch {
      // ignore
    }
  }, [stopPolling]);

  // Sync state on mount
  useEffect(() => {
    pollStatus().then(() => {
      // If already compiling when page loads, start polling
      if (status === "compiling" && !pollingRef.current) {
        pollingRef.current = setInterval(pollStatus, 1000);
      }
    });
    return stopPolling;
  }, []);

  function startPolling() {
    stopPolling();
    pollingRef.current = setInterval(pollStatus, 1000);
  }

  const compile = useCallback(async (force?: boolean) => {
    if (status === "compiling") return;

    setStatus("compiling");
    setMessage("Starting...");
    setPhase("Initializing");

    try {
      await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
    } catch {
      // ignore
    }

    startPolling();
  }, [status]);

  return (
    <CompileContext.Provider value={{ status, message, phase, compile }}>
      {children}
    </CompileContext.Provider>
  );
}

export function useCompile() {
  return useContext(CompileContext);
}
