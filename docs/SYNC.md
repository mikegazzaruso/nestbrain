# NestBrain Sync

Multi-device sync for your NestBrain workspace, backed by your own Google Drive.

## Goals

- **Same vault on every machine you use.** Sign in to NestBrain with the same Google account on PC1 and PC2 — you see the same files, kept in step.
- **Never destroy data without explicit user action.** Local deletions soft-delete to `.trash/`. Hard-deletes require typing `DELETE` in a confirmation dialog.
- **Local-first.** Your files live on your disk. Drive is the transport, not the source of truth. NestBrain works fully offline; sync resumes when you reconnect.
- **Privacy by design.** NestBrain only sees the files it creates in your Drive — never the rest of your Drive content.

## Architecture at a glance

```
PC1 (NestBrain)                Google Drive                  PC2 (NestBrain)
 │                              │                              │
 ├─ workspace/                  ├─ NestBrain-Sync/             ├─ workspace/
 │   ├─ Daily/                  │   ├─ Daily/                  │   ├─ Daily/
 │   ├─ Library/                │   ├─ Library/                │   ├─ Library/
 │   └─ .trash/                 │   └─ .trash/                 │   └─ .trash/
 │                              │                              │
 ├─ .nestbrain/                 │                              ├─ .nestbrain/
 │   └─ sync-manifest.json      │                              │   └─ sync-manifest.json
 │     (local hash + driveId)   │                              │     (per-device)
 │                              │                              │
 └─ chokidar watcher ──push──> ─┘ ◀──pull every 60s──── chokidar watcher
```

### Per-device pieces

- **`<userData>/sync-prefs.json`** — your sync preferences on this machine (`enabled`, `includeProjects`, soft-limit, trash retention).
- **`<userData>/auth.enc`** — your Google OAuth refresh token, encrypted with the OS keychain via Electron `safeStorage`.
- **`<workspace>/.nestbrain/sync-manifest.json`** — per-file state: MD5 hash, Drive file id, mtime, size. Used as the cache that makes incremental sync cheap (only hash files whose mtime or size has drifted).

### What lives on Drive

A single dedicated folder named **`NestBrain-Sync/`** in the root of your Google Drive. NestBrain creates it automatically the first time you turn sync on. Inside, the folder structure mirrors your workspace (so `Library/Knowledge/foo.md` lives at the same relative path).

## How a sync cycle works

NestBrain has three trigger modes:

1. **Push** — debounced filesystem watcher (chokidar). When you save a file in the workspace, the watcher waits ~3 s for further activity. The watcher accumulates the set of changed paths during the debounce window and hands them to the engine, which skips the workspace walk and inspects only those files. A periodic full-walk **reconciliation** still runs every 10 min as a safety net for events chokidar can miss (sleep / wake, network mount changes). Manifest writes are batched to once per cycle instead of once per file, so a large batch upload finishes in tens of MB written instead of hundreds.
2. **Pull** — runs every 60 s, also on "Sync now" and on enable. **Drive Changes API based.** After the first sync NestBrain holds a Drive page token; every subsequent pull is a single `changes.list?pageToken=…` call. When nothing changed remotely the round trip is ≈400 ms regardless of how large the workspace has grown. A full Drive tree walk only runs on first sync and as a recovery path if the page token expires (~30-day TTL — Drive returns 400 / 410, NestBrain catches and re-seeds).
3. **Full cycle (pull + push)** — triggered by the "Sync now" button and after sign-in. Pull runs first so any inbound changes can't be clobbered by an outbound push.

### Excluded by default

Some things should never sync. The hardcoded exclude list (`packages/sync/src/excludes.ts`):

- **Build artifacts:** `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `.turbo/`, `.venv/`, `__pycache__/`
- **OS junk:** `.DS_Store`, `Thumbs.db`
- **Secrets:** `.env`, `.env.local`, `.env.development`, `.env.production`, `auth.enc`, `**/*.tmp`, `**/*.swp`
- **NestBrain internal state:** `.nestbrain/settings.json` (contains your OpenAI API key), `.nestbrain/vector-index/` (regenerable embeddings index), `.nestbrain/sync-manifest.json` (sync's own state)
- **Projects/** — only if the **"Include Projects/" toggle is off** (default off).

Files larger than **100 MB** are skipped with a notification (configurable via `maxFileSizeBytes`).

## Conflict resolution: keep-both

If you edit the same file on two machines while they're both offline, the next sync produces a **conflict file** instead of overwriting either side:

- Local file: stays exactly as you left it.
- Remote version arrives next to it as `<original>.conflict-<timestamp>.<ext>` (e.g. `2026-05-26.conflict-2026-05-26T15-30-12.md`).
- You decide which to keep.

NestBrain detects this by comparing the local file's current hash with the last-synced hash recorded in the manifest. If they differ, the local copy has uncommitted edits, and the remote version comes in alongside.

## Deletes

Two paths, both intentional:

### Soft-delete (default — "Move to .trash/")

Right-click any file in the file tree → **"Move to .trash/"**.

- The file moves to `<workspace>/.trash/<original-relative-path>` locally.
- On Drive, NestBrain changes the file's parent (single API call — same Drive file id, no upload). The file ends up at `NestBrain-Sync/.trash/<original-relative-path>`.
- On every other signed-in device, the file appears in *their* local `.trash/` at the next pull cycle.

You can recover by moving the file back out of `.trash/`.

### Hard-delete ("Delete on all devices…")

Right-click → **"Delete on all devices…"**. A typed-confirmation dialog appears: type `DELETE` to proceed.

- The Drive file is removed (`DELETE /files/{id}`).
- The local file is removed.
- On every other device, the next pull cycle notices the file is missing from Drive but present in the manifest, and moves *that device's* local copy to `.trash/`. This is the safety net: another device can't lose data just because you hard-deleted on yours — the user on that device still has to empty their `.trash/`.

External deletes (Finder, terminal, `rm`) are **never** propagated to Drive. NestBrain treats those as accidental — the file will be re-downloaded on the next pull cycle.

## The OAuth `drive.file` trade-off

NestBrain uses the OAuth scope `https://www.googleapis.com/auth/drive.file`. **This is intentional and important.**

