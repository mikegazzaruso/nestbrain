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
  const mountedRef = useRef(true);

  function startPolling() {
    if (pollingRef.current) return; // already polling
    pollingRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await fetch("/api/compile/status");
        const data = await res.json();
        if (!mountedRef.current) return;

        setStatus(data.status);
        setMessage(data.message ?? "");
        setPhase(data.phase ?? "");

        // Stop polling when not compiling anymore
        if (data.status !== "compiling" && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch {
        // ignore network errors
      }
    }, 800);
  }

  // On mount: check if already compiling, start polling if so
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/compile/status");
        const data = await res.json();
        if (!mountedRef.current) return;
        setStatus(data.status);
        setMessage(data.message ?? "");
        setPhase(data.phase ?? "");
        if (data.status === "compiling") {
          startPolling();
        }
      } catch { /* */ }
    })();

    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

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
    } catch { /* */ }

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
