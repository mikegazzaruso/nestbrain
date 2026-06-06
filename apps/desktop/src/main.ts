import {
  app,
  BrowserWindow,
  shell,
  Menu,
  ipcMain,
  dialog,
  utilityProcess,
  UtilityProcess,
} from "electron";
import { createServer } from "node:net";
import { join, dirname, resolve, sep } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  cpSync,
  renameSync,
  rmSync,
  watch,
  type FSWatcher,
} from "node:fs";
// Lazy-load node-pty: if the native binding fails to load (wrong arch,
// missing DLL, etc.) we still want the app to start — just without
// terminal support. A top-level `import` would crash the entire process
// before Electron even shows a window.
let pty: typeof import("node-pty") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pty = require("node-pty") as typeof import("node-pty");
} catch (err) {
  console.error("[pty] native binding failed to load:", err);
}
import { execFileSync, execSync, spawn } from "node:child_process";
import { AuthManager } from "./auth";
import { SyncManager } from "./sync";

// On macOS, packaged Electron apps don't inherit the user's shell PATH —
// they get a minimal PATH like /usr/bin:/bin which doesn't include common
// install locations (~/.npm-global/bin, /opt/homebrew/bin, etc.). This
// breaks spawning external CLIs like `claude` (the Anthropic Claude CLI)
// from the LLM provider.
//
// Inline replacement for the `fix-path` package (which is ESM-only in v4
// and can't be `require()`'d from our CJS main bundle): spawn the user's
// default shell as an interactive login shell, ask it for PATH, then
// override the current process env. Falls back to a list of common bin
// dirs if shell invocation fails.
function fixMacPath(): void {
  if (process.platform !== "darwin") return;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execSync(`"${shell}" -ilc 'echo "$PATH"'`, {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (out && out.length > 0) {
      process.env.PATH = out;
      return;
    }
  } catch {
    /* fall through to default extension */
  }
  const home = process.env.HOME || "";
  const extra = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    `${home}/.npm-global/bin`,
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    "/usr/local/sbin",
  ];
  process.env.PATH = `${extra.join(":")}:${process.env.PATH || ""}`;
}
fixMacPath();

const isDev = !!process.env.NESTBRAIN_DEV;
const DEV_URL = "http://localhost:3000";

// Must be set before app is ready so the menu bar shows "NestBrain" not "Electron"
app.setName("NestBrain");

let mainWindow: BrowserWindow | null = null;
let nextServer: UtilityProcess | null = null;
let serverUrl: string | null = null;
let currentPort: number | null = null;
let lastServerOutput = "";
let authManager: AuthManager | null = null;
let syncManager: SyncManager | null = null;

const NESTBRAIN_SUBDIRS = [
  "Business",
  "Context",
  "Daily",
  "Library",
  "Projects",
  "Skills",
  "Team",
];

interface Bootstrap {
  nestBrainPath?: string;
}

function getBootstrapPath(): string {
  return join(app.getPath("userData"), "bootstrap.json");
}

function readBootstrap(): Bootstrap {
  try {
    const raw = readFileSync(getBootstrapPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeBootstrap(b: Bootstrap): void {
  const p = getBootstrapPath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(b, null, 2), "utf-8");
}

// One-time migration from the legacy `.mindnest/` internal state dir to
// the new `.nestbrain/` (post-rebrand from MindNest → NestBrain). Only
// renames if the legacy dir exists and the new one doesn't, so it's safe
// to call repeatedly.
function migrateLegacyInternalDir(nestBrainPath: string): void {
  const legacy = join(nestBrainPath, ".mindnest");
  const current = join(nestBrainPath, ".nestbrain");
  if (existsSync(legacy) && !existsSync(current)) {
    try {
      renameSync(legacy, current);
      console.log(`[migrate] renamed ${legacy} → ${current}`);
    } catch (err) {
      console.warn(`[migrate] failed to rename internal dir:`, err);
    }
  }
}

function getDataDir(): string {
  const bootstrap = readBootstrap();
  if (bootstrap.nestBrainPath && existsSync(bootstrap.nestBrainPath)) {
    migrateLegacyInternalDir(bootstrap.nestBrainPath);
    const dir = join(bootstrap.nestBrainPath, ".nestbrain");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  // First-run fallback
  const dir = join(app.getPath("userData"), "data-tmp");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getWikiDir(): string | null {
  const bootstrap = readBootstrap();
  if (bootstrap.nestBrainPath && existsSync(bootstrap.nestBrainPath)) {
    const dir = join(bootstrap.nestBrainPath, "Library", "Knowledge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
  return null;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Failed to get free port"));
      }
    });
  });
}

async function startNextServer(reusePort = false): Promise<string> {
  const port = reusePort && currentPort ? currentPort : await findFreePort();
  currentPort = port;
  const dataDir = getDataDir();
  const wikiDir = getWikiDir();

  const resourcesRoot = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(__dirname, "../../web/.next/standalone");

  const serverJs = join(resourcesRoot, "apps/web/server.js");

  if (!existsSync(serverJs)) {
    throw new Error(`Next.js standalone server not found at: ${serverJs}`);
  }

  nextServer = utilityProcess.fork(serverJs, [], {
    cwd: join(resourcesRoot, "apps/web"),
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NESTBRAIN_DATA_DIR: dataDir,
      ...(wikiDir ? { NESTBRAIN_WIKI_DIR: wikiDir } : {}),
      NODE_ENV: "production",
    },
    stdio: "pipe",
    serviceName: "nestbrain-next-server",
  });

  lastServerOutput = "";
  nextServer.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    console.log("[next]", line);
    lastServerOutput += line + "\n";
    if (lastServerOutput.length > 8000) lastServerOutput = lastServerOutput.slice(-6000);
  });
  nextServer.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    console.error("[next]", line);
    lastServerOutput += "[stderr] " + line + "\n";
    if (lastServerOutput.length > 8000) lastServerOutput = lastServerOutput.slice(-6000);
  });
  nextServer.on("exit", (code: number) => {
    console.log(`[next] exited with code ${code}`);
    // Only quit if the main window closed. If we killed it for a restart, don't quit.
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      // Server died unexpectedly — leave window open with whatever is cached
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, 60000);
  return url;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();

  // If the server process exits (crash, missing module, etc.) reject
  // immediately instead of polling until timeout.
  let serverExited = false;
  let exitReason = "";
  const onExit = (code: number) => {
    serverExited = true;
    exitReason = `Server process exited with code ${code}`;
  };
  nextServer?.on("exit", onExit);

  try {
    while (Date.now() - start < timeoutMs) {
      if (serverExited) {
        const output = lastServerOutput
          ? `\n\nServer output:\n${lastServerOutput.slice(-3000)}`
          : "\n\n(no output captured)";
        throw new Error(`${exitReason}${output}`);
      }
      try {
        // ANY HTTP response (even 500) means the server is alive and
        // listening. A 500 just means a page render error (e.g. a native
        // module failed to load on this platform) — the app can still
        // show the UI and the user gets a visible error instead of a
        // silent quit. Only ECONNREFUSED (caught below) means "not ready".
        await fetch(url);
        return;
      } catch {
        // ECONNREFUSED — server hasn't bound the port yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const output = lastServerOutput
      ? `\n\nServer output:\n${lastServerOutput.slice(-3000)}`
      : "\n\n(no output captured from server process)";
    throw new Error(
      `Next.js server did not respond within ${timeoutMs / 1000}s.${output}`,
    );
  } finally {
    nextServer?.removeListener("exit", onExit);
  }
}

let shuttingDown = false;

function killNextServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!nextServer) return resolve();
    const srv = nextServer;
    nextServer = null;
    srv.once("exit", () => resolve());
    try {
      srv.kill();
    } catch {
      resolve();
    }
    // Safety timeout
    setTimeout(resolve, 2000);
  });
}

