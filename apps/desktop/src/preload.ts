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

contextBridge.exposeInMainWorld("nestbrain", {
  isElectron: true,
  platform: process.platform,

  getBootstrap: () => ipcRenderer.invoke("nestbrain:getBootstrap"),
  selectDirectory: () => ipcRenderer.invoke("nestbrain:selectDirectory"),
  setupNestBrain: (parentPath: string) =>
    ipcRenderer.invoke("nestbrain:setupNestBrain", parentPath),
  moveOrCreateNestBrain: (parentPath: string) =>
    ipcRenderer.invoke("nestbrain:moveOrCreateNestBrain", parentPath),
  onNestBrainMoved: (callback: (info: { nestBrainPath: string }) => void) => {
    const handler = (_e: unknown, info: { nestBrainPath: string }) =>
      callback(info);
    ipcRenderer.on("nestbrain:nestBrainMoved", handler);
    return () => ipcRenderer.off("nestbrain:nestBrainMoved", handler);
  },

  // File system
  fs: {
    list: (dirPath: string): Promise<FsEntry[]> =>
      ipcRenderer.invoke("nestbrain:fs:list", dirPath),
    createDir: (dirPath: string): Promise<{ ok: true; path: string }> =>
      ipcRenderer.invoke("nestbrain:fs:createDir", dirPath),
    readFile: (filePath: string): Promise<{
      content: string;
      size: number;
      binary: boolean;
      tooLarge: boolean;
    }> => ipcRenderer.invoke("nestbrain:fs:readFile", filePath),
    writeFile: (
      filePath: string,
      content: string,
    ): Promise<{ ok: true; size: number }> =>
      ipcRenderer.invoke("nestbrain:fs:writeFile", filePath, content),
    delete: (targetPath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("nestbrain:fs:delete", targetPath),
    rename: (
      oldPath: string,
      newName: string,
    ): Promise<{ ok: true; newPath: string }> =>
      ipcRenderer.invoke("nestbrain:fs:rename", oldPath, newName),
    onChange: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("nestbrain:fs:changed", handler);
      return () => ipcRenderer.off("nestbrain:fs:changed", handler);
    },
  },

  // Terminal
  terminal: {
    create: (opts: { cwd: string; cols?: number; rows?: number }): Promise<CreateTerminalResult> =>
      ipcRenderer.invoke("nestbrain:terminal:create", opts),
    write: (id: string, data: string) =>
      ipcRenderer.send("nestbrain:terminal:write", { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("nestbrain:terminal:resize", { id, cols, rows }),
    kill: (id: string) => ipcRenderer.send("nestbrain:terminal:kill", { id }),
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `nestbrain:terminal:data:${id}`;
      const handler = (_e: unknown, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
    onExit: (id: string, callback: (code: number) => void) => {
      const channel = `nestbrain:terminal:exit:${id}`;
      const handler = (_e: unknown, code: number) => callback(code);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
  },
});
