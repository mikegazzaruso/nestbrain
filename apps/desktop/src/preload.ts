import { contextBridge, ipcRenderer } from "electron";

// Mark HTML element so web UI can adjust for native chrome
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("is-desktop");
  if (process.platform === "darwin") {
    document.documentElement.classList.add("is-desktop-mac");
  }
});

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface CreateTerminalResult {
  id: string;
  cwd: string;
}

contextBridge.exposeInMainWorld("mindnest", {
  isElectron: true,
  platform: process.platform,

  getBootstrap: () => ipcRenderer.invoke("mindnest:getBootstrap"),
  selectDirectory: () => ipcRenderer.invoke("mindnest:selectDirectory"),
  setupNestBrain: (parentPath: string) =>
    ipcRenderer.invoke("mindnest:setupNestBrain", parentPath),
  moveOrCreateNestBrain: (parentPath: string) =>
    ipcRenderer.invoke("mindnest:moveOrCreateNestBrain", parentPath),
  onNestBrainMoved: (callback: (info: { nestBrainPath: string }) => void) => {
    const handler = (_e: unknown, info: { nestBrainPath: string }) =>
      callback(info);
    ipcRenderer.on("mindnest:nestBrainMoved", handler);
    return () => ipcRenderer.off("mindnest:nestBrainMoved", handler);
  },

  // File system
  fs: {
    list: (dirPath: string): Promise<FsEntry[]> =>
      ipcRenderer.invoke("mindnest:fs:list", dirPath),
    createDir: (dirPath: string): Promise<{ ok: true; path: string }> =>
      ipcRenderer.invoke("mindnest:fs:createDir", dirPath),
    readFile: (filePath: string): Promise<{
      content: string;
      size: number;
      binary: boolean;
      tooLarge: boolean;
    }> => ipcRenderer.invoke("mindnest:fs:readFile", filePath),
    writeFile: (
      filePath: string,
      content: string,
    ): Promise<{ ok: true; size: number }> =>
      ipcRenderer.invoke("mindnest:fs:writeFile", filePath, content),
    delete: (targetPath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("mindnest:fs:delete", targetPath),
    rename: (
      oldPath: string,
      newName: string,
    ): Promise<{ ok: true; newPath: string }> =>
      ipcRenderer.invoke("mindnest:fs:rename", oldPath, newName),
    onChange: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("mindnest:fs:changed", handler);
      return () => ipcRenderer.off("mindnest:fs:changed", handler);
    },
  },

  // Terminal
  terminal: {
    create: (opts: { cwd: string; cols?: number; rows?: number }): Promise<CreateTerminalResult> =>
      ipcRenderer.invoke("mindnest:terminal:create", opts),
    write: (id: string, data: string) =>
      ipcRenderer.send("mindnest:terminal:write", { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("mindnest:terminal:resize", { id, cols, rows }),
    kill: (id: string) => ipcRenderer.send("mindnest:terminal:kill", { id }),
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `mindnest:terminal:data:${id}`;
      const handler = (_e: unknown, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
    onExit: (id: string, callback: (code: number) => void) => {
      const channel = `mindnest:terminal:exit:${id}`;
      const handler = (_e: unknown, code: number) => callback(code);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
  },
});
