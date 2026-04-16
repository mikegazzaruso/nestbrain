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
import { join, resolve, sep } from "node:path";
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
import { execSync } from "node:child_process";

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
    // handles, open file handles, env vars).
    killAllPtySessions();
    stopNestBrainWatcher();
    await killNextServer();

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
    // hit the new server without a window reload.
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
    applicationVersion: "0.10.0",
    version: "0.10.0",
    copyright: "Copyright © 2026 NextEpochs. All rights reserved.",
    credits:
      "Created by Mike Gazzaruso (NextEpochs) in 2026.\n\nLLM‑powered personal knowledge base with an integrated workspace.",
    authors: ["Mike Gazzaruso"],
    website: "https://github.com/mikegazzaruso/NestBrain",
    ...(existsSync(aboutIconPath) ? { iconPath: aboutIconPath } : {}),
  });

  setupMenu();
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
