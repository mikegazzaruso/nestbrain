export {};

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
    mindnest?: {
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
      terminal: {
        create: (opts: { cwd: string; cols?: number; rows?: number }) => Promise<CreateTerminalResult>;
        write: (id: string, data: string) => void;
        resize: (id: string, cols: number, rows: number) => void;
        kill: (id: string) => void;
        onData: (id: string, callback: (data: string) => void) => () => void;
        onExit: (id: string, callback: (code: number) => void) => () => void;
      };
    };
  }
}