async function restartNextServer(): Promise<void> {
  // In dev the Next.js server is run externally (`pnpm --filter @nestbrain/web dev`)
  // and we don't manage its lifecycle from here. A NestBrain location change
  // means the dev server is now pointing at a stale data dir, but a hard
  // restart of that external process is outside our control — log and move on.
  if (isDev) {
    console.warn("[dev] NestBrain location changed; restart `pnpm --filter @nestbrain/web dev` manually to pick up the new data dir");
    return;
  }
  await killNextServer();
  // Give the OS a moment to release the port (TIME_WAIT)
  await new Promise((r) => setTimeout(r, 300));
  // Reuse the same port so the renderer's API calls transparently hit the new server
  // without requiring a page reload (which would wipe React state mid-onboarding)
  let attempts = 0;
  while (attempts < 5) {
    try {
      serverUrl = await startNextServer(true);
      return;
    } catch (err) {
      attempts++;
      if (attempts >= 5) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url = isDev ? DEV_URL : serverUrl;
  if (url) mainWindow.loadURL(url);
}

function setupMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// === IPC handlers ===
ipcMain.handle("nestbrain:getBootstrap", () => {
  return {
    ...readBootstrap(),
    isElectron: true,
    platform: process.platform,
  };
});

ipcMain.handle("nestbrain:selectDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create NestBrain",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Select",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// === Terminal (PTY) session management ===
interface PtySession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc: any;
  cwd: string;
}
const ptySessions = new Map<string, PtySession>();
let nextSessionId = 1;

function getShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.ComSpec || "powershell.exe", args: [] };
  }
  // Prefer the user's configured shell; fall back to common shells that
  // actually exist on the system.
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ].filter((s): s is string => !!s);
  for (const s of candidates) {
    if (existsSync(s)) {
      return { shell: s, args: ["-l"] };
    }
  }
  return { shell: "/bin/sh", args: [] };
}

