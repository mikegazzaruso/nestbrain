export {};

import type { AuthState, SyncPreferences, SyncState } from "@nestbrain/shared";

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface CreateTerminalResult {
  id: string;
  cwd: string;
}

declare global {
  interface Window {
    nestbrain?: {
      isElectron: true;
      platform: NodeJS.Platform;
      getBootstrap: () => Promise<{
        nestBrainPath?: string;
        isElectron: true;
        platform: NodeJS.Platform;
      }>;
      selectDirectory: () => Promise<string | null>;
      setupNestBrain: (parentPath: string) => Promise<{ nestBrainPath: string }>;
      moveOrCreateNestBrain: (
        parentPath: string,
      ) => Promise<{ nestBrainPath: string; moved: boolean; created: boolean }>;
      onNestBrainMoved: (
        callback: (info: { nestBrainPath: string }) => void,
      ) => () => void;
      fs: {
        list: (dirPath: string) => Promise<FsEntry[]>;
        createDir: (dirPath: string) => Promise<{ ok: true; path: string }>;
        readFile: (filePath: string) => Promise<{
          content: string;
          size: number;
          binary: boolean;
          tooLarge: boolean;
        }>;
        writeFile: (
          filePath: string,
          content: string,
        ) => Promise<{ ok: true; size: number }>;
        delete: (targetPath: string) => Promise<{ ok: true }>;
        rename: (
          oldPath: string,
          newName: string,
        ) => Promise<{ ok: true; newPath: string }>;
        onChange: (callback: () => void) => () => void;
      };
      auth: {
        getState: () => Promise<AuthState>;
        signIn: () => Promise<void>;
        signOut: () => Promise<void>;
        cancelSignIn: () => Promise<void>;
        onStateChanged: (callback: (state: AuthState) => void) => () => void;
      };
      sync: {
        getState: () => Promise<SyncState | null>;
        setPreferences: (prefs: Partial<SyncPreferences>) => Promise<void>;
        syncNow: () => Promise<void>;
        cancel: () => Promise<void>;
        softDelete: (relPath: string) => Promise<void>;
        hardDelete: (relPath: string) => Promise<void>;
        onStateChanged: (callback: (state: SyncState) => void) => () => void;
      };
      terminal: {
        create: (opts: { cwd: string; cols?: number; rows?: number }) => Promise<CreateTerminalResult>;
        write: (id: string, data: string) => void;
        resize: (id: string, cols: number, rows: number) => void;
        kill: (id: string) => void;
        onData: (id: string, callback: (data: string) => void) => () => void;
        onExit: (id: string, callback: (code: number) => void) => () => void;
      };
      cli: {
        status: () => Promise<{
          supported: boolean;
          target: string | null;
          source: string;
          installed: boolean;
          stale: boolean;
        }>;
        install: () => Promise<{
          supported: boolean;
          target: string | null;
          source: string;
          installed: boolean;
          stale: boolean;
        }>;
        uninstall: () => Promise<{
          supported: boolean;
          target: string | null;
          source: string;
          installed: boolean;
          stale: boolean;
        }>;
      };
    };
  }
}