### What this scope allows

✅ NestBrain can:
- Create files and folders in your Drive (inside `NestBrain-Sync/`).
- Read, update, move, and delete files **that NestBrain itself created**.
- Walk the folder tree of files that NestBrain created.

❌ NestBrain cannot:
- See any file in your Drive that NestBrain didn't create.
- Access files in other folders of your Drive.
- Read files uploaded or copied via drive.google.com's web UI, even if you put them inside `NestBrain-Sync/`.

This means **your other Drive files are private to NestBrain** — we can't read your personal documents, photos, or anything else, even if we wanted to.

### Practical consequence

| Operation | Synced cross-device? |
|---|---|
| Create / edit / rename / delete files from inside NestBrain (on any PC) | ✅ Yes |
| Drop a file into the workspace folder via Finder / Explorer / VS Code / Obsidian | ✅ Yes — local watcher picks it up and uploads |
| Edit a file with an external editor on the local workspace | ✅ Yes |
| Upload or "Make a copy" via drive.google.com web UI, inside `NestBrain-Sync/` | ❌ No — invisible to NestBrain |
| Move a file *into* `NestBrain-Sync/` from another Drive folder via the web UI | ❌ No — invisible to NestBrain |

### If you really need to import something from Drive

1. Download the file from drive.google.com.
2. Save it into your local NestBrain workspace at the desired path.
3. The watcher picks it up within ~3 s and uploads it — *now* NestBrain owns it, and every other signed-in device will receive it on the next pull.

### Why we don't use the broader `drive` scope

The full `drive` scope would let NestBrain see your entire Drive. It's classified as **restricted** by Google, which requires an annual **CASA security assessment** (third-party security audit, ~$5,000/year) to ship to non-test users. For a $29 one-time product, this isn't economical — and the `drive.file` scope already covers the primary use case (a NestBrain workspace synced across NestBrain installs) cleanly.

## Sign-in and session lifecycle

- **Sign in:** Settings → "Sync & Account" → "Sign in with Google", or the topbar button. NestBrain opens your system browser to Google's consent screen and captures the OAuth code on a temporary loopback URL.
- **Tokens:** the refresh token is stored in the OS keychain via Electron `safeStorage` (`Keychain` on macOS, `DPAPI` on Windows, `kwallet`/`libsecret` on Linux). Access tokens are short-lived and auto-refresh in the background.
- **Quit + restart:** you stay signed in — no need to repeat the OAuth flow.
- **Sign out:** Settings → "Sign out" (or the dropdown in the topbar). Local files stay untouched; sync stops. The refresh token is revoked at Google and deleted from the keychain.
- **Refresh-token expiry while the consent screen is in Testing mode:** Google rotates these every 7 days. NestBrain detects the failed refresh, signs you out cleanly, and prompts you to sign in again. Once the consent screen is in Production, refresh tokens don't expire unless you revoke them.

## Toggles (Settings → Sync & Account)

- **Enable sync on this device.** Master switch. Off = no watcher, no periodic pull, no uploads, ever. Your local files stay where they are. Drive's `NestBrain-Sync/` keeps whatever the other devices have put there.
- **Include Projects/ folder.** Per-device, opt-in. **Disabling here only stops syncing `Projects/` on this machine — it doesn't remove what's already on Drive.** Files already in Drive stay there for your other devices that still have it on. (If you want to wipe `Projects/` from Drive everywhere, hard-delete the individual files via "Delete on all devices…" — folder-level hard delete isn't supported yet.)

## Performance notes

- **Hashing:** MD5, chosen because Drive exposes `md5Checksum` in file metadata. This lets us compare local vs remote without downloading.
- **Fast path:** if a file's mtime *and* size match the manifest, we skip hashing entirely. This makes a no-op sync cycle complete in seconds even on a thousand-file workspace.
- **Resumable upload:** every file (including large PDFs) is streamed via Drive's resumable upload protocol — never buffered fully in memory.
- **Rate-limit handling:** the Drive adapter retries 429 / 5xx responses with exponential backoff (3 attempts) and refreshes the access token on 401.
- **Atomic manifest writes:** every save goes through a per-path queue to avoid races; we write to `.tmp` first then atomic-rename.

## Known limitations

- **Folder-level hard delete** isn't supported yet — delete files individually.
- **Watcher pauses during pull:** the watcher does still fire while pull is downloading files; the resulting no-op push is fast enough to be harmless, but if you have very large workspaces and notice churn, file an issue.
- **Single account per install.** Switching Google accounts means signing out + signing in with the new one. Files synced from the previous account remain in the local workspace; the manifest is reset.
- **First sync of a big workspace** is just a sequential upload. Parallel multi-file upload is not yet implemented.

---

Built with [`@nestbrain/sync`](../packages/sync). For implementation details, see the package's source.