function sanitizeEnv(): Record<string, string> {
  // node-pty requires all env values to be strings. Electron's process.env
  // may contain non-string or undefined values that make posix_spawnp fail.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  // Drop Electron-specific vars that shouldn't leak into the user shell
  for (const k of [
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_NO_ATTACH_CONSOLE",
    "NODE_OPTIONS",
  ]) {
    delete out[k];
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  return out;
}

ipcMain.handle(
  "nestbrain:terminal:create",
  (_e, { cwd, cols = 80, rows = 24 }: { cwd: string; cols?: number; rows?: number }) => {
    if (!existsSync(cwd)) {
      throw new Error(`cwd does not exist: ${cwd}`);
    }
    const { shell: shellPath, args } = getShell();
    console.log(`[pty] spawning shell=${shellPath} args=${JSON.stringify(args)} cwd=${cwd}`);
    if (!pty) {
      throw new Error(
        "Terminal is not available — the node-pty native module failed to load on this platform.",
      );
    }
    const id = `t${nextSessionId++}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let proc: any;
    try {
      proc = pty.spawn(shellPath, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: sanitizeEnv(),
      });
    } catch (err) {
      console.error(`[pty] spawn failed:`, err);
      throw new Error(
        `Failed to spawn shell ${shellPath}: ${err instanceof Error ? err.message : err}`,
      );
    }

    proc.onData((data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`nestbrain:terminal:data:${id}`, data);
      }
    });
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`nestbrain:terminal:exit:${id}`, exitCode);
      }
      ptySessions.delete(id);
    });

    ptySessions.set(id, { proc, cwd });
    return { id, cwd };
  },
);

ipcMain.on(
  "nestbrain:terminal:write",
  (_e, { id, data }: { id: string; data: string }) => {
    const sess = ptySessions.get(id);
    if (sess) sess.proc.write(data);
  },
);

ipcMain.on(
  "nestbrain:terminal:resize",
  (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const sess = ptySessions.get(id);
    if (sess) {
      try {
        sess.proc.resize(cols, rows);
      } catch {
        /* process may have already exited */
      }
    }
  },
);

ipcMain.on("nestbrain:terminal:kill", (_e, { id }: { id: string }) => {
  const sess = ptySessions.get(id);
  if (sess) {
    try {
      sess.proc.kill();
    } catch {
      /* ignore */
    }
    ptySessions.delete(id);
  }
});

// === Directory listing (for file tree) ===
interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function isHiddenOrIgnored(name: string): boolean {
  return (
    name.startsWith(".") ||
    name === "node_modules" ||
    name === ".nestbrain"
  );
}

ipcMain.handle(
  "nestbrain:fs:list",
  (_e, dirPath: string): FsEntry[] => {
    if (!existsSync(dirPath)) return [];
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => !isHiddenOrIgnored(e.name))
        .map((e) => ({
          name: e.name,
          path: join(dirPath, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return [];
    }
  },
);

ipcMain.handle(
  "nestbrain:fs:createDir",
  (_e, dirPath: string): { ok: true; path: string } => {
    // Containment check — createDir must stay within the active NestBrain
    // (used for New Project and for the in-tree new-folder action).
    const abs = assertInsideNestBrain(dirPath);
    mkdirSync(abs, { recursive: true });
    return { ok: true, path: abs };
  },
);

// ===== File read/write for the in-app editor =====
// Both handlers enforce that the target path is inside the active
// NestBrain root, so the renderer cannot read or write arbitrary files
// elsewhere on the user's disk even if the preload is compromised.
const MAX_EDITABLE_BYTES = 1024 * 1024; // 1 MiB hard cap for the editor

interface ReadFileResult {
  content: string;
  size: number;
  binary: boolean;
  tooLarge: boolean;
}

function assertInsideNestBrain(targetPath: string): string {
  const bootstrap = readBootstrap();
  if (!bootstrap.nestBrainPath) {
    throw new Error("No NestBrain configured");
  }
  const root = resolve(bootstrap.nestBrainPath);
  const abs = resolve(targetPath);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(
      `Refusing to access path outside NestBrain: ${abs}`,
    );
  }
  return abs;
}

function looksBinary(buf: Buffer): boolean {
  // Cheap heuristic: null byte in the first 8KB → binary
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

ipcMain.handle(
  "nestbrain:fs:readFile",
  (_e, filePath: string): ReadFileResult => {
    const abs = assertInsideNestBrain(filePath);
    const stat = statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${abs}`);
    }
    if (stat.size > MAX_EDITABLE_BYTES) {
      return { content: "", size: stat.size, binary: false, tooLarge: true };
    }
    const buf = readFileSync(abs);
    if (looksBinary(buf)) {
      return { content: "", size: stat.size, binary: true, tooLarge: false };
    }
    return {
      content: buf.toString("utf-8"),
      size: stat.size,
      binary: false,
      tooLarge: false,
    };
  },
);

ipcMain.handle(
  "nestbrain:fs:writeFile",
  (_e, filePath: string, content: string): { ok: true; size: number } => {
    const abs = assertInsideNestBrain(filePath);
    // Refuse to write into .nestbrain/ — that's internal state the user
    // should never hand-edit through the app's editor.
    const bootstrap = readBootstrap();
    const internal = resolve(bootstrap.nestBrainPath!, ".nestbrain");
    if (abs === internal || abs.startsWith(internal + sep)) {
      throw new Error("Cannot write into .nestbrain/ — internal state");
    }
    // Ensure parent directory exists
    const parent = join(abs, "..");
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(abs, content, "utf-8");
    return { ok: true, size: Buffer.byteLength(content, "utf-8") };
  },
);

// Paths inside NestBrain that cannot be deleted or renamed — these are
// either workspace-structural (top-level skeleton dirs) or internal state.
const PROTECTED_TOP_LEVEL_NAMES = new Set([
  ...NESTBRAIN_SUBDIRS,
  ".nestbrain",
]);

function isProtectedPath(abs: string): boolean {
  const bootstrap = readBootstrap();
  if (!bootstrap.nestBrainPath) return true;
  const root = resolve(bootstrap.nestBrainPath);
  if (abs === root) return true;
  const internal = resolve(root, ".nestbrain");
  if (abs === internal || abs.startsWith(internal + sep)) return true;
  const rel = abs.slice(root.length + 1);
  if (!rel.includes(sep) && PROTECTED_TOP_LEVEL_NAMES.has(rel)) return true;
  return false;
}

ipcMain.handle(
  "nestbrain:fs:delete",
  (_e, targetPath: string): { ok: true } => {
    const abs = assertInsideNestBrain(targetPath);
    if (isProtectedPath(abs)) {
      throw new Error(
        "This path is protected by NestBrain and cannot be deleted.",
      );
    }
    if (!existsSync(abs)) {
      throw new Error("Path does not exist");
    }
    rmSync(abs, { recursive: true, force: true });
    return { ok: true };
  },
);

