import { app, ipcMain, type BrowserWindow } from "electron";
import { UPDATE_BASE_URL, UPDATE_CHANNEL_KEY } from "./update-config";

// VS Code-style transparent auto-update, official builds only.
//
// The channel key is injected at build time (CI secret / .env.local) and is
// absent from source builds — without it this module stays inert and the
// update server rejects requests anyway. Flow: check on launch + every 6h →
// download silently in the background → tell the renderer to show a
// "Restart to update" toast → install on restart or on next quit.

export interface UpdateState {
  /** Why the updater is or isn't running. */
  status: "disabled" | "dev" | "idle" | "checking" | "downloading" | "ready" | "error";
  /** Running app version. */
  current: string;
  /** Newest version known from the feed (when found). */
  available?: string;
  /** Download progress 0..100 while status === "downloading". */
  percent?: number;
  error?: string;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { status: "disabled", current: app.getVersion() };
let getWindow: () => BrowserWindow | null = () => null;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("nestbrain:updates:stateChanged", state);
  }
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;

  ipcMain.handle("nestbrain:updates:getState", () => state);

  if (!UPDATE_CHANNEL_KEY) {
    // Source build — no entitlement, updater stays off.
    ipcMain.handle("nestbrain:updates:check", () => state);
    ipcMain.handle("nestbrain:updates:restart", () => undefined);
    return;
  }
  if (!app.isPackaged) {
    // Dev run of an entitled tree: don't try to self-update the electron shell.
    state = { ...state, status: "dev" };
    ipcMain.handle("nestbrain:updates:check", () => state);
    ipcMain.handle("nestbrain:updates:restart", () => undefined);
    return;
  }

  // Lazy require: electron-updater is a production dep of the desktop app, but
  // keep startup resilient if the module ever fails to load.
  let autoUpdater: typeof import("electron-updater").autoUpdater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    autoUpdater = (require("electron-updater") as typeof import("electron-updater")).autoUpdater;
  } catch (e) {
    set({ status: "error", error: `updater unavailable: ${e instanceof Error ? e.message : e}` });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "Later" still updates on next quit
  autoUpdater.setFeedURL({
    provider: "generic",
    url: `${UPDATE_BASE_URL.replace(/\/$/, "")}/${process.platform === "darwin" ? "mac" : "win"}`,
  });
  autoUpdater.requestHeaders = { "x-update-key": UPDATE_CHANNEL_KEY };

  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: undefined }));
  autoUpdater.on("update-not-available", () => set({ status: "idle", available: undefined }));
  autoUpdater.on("update-available", (info) => set({ status: "downloading", available: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", available: info.version, percent: 100 }));
  autoUpdater.on("error", (err) => {
    // Network failures are routine (offline laptop) — record quietly, retry later.
    set({ status: "error", error: err.message });
  });

  ipcMain.handle("nestbrain:updates:check", async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* state already carries the error */
    }
    return state;
  });
  ipcMain.handle("nestbrain:updates:restart", () => {
    autoUpdater.quitAndInstall();
  });

  state = { ...state, status: "idle" };
  // First check shortly after launch (let the window settle), then periodic.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 15_000);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), CHECK_EVERY_MS);
}
