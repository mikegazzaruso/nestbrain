"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Enterprise add-on modules enabled for this seat (e.g. "dev", "anatomize").
// Enabled = compiled into the binary AND licensed via the org's Team Server.
// Refreshed on team state changes so a central module purchase lights up the
// UI without a restart. Outside Electron (plain `nestbrain serve`) the bridge
// is absent → no modules, core-only UI.

interface ModulesState {
  has: (id: string) => boolean;
  modules: string[];
  loaded: boolean;
}

const ModulesContext = createContext<ModulesState>({ has: () => false, modules: [], loaded: false });

export function ModulesProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const mn = typeof window !== "undefined" ? window.nestbrain : undefined;
    if (!mn?.modules) {
      setLoaded(true);
      return;
    }
    let alive = true;
    const refresh = () =>
      mn.modules
        .get()
        .then((m) => {
          if (alive) {
            setModules(m);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
    refresh();
    const off = mn.team?.onStateChanged?.(() => refresh());
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  return (
    <ModulesContext.Provider value={{ has: (id) => modules.includes(id), modules, loaded }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  return useContext(ModulesContext);
}