ipcMain.handle(
  "nestbrain:fs:rename",
  (
    _e,
    oldPath: string,
    newName: string,
  ): { ok: true; newPath: string } => {
    const absOld = assertInsideNestBrain(oldPath);
    if (isProtectedPath(absOld)) {
      throw new Error(
        "This path is protected by NestBrain and cannot be renamed.",
      );
    }
    const trimmed = (newName ?? "").trim();
    if (
      !trimmed ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed === "." ||
      trimmed === ".."
    ) {
      throw new Error("Invalid name");
    }
    const parent = join(absOld, "..");
    const absNew = join(parent, trimmed);
    // Must still end up inside NestBrain (extra safety)
    assertInsideNestBrain(absNew);
    if (existsSync(absNew)) {
      throw new Error(`A file or folder named "${trimmed}" already exists`);
    }
    renameSync(absOld, absNew);
    return { ok: true, newPath: absNew };
  },
);

function getSkeletonPath(): string {
  // Packaged: resources/skeleton. Dev: repo_root/skeleton.
  if (app.isPackaged) {
    return join(process.resourcesPath, "skeleton");
  }
  return resolve(__dirname, "../../../skeleton");
}

function copySkeletonToNestBrain(nestBrainPath: string): void {
  const skeletonPath = getSkeletonPath();
  if (!existsSync(skeletonPath)) return;

  // CLAUDE.md in the NestBrain root — only write if missing (preserve user edits on re-setup)
  const claudeSrc = join(skeletonPath, "CLAUDE.md");
  const claudeDst = join(nestBrainPath, "CLAUDE.md");
  if (existsSync(claudeSrc) && !existsSync(claudeDst)) {
    cpSync(claudeSrc, claudeDst);
  }

  // Skills — copy each skill folder into NestBrain/Skills/ only if missing
  const skillsSrc = join(skeletonPath, "Skills");
  const skillsDst = join(nestBrainPath, "Skills");
  if (existsSync(skillsSrc)) {
    mkdirSync(skillsDst, { recursive: true });
    for (const entry of readdirSync(skillsSrc)) {
      const src = join(skillsSrc, entry);
      const dst = join(skillsDst, entry);
      if (statSync(src).isDirectory() && !existsSync(dst)) {
        cpSync(src, dst, { recursive: true });
      }
    }
  }
}

function createFreshNestBrain(nestBrainPath: string): void {
  mkdirSync(nestBrainPath, { recursive: true });
  for (const sub of NESTBRAIN_SUBDIRS) {
    mkdirSync(join(nestBrainPath, sub), { recursive: true });
  }
  // NestBrain-generated wiki lives inside the user-visible Library folder
  mkdirSync(join(nestBrainPath, "Library", "Knowledge"), { recursive: true });
  // .nestbrain holds internal state (raw sources, settings, vector index)
  mkdirSync(join(nestBrainPath, ".nestbrain"), { recursive: true });
  // Seed CLAUDE.md and Skills from the bundled skeleton (non-destructive)
  copySkeletonToNestBrain(nestBrainPath);
}

function moveDir(src: string, dst: string): void {
  try {
    renameSync(src, dst);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EXDEV") {
      // Cross-device move — fall back to copy + delete
      cpSync(src, dst, { recursive: true });
      rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

function killAllPtySessions(): void {
  for (const [id, sess] of ptySessions) {
    try {
      sess.proc.kill();
    } catch {
      /* ignore */
    }
    ptySessions.delete(id);
  }
}

// ===== NestBrain auto-refresh watcher =====
// Recursively watches the NestBrain directory and emits a debounced
// `nestbrain:fs:changed` event to the renderer so the file tree refreshes
// automatically when files are added/modified/removed from Finder, the
// terminal, or any other source.
//
// Uses fs.watch with { recursive: true } which is supported on macOS and
// Windows (our target platforms). Debounced at 500ms so bursts of events
// (e.g. npm install, git operations) collapse into a single refresh.
// Noise from .nestbrain/, .git/, node_modules/, and temp files is filtered
// in-process so the IPC channel stays quiet.
let fsWatcher: FSWatcher | null = null;
let fsWatchDebounce: NodeJS.Timeout | null = null;
const FS_WATCH_DEBOUNCE_MS = 500;

function shouldIgnoreFsChange(filename: string | null): boolean {
  if (!filename) return false;
  const f = filename.replace(/\\/g, "/");
  // Hidden / internal directories
  if (f === ".nestbrain" || f.startsWith(".nestbrain/")) return true;
  if (f === ".git" || f.startsWith(".git/") || f.includes("/.git/")) return true;
  if (
    f === "node_modules" ||
    f.startsWith("node_modules/") ||
    f.includes("/node_modules/")
  ) {
    return true;
  }
  // Noise files
  const base = f.split("/").pop() || "";
  if (base === ".DS_Store" || base === "Thumbs.db") return true;
  if (
    base.endsWith(".swp") ||
    base.endsWith(".swx") ||
    base.endsWith(".tmp") ||
    base.endsWith("~")
  ) {
    return true;
  }
  return false;
}

function startNestBrainWatcher(nestBrainPath: string): void {
  stopNestBrainWatcher();
  if (!existsSync(nestBrainPath)) return;
  try {
    fsWatcher = watch(
      nestBrainPath,
      { recursive: true, persistent: false },
      (_eventType, filename) => {
        if (shouldIgnoreFsChange(filename)) return;
        if (fsWatchDebounce) clearTimeout(fsWatchDebounce);
        fsWatchDebounce = setTimeout(() => {
          fsWatchDebounce = null;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("nestbrain:fs:changed");
          }
        }, FS_WATCH_DEBOUNCE_MS);
      },
    );
    fsWatcher.on("error", (err) => {
      console.error("[watcher] error:", err);
    });
    console.log(`[watcher] watching ${nestBrainPath}`);
  } catch (err) {
    console.error("[watcher] failed to start:", err);
  }
}

function stopNestBrainWatcher(): void {
  if (fsWatchDebounce) {
    clearTimeout(fsWatchDebounce);
    fsWatchDebounce = null;
  }
  if (fsWatcher) {
    try {
      fsWatcher.close();
    } catch {
      /* ignore */
    }
    fsWatcher = null;
  }
}

ipcMain.handle("nestbrain:setupNestBrain", async (_e, parentPath: string) => {
  if (!parentPath || typeof parentPath !== "string") {
    throw new Error("Invalid parent path");
  }
  const nestBrainPath = join(parentPath, "NestBrain");
  createFreshNestBrain(nestBrainPath);

  writeBootstrap({ nestBrainPath });
  // Restart Next.js server so it picks up the new data dir
  await restartNextServer();
  // Start watching the freshly created NestBrain for file tree auto-refresh
  startNestBrainWatcher(nestBrainPath);

  // Notify the renderer so the sidebar / file tree pick up the new
  // workspace path immediately at the end of onboarding (without needing
  // an app restart). Reuses the same channel as the move handler.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("nestbrain:nestBrainMoved", {
      nestBrainPath,
    });
  }

  return { nestBrainPath };
});

