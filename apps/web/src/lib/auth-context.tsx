"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthState } from "@nestbrain/shared";

interface AuthContextValue {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  cancelSignIn: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_STATE: AuthState = { status: "signed-out" };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(DEFAULT_STATE);

  useEffect(() => {
    if (typeof window === "undefined" || !window.nestbrain) return;
    const auth = window.nestbrain.auth;
    let cancelled = false;

    auth.getState()
      .then((s) => { if (!cancelled) setState(s); })
      .catch(() => { /* keep default */ });

    const off = auth.onStateChanged((s) => setState(s));

    return () => { cancelled = true; off(); };
  }, []);

  const signIn = useCallback(async () => {
    if (!window.nestbrain) return;
    await window.nestbrain.auth.signIn();
  }, []);

  const signOut = useCallback(async () => {
    if (!window.nestbrain) return;
    await window.nestbrain.auth.signOut();
  }, []);

  const cancelSignIn = useCallback(async () => {
    if (!window.nestbrain) return;
    await window.nestbrain.auth.cancelSignIn();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, cancelSignIn }),
    [state, signIn, signOut, cancelSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
