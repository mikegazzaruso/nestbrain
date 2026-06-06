"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface EditorTabsState {
  tabs: string[]; // absolute file paths, insertion order
  activePath: string | null;
  /**
   * Mark a file as open + active. If it's already in the list, just
   * promote it to active without changing order (VSCode style — opening
   * the same file again doesn't shuffle the tab strip).
   */
  openTab: (path: string) => void;
  closeTab: (path: string) => string | null; // returns the next active path, or null
  setActive: (path: string) => void;
  closeOthers: (keepPath: string) => void;
  closeAll: () => void;
}

const EditorTabsContext = createContext<EditorTabsState>({
  tabs: [],
  activePath: null,
  openTab: () => {},
  closeTab: () => null,
  setActive: () => {},
  closeOthers: () => {},
  closeAll: () => {},
});

const STORAGE_KEY = "nestbrain-editor-tabs";

export function EditorTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  // Hydrate from sessionStorage on first mount. We use sessionStorage
  // (not localStorage) so closing the app forgets the open files — the
  // user starts each session fresh, same as VSCode's default.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { tabs: string[]; activePath: string | null };
      if (Array.isArray(parsed.tabs)) {
        setTabs(parsed.tabs.filter((p) => typeof p === "string" && p));
        setActivePath(parsed.activePath ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activePath }));
    } catch {
      /* ignore */
    }
  }, [tabs, activePath]);

  const openTab = useCallback((path: string) => {
    if (!path) return;
    setTabs((cur) => (cur.includes(path) ? cur : [...cur, path]));
    setActivePath(path);
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      let nextActive: string | null = null;
      setTabs((cur) => {
        const idx = cur.indexOf(path);
        if (idx < 0) return cur;
        const next = cur.filter((p) => p !== path);
        // If we just closed the active tab, prefer the right neighbor,
        // falling back to the left one. That matches VSCode's behavior.
        if (activePath === path) {
          nextActive = next[idx] ?? next[idx - 1] ?? null;
        } else {
          nextActive = activePath;
        }
        return next;
      });
      setActivePath(nextActive);
      return nextActive;
    },
    [activePath],
  );

  const setActive = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const closeOthers = useCallback((keepPath: string) => {
    setTabs((cur) => (cur.includes(keepPath) ? [keepPath] : cur));
    setActivePath(keepPath);
  }, []);

  const closeAll = useCallback(() => {
    setTabs([]);
    setActivePath(null);
  }, []);

  return (
    <EditorTabsContext.Provider
      value={{ tabs, activePath, openTab, closeTab, setActive, closeOthers, closeAll }}
    >
      {children}
    </EditorTabsContext.Provider>
  );
}

export function useEditorTabs() {
  return useContext(EditorTabsContext);
}