ipcMain.handle(
  "nestbrain:moveOrCreateNestBrain",
  async (_e, parentPath: string) => {
    if (!parentPath || typeof parentPath !== "string") {
      throw new Error("Invalid parent path");
    }
    const newPath = join(parentPath, "NestBrain");
    const bootstrap = readBootstrap();
    const oldPath = bootstrap.nestBrainPath;

    // Same destination as current → no-op
    if (oldPath && resolve(oldPath) === resolve(newPath)) {
      return { nestBrainPath: newPath, moved: false, created: false };
    }

    // Refuse if something is already at the destination
    if (existsSync(newPath)) {
      throw new Error(
        `A folder named "NestBrain" already exists at ${parentPath}. Choose a different location or remove it first.`,
      );
    }

    // Close terminals, stop the watcher, and stop the Next.js server —
    // they all hold references to the old data dir (terminal cwd, watch
    // handles, open file handles, env vars). In dev the Next server is
    // external (next dev), so we skip the kill+restart dance — the user
    // will need to restart `pnpm --filter @nestbrain/web dev` manually.
    killAllPtySessions();
    stopNestBrainWatcher();
    if (!isDev) await killNextServer();

    let moved = false;
    let created = false;

    if (oldPath && existsSync(oldPath)) {
      // Move existing NestBrain to the new location
      mkdirSync(parentPath, { recursive: true });
      moveDir(oldPath, newPath);
      moved = true;
    } else {
      // No existing NestBrain — create fresh at the new location
      createFreshNestBrain(newPath);
      created = true;
    }

    writeBootstrap({ nestBrainPath: newPath });

    // Give the OS a moment to release the port, then restart Next.js
    // reusing the same port so the renderer's fetch calls transparently
    // hit the new server without a window reload. Skipped in dev (see above).
    if (!isDev) {
      await new Promise((r) => setTimeout(r, 300));
      let attempts = 0;
      while (attempts < 5) {
        try {
          serverUrl = await startNextServer(true);
          break;
        } catch (err) {
          attempts++;
          if (attempts >= 5) throw err;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    // Restart the file watcher on the new NestBrain location
    startNestBrainWatcher(newPath);

    // Notify the renderer so it can refresh file tree, terminal state, etc.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("nestbrain:nestBrainMoved", {
        nestBrainPath: newPath,
      });
    }

    return { nestBrainPath: newPath, moved, created };
  },
);

// === Auth (Google OAuth) ===
ipcMain.handle("nestbrain:auth:getState", () => {
  return authManager?.getState() ?? { status: "signed-out" };
});

ipcMain.handle("nestbrain:auth:signIn", async () => {
  if (!authManager) throw new Error("Auth not initialized");
  await authManager.signIn();
});

ipcMain.handle("nestbrain:auth:signOut", async () => {
  if (!authManager) throw new Error("Auth not initialized");
  await authManager.signOut();
});

ipcMain.handle("nestbrain:auth:cancelSignIn", () => {
  authManager?.cancelSignIn();
});

// === Sync ===
ipcMain.handle("nestbrain:sync:getState", () => {
  return syncManager?.getState() ?? null;
});

ipcMain.handle("nestbrain:sync:setPreferences", async (_e, prefs) => {
  if (!syncManager) throw new Error("Sync not initialized");
  await syncManager.setPreferences(prefs);
});

ipcMain.handle("nestbrain:sync:syncNow", async () => {
  if (!syncManager) throw new Error("Sync not initialized");
  await syncManager.syncNow();
});

ipcMain.handle("nestbrain:sync:cancel", () => {
  syncManager?.cancel();
});

ipcMain.handle("nestbrain:sync:softDelete", async (_e, relPath: string) => {
  if (!syncManager) throw new Error("Sync not initialized");
  if (typeof relPath !== "string" || relPath === "") throw new Error("Invalid path");
  await syncManager.softDelete(relPath);
});

ipcMain.handle("nestbrain:sync:hardDelete", async (_e, relPath: string) => {
  if (!syncManager) throw new Error("Sync not initialized");
  if (typeof relPath !== "string" || relPath === "") throw new Error("Invalid path");
  await syncManager.hardDelete(relPath);
});

// ====== Git status for the file tree ======

/**
 * Get the current branch + per-file status for a git repo. Returns null
 * when `repoPath` is not the top of a git working tree (so the file-tree
 * caller can cheaply ask "is this dir a repo?" and skip rendering markers
 * when it isn't). Status codes follow `git status --porcelain` (X column
 * = index, Y column = worktree). The map keys are paths RELATIVE to the
 * repo top, with POSIX separators, matching what `--porcelain` emits.
 */
ipcMain.handle("nestbrain:git:status", async (_e, repoPath: string) => {
  if (typeof repoPath !== "string" || !repoPath) return null;
  return readGitStatus(repoPath);
});

/**
 * Walk up from any path looking for a git toplevel; if found, return the
 * repo path + full status. Used by the sidebar branch indicator so the
 * chip works for ANY focus path (editor file, terminal cwd) without
 * depending on the file tree having pre-registered the repo.
 */
ipcMain.handle("nestbrain:git:findRepo", async (_e, anyPath: string) => {
  if (typeof anyPath !== "string" || !anyPath) return null;
  let top = "";
  try {
    top = execFileSync("git", ["-C", anyPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
  } catch {
    return null;
  }
  if (!top) return null;
  const status = readGitStatus(top);
  return status ? { repoPath: top, status } : null;
});

/**
 * Run an arbitrary git subcommand inside `repoPath`. Used by the source
 * control panel for stage / unstage / discard / commit / push / pull /
 * stash. We never pipe untrusted input as a flag — every call site below
 * lists its own arg array, so a malicious "filename" can't impersonate a
 * `--upload-pack` etc.
 *
 * The wrapper:
 *   • caps stdout/stderr at 5 MB (operations like `git status` on huge
 *     repos can otherwise lock up the renderer waiting for IPC)
 *   • sets a 30 s timeout (push/pull can be slow on bad networks)
 *   • returns { ok, stdout, stderr } so the UI can show inline errors
 *     rather than crashing on a thrown promise.
 */
interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(repoPath: string, args: string[], timeoutMs = 30_000): GitRunResult {
  try {
    const out = execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 5 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { ok: true, stdout: out, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stdout: typeof e.stdout === "string" ? e.stdout : e.stdout?.toString() ?? "",
      stderr:
        (typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "") ||
        e.message ||
        "git command failed",
    };
  }
}

function assertRepo(repoPath: unknown): asserts repoPath is string {
  if (typeof repoPath !== "string" || !repoPath) {
    throw new Error("repoPath required");
  }
}

function assertPaths(paths: unknown): asserts paths is string[] {
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string" || !p)) {
    throw new Error("paths must be a non-empty string array");
  }
}

ipcMain.handle("nestbrain:git:stage", async (_e, repoPath: string, paths: string[]) => {
  assertRepo(repoPath); assertPaths(paths);
  return runGit(repoPath, ["add", "--", ...paths], 10_000);
});

ipcMain.handle("nestbrain:git:unstage", async (_e, repoPath: string, paths: string[]) => {
  assertRepo(repoPath); assertPaths(paths);
  return runGit(repoPath, ["restore", "--staged", "--", ...paths], 10_000);
});

ipcMain.handle("nestbrain:git:discard", async (_e, repoPath: string, paths: string[]) => {
  assertRepo(repoPath); assertPaths(paths);
  // For tracked-but-modified files: `git restore`. For untracked files
  // (which `restore` can't touch), `git clean -f --` removes them. We run
  // both unconditionally; the one that doesn't apply is a silent no-op.
  const r1 = runGit(repoPath, ["restore", "--worktree", "--", ...paths], 10_000);
  const r2 = runGit(repoPath, ["clean", "-fd", "--", ...paths], 10_000);
  return {
    ok: r1.ok && r2.ok,
    stdout: `${r1.stdout}${r2.stdout}`,
    stderr: `${r1.stderr}${r2.stderr}`,
  };
});

ipcMain.handle("nestbrain:git:commit", async (_e, repoPath: string, message: string) => {
  assertRepo(repoPath);
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("commit message required");
  }
  return runGit(repoPath, ["commit", "-m", message], 15_000);
});

ipcMain.handle("nestbrain:git:push", async (_e, repoPath: string) => {
  assertRepo(repoPath);
  return runGit(repoPath, ["push"], 60_000);
});

ipcMain.handle("nestbrain:git:pull", async (_e, repoPath: string) => {
  assertRepo(repoPath);
  return runGit(repoPath, ["pull", "--ff-only"], 60_000);
});

interface StashEntry {
  ref: string;
  message: string;
}

ipcMain.handle("nestbrain:git:stashList", async (_e, repoPath: string) => {
  assertRepo(repoPath);
  const r = runGit(repoPath, ["stash", "list", "--format=%gd%x09%gs"], 5_000);
  if (!r.ok) return { ok: false, stdout: r.stdout, stderr: r.stderr, stashes: [] as StashEntry[] };
  const stashes: StashEntry[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [ref, ...rest] = line.split("\t");
    stashes.push({ ref, message: rest.join("\t") });
  }
  return { ok: true, stdout: r.stdout, stderr: "", stashes };
});

ipcMain.handle(
  "nestbrain:git:stashPush",
  async (_e, repoPath: string, message?: string, includeUntracked?: boolean) => {
    assertRepo(repoPath);
    const args = ["stash", "push"];
    if (includeUntracked) args.push("-u");
    if (message && message.trim()) args.push("-m", message.trim());
    return runGit(repoPath, args, 15_000);
  },
);

ipcMain.handle("nestbrain:git:stashPop", async (_e, repoPath: string, ref?: string) => {
  assertRepo(repoPath);
  const args = ["stash", "pop"];
  if (ref && typeof ref === "string") args.push(ref);
  return runGit(repoPath, args, 15_000);
});

ipcMain.handle("nestbrain:git:stashDrop", async (_e, repoPath: string, ref: string) => {
  assertRepo(repoPath);
  if (typeof ref !== "string" || !ref) throw new Error("stash ref required");
  return runGit(repoPath, ["stash", "drop", ref], 5_000);
});

interface GitFileStatus {
  index: string; // 1 char, e.g. "M", " ", "?", "A", "D", "R"
  worktree: string;
}

interface GitRepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  /** True when the branch tracks a remote (push/pull are meaningful). */
  hasUpstream: boolean;
  files: Record<string, GitFileStatus>;
}

function readGitStatus(repoPath: string): GitRepoStatus | null {
  // Quick "is this a repo?" check — avoids running git on every Projects/<name>/
  // dir, most of which aren't git repos.
  try {
    const top = execFileSync("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    // Only treat repoPath as a repo if it IS the top — otherwise we'd
    // attribute child-project status to the parent.
    if (resolve(top) !== resolve(repoPath)) return null;
  } catch {
    return null;
  }

  let branch = "";
  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  const files: Record<string, GitFileStatus> = {};

  try {
    // -b puts a "## branch...origin/branch [ahead N, behind M]" header on the
    // first line. -z null-terminates entries so filenames with spaces or
    // newlines round-trip cleanly.
    const out = execFileSync(
      "git",
      ["-C", repoPath, "status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 },
    );
    const parts = out.split("\0");
    if (parts.length > 0 && parts[0].startsWith("## ")) {
      const header = parts.shift()!.slice(3);
      // The "...origin/foo" segment is present iff the branch has an upstream
      // configured; that's the cheap way to know whether push/pull are even
      // meaningful (vs the branch being local-only with no remote tracking).
      const m = /^([^.\s]+)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?/.exec(header);
      if (m) {
        branch = m[1] === "HEAD" ? "(detached)" : m[1];
        hasUpstream = !!m[2];
        const trailer = m[3] ?? "";
        const a = /ahead (\d+)/.exec(trailer);
        const b = /behind (\d+)/.exec(trailer);
        if (a) ahead = Number(a[1]);
        if (b) behind = Number(b[1]);
      }
    }
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry) continue;
      // Each entry is "XY path". Rename entries also push the rename source
      // as the next null-separated chunk — we just skip it.
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (code[0] === "R" || code[0] === "C") i += 1; // skip the rename src
      if (!path) continue;
      files[path] = { index: code[0], worktree: code[1] };
    }
  } catch {
    /* repo present but command failed — return what we have */
  }

  return { branch, ahead, behind, hasUpstream, files };
}

// ====== CLI on PATH (macOS / Windows) ======

/**
 * Where the user's PATH-installed `nestbrain` symlink/wrapper lives.
 * - macOS: /usr/local/bin/nestbrain (matches Homebrew's bin and VS Code's
 *   `code` command convention). Requires sudo to write.
 * - Windows: %LOCALAPPDATA%/NestBrain/cli/nestbrain.bat — user-scoped so
 *   no admin prompt is needed; the install also appends that dir to the
 *   user-level PATH via setx.
 */
function cliInstallTarget(): string | null {
  if (process.platform === "darwin") return "/usr/local/bin/nestbrain";
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    return join(local, "NestBrain", "cli", "nestbrain.bat");
  }
  return null;
}

/**
 * Absolute path of the CLI wrapper shipped with the running app.
 * In packaged mode: <App>/Contents/Resources/cli/nestbrain (macOS) or
 * <install-dir>/resources/cli/nestbrain.bat (Windows). In dev we point at
 * the source dir so install-on-PATH can be tested without packaging.
 */
function cliWrapperSource(): string {
  const wrapperName = process.platform === "win32" ? "nestbrain.bat" : "nestbrain";
  if (app.isPackaged) {
    return join(process.resourcesPath, "cli", wrapperName);
  }
  return join(__dirname, "../../desktop/build/cli", wrapperName);
}

interface CliStatus {
  supported: boolean;
  target: string | null;
  source: string;
  installed: boolean;
  /** True when target exists but points at the wrong place (e.g. app moved). */
  stale: boolean;
}

async function getCliStatus(): Promise<CliStatus> {
  const target = cliInstallTarget();
  const source = cliWrapperSource();
  if (!target) return { supported: false, target: null, source, installed: false, stale: false };

  const { readlink, stat: statAsync } = await import("node:fs/promises");
  if (!existsSync(target)) return { supported: true, target, source, installed: false, stale: false };

  if (process.platform === "darwin") {
    try {
      const link = await readlink(target);
      // Normalize: readlink may return a relative path; resolve against the
      // link's directory.
      const resolved = link.startsWith("/") ? link : resolve(join(target, ".."), link);
      return { supported: true, target, source, installed: true, stale: resolved !== source };
    } catch {
      // Not a symlink (regular file or dir) — count as installed-but-stale
      // because we don't know what it is.
      return { supported: true, target, source, installed: true, stale: true };
    }
  }
  // Windows: file or shortcut. We just check it exists; staleness check
  // is best-effort via comparing wrapper contents.
  try {
    const stats = await statAsync(target);
    return { supported: true, target, source, installed: stats.isFile(), stale: false };
  } catch {
    return { supported: true, target, source, installed: false, stale: false };
  }
}

ipcMain.handle("nestbrain:cli:status", async () => getCliStatus());

ipcMain.handle("nestbrain:cli:install", async () => {
  const status = await getCliStatus();
  if (!status.supported || !status.target) {
    throw new Error("CLI install not supported on this platform.");
  }
  if (process.platform === "darwin") {
    // Symlink in /usr/local/bin requires sudo. Use osascript to surface the
    // native admin password prompt — matches the macOS UX users expect.
    const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const cmd = `mkdir -p "$(dirname "${escape(status.target)}")" && ln -sf "${escape(status.source)}" "${escape(status.target)}"`;
    const apple = `do shell script "${escape(cmd)}" with administrator privileges`;
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("osascript", ["-e", apple]);
      let stderr = "";
      proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
      proc.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
      });
      proc.on("error", reject);
    });
    return getCliStatus();
  }
  if (process.platform === "win32") {
    // User-scoped install — copy the .bat into %LOCALAPPDATA%/NestBrain/cli
    // and append that dir to the user PATH. No admin prompt.
    const targetDir = dirname(status.target);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    cpSync(status.source, status.target);
    // Append to user PATH if missing.
    try {
      const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: "utf-8" }).trim();
      if (!userPath.split(";").map((s) => s.trim().toLowerCase()).includes(targetDir.toLowerCase())) {
        const next = userPath ? `${userPath};${targetDir}` : targetDir;
        execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${next.replace(/'/g, "''")}','User')"`);
      }
    } catch (err) {
      console.error("[cli:install] PATH update failed:", err);
    }
    return getCliStatus();
  }
  throw new Error("Unsupported platform");
});

ipcMain.handle("nestbrain:cli:uninstall", async () => {
  const status = await getCliStatus();
  if (!status.supported || !status.target || !status.installed) return getCliStatus();
  if (process.platform === "darwin") {
    const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const cmd = `rm -f "${escape(status.target)}"`;
    const apple = `do shell script "${escape(cmd)}" with administrator privileges`;
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("osascript", ["-e", apple]);
      let stderr = "";
      proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
      proc.on("close", (code: number) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `osascript exited ${code}`))));
      proc.on("error", reject);
    });
    return getCliStatus();
  }
  if (process.platform === "win32") {
    try { rmSync(status.target, { force: true }); } catch { /* ignore */ }
    return getCliStatus();
  }
  throw new Error("Unsupported platform");
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged && app.dock) {
    try {
      const iconPath = join(__dirname, "../build/icon.png");
      if (existsSync(iconPath)) app.dock.setIcon(iconPath);
    } catch {
      /* ignore */
    }
  }

  // About panel (shown by the "About NestBrain" menu item on macOS)
  const aboutIconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(__dirname, "../build/icon.png");
  app.setAboutPanelOptions({
    applicationName: "NestBrain",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: "Copyright © 2026 NextEpochs. All rights reserved.",
    credits:
      "Created by Mike Gazzaruso (NextEpochs) in 2026.\n\nLLM‑powered personal knowledge base with an integrated workspace.",
    authors: ["Mike Gazzaruso"],
    website: "https://github.com/mikegazzaruso/NestBrain",
    ...(existsSync(aboutIconPath) ? { iconPath: aboutIconPath } : {}),
  });

  setupMenu();

  // Auth manager: load any persisted session and start broadcasting state
  // changes to the renderer. safeStorage requires app.ready, so this must
  // happen here and not at module scope.
  authManager = new AuthManager();
  authManager.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("nestbrain:auth:stateChanged", state);
    }
  });
  await authManager.init();

  // Sync manager depends on auth + a workspace path. It subscribes to auth
  // changes internally and recomputes its status (signed-in + enabled = idle;
  // anything else = disabled).
  syncManager = new SyncManager({
    authManager,
    getWorkspacePath: () => {
      const b = readBootstrap();
      return b.nestBrainPath ?? null;
    },
  });
  syncManager.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("nestbrain:sync:stateChanged", state);
    }
  });
  await syncManager.init();

  try {
    if (!isDev) {
      serverUrl = await startNextServer();
    }
    createWindow();
    // Start watching NestBrain for file-tree auto-refresh if we already
    // have a bootstrap from a previous run. Fresh installs start it from
    // inside setupNestBrain after onboarding.
    const bootstrap = readBootstrap();
    if (bootstrap.nestBrainPath && existsSync(bootstrap.nestBrainPath)) {
      startNestBrainWatcher(bootstrap.nestBrainPath);
    }
  } catch (err) {
    console.error("Failed to start:", err);
    dialog.showErrorBox(
      "NestBrain failed to start",
      `${err instanceof Error ? err.message : String(err)}\n\nPlease report this at github.com/mikegazzaruso/nestbrain/issues`,
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  shuttingDown = true;
  killNextServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  shuttingDown = true;
  stopNestBrainWatcher();
  killNextServer();
});
