# NestBrain

**Your AI-powered second brain — now as a native Mac/Windows app.** Raw sources go in, a structured Markdown wiki comes out — compiled, linked, and maintained entirely by AI, inside a workspace with an integrated editor, terminal, and session-aware AI assistant.

![NestBrain](https://img.shields.io/badge/status-v0.10.0-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue) ![License](https://img.shields.io/badge/license-GPL--3.0-blue) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

---

## Get NestBrain

NestBrain is **free and open source** under GPL-3.0. You can clone this repo and build the app from source yourself, at no cost, forever.

If you want **zero-hassle installation**, lifetime updates, and to support independent development, the **official signed and notarized binaries** are available as a one-time paid license:

| | Free (from source) | Supporter License |
|---|---|---|
| **Price** | €0 | *Coming soon* |
| **Source code** | ✅ Full GPL-3.0 source | ✅ Same source |
| **Features** | ✅ Everything below | ✅ Everything below |
| **Build yourself** | Required | Optional |
| **Signed & notarized builds** | ❌ Build yourself | ✅ macOS DMG + Windows NSIS |
| **Lifetime updates** | Rebuild on new commits | ✅ Automatic download |
| **Support** | Community (GitHub issues) | ✅ Email |

Both paths get you the **same product**. The paid license buys convenience and directly funds continued development.

> The Supporter License storefront is coming online soon. Until then, [build from source](#build-from-source) — it takes 2 commands.

---

## What NestBrain does

NestBrain ingests raw documents — web pages, PDFs, GitHub repos, arXiv papers, YouTube transcripts, RSS feeds — and uses an LLM to compile them into an interconnected wiki of Markdown files. Everything lives inside a **NestBrain workspace** on your disk: browsable through a dark-mode native UI, compatible with Obsidian, queryable in natural language, and fully self-hostable.

On top of the knowledge base, NestBrain is also an **integrated workspace**: a VS Code-style file tree, a built-in code editor, a real PTY terminal, and a skill system that lets Claude Code track your work sessions across projects.

**You feed sources. The LLM builds the knowledge base. You explore, edit, and work alongside it.**

---

## Key Features

### Native desktop app
- **Cross-platform** — Packaged as a native macOS (DMG, signed & notarized with Apple Developer ID) and Windows (NSIS installer) app via Electron wrapping a Next.js standalone server
- **NestBrain workspace** — On first run, the app creates a `NestBrain/` folder scaffolded with `Business/`, `Context/`, `Daily/`, `Library/`, `Projects/`, `Skills/`, `Team/`. The compiled wiki lives in `Library/Knowledge/` (Obsidian-compatible)
- **Guided onboarding** — 6-step first-run flow: welcome → explanation → directory picker → LLM provider → interactive first ingest → compile → celebration
- **Movable workspace** — Settings page lets you relocate NestBrain to a different disk location; existing data is moved safely, cross-device fallback included

### VS Code-style workspace
- **File tree sidebar** — Foldable explorer rooted at NestBrain, **auto-refresh** via native FSEvents/ReadDirectoryChangesW watcher (debounced 500 ms) so Finder and terminal changes appear instantly
- **Right-click context menu** — **Open**, **Rename** (inline editing in the tree), **Delete** (with confirmation and protection for workspace-critical dirs like `.nestbrain/`, `Daily/`, `Library/`)
- **New File / New Folder** — Inline input rooted at the currently-selected directory, with automatic editor open for new files
- **In-app editor** — CodeMirror 6-based editor opens on double-click, with syntax highlighting for **~100 languages** (lazy-loaded via `@codemirror/language-data`), **Cmd/Ctrl+S** to save, dirty indicator, and a **triple-layer unsaved-changes guard** (tab close button, window close, client-side nav)
- **Integrated terminal** — Real PTY (xterm.js + node-pty), multi-session tabs, resizable bottom panel, always-available status-bar toggle, full shell per project
- **New Project button** — Creates `NestBrain/Projects/<name>` and immediately opens a terminal session cwd'd into it

### Session-aware AI assistant
NestBrain ships with a **Skills system** that lets Claude Code track your work across sessions. When you create a new workspace, the app copies a `CLAUDE.md` and two skills into `NestBrain/Skills/`:

- **`start_session`** — Say *"Buongiorno, Claude"* or *"Good morning, Claude"* to begin a session. Claude recaps the previous session (*"Yesterday you worked on..."* / *"In your previous session today..."*) and starts logging macro-tasks to a timestamped file in `Daily/`
- **`end_session`** — Say *"Arrivederci, Claude"* or *"Goodbye, Claude"* to close the session. Claude writes a **Summary**, a **Next** section (unfinished work, next steps per project), a compact **Git snapshot** (branch, hash, dirty count), and updates **`Projects/<name>/.nest/STATE.md`** for every project touched
- **Per-project STATE.md** — A tiny file containing Purpose, Current status, Next up, Last touched — the context handoff file between Claude Code sessions. Launch `claude` from inside a project and it picks up exactly where you left off
- **Orphan session detection** — If you quit Claude Code without saying goodbye, the next session detects the open log file and resumes it instead of starting fresh

### Knowledge base engine
- **Ingest** — URLs, PDFs, GitHub repos, arXiv papers, YouTube transcripts, RSS feeds. **Duplicate detection** with confirmation dialog before overwriting
- **Compile** — Incremental LLM compilation: only new/changed sources are processed. ~3–5 LLM calls per source regardless of total wiki size. **Auto-compile** toggle runs compilation after every ingest
- **Browse** — Wikipedia-style wiki view with navigable `[[wikilinks]]`, backlinks panel, tags, breadcrumbs, translation to 12 languages
- **Mind Map** — Interactive radial visualization of concept connections. Zoom, pan, click to navigate
- **Ask** — Natural-language Q&A grounded in the wiki. Responses in the user's language with filtered citations
- **Search** — Hybrid search combining local semantic embeddings (all-MiniLM-L6-v2) and weighted keyword search, normalized to [0,1] so semantic dominates
- **Health Check** — LLM-powered wiki audit: orphan/broken-link/stub detection, gap analysis, inconsistency flagging
- **Obsidian compatibility** — `Library/Knowledge/` is a valid Obsidian vault; open it in Obsidian and work on the same data concurrently
- **CLI** — Full command-line interface alongside the desktop app: `ingest`, `compile`, `ask`, `search`, `lint`, `serve`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 33 + electron-builder + @electron/notarize |
| Language | TypeScript (monorepo) |
| Frontend | Next.js 16 (App Router, standalone build) |
| Styling | Tailwind CSS |
| Editor | CodeMirror 6 + `@codemirror/language-data` (~100 languages) |
| Terminal | xterm.js + node-pty |
| Embeddings | Local model via `@huggingface/transformers` + `onnxruntime-node` (all-MiniLM-L6-v2) |
| LLM | Claude CLI (Max subscription) or OpenAI API |
| Diagrams | Mermaid (rendered inline in articles) |
| File watching | Native `fs.watch` (FSEvents on macOS, ReadDirectoryChangesW on Windows) |
| Monorepo | Turborepo + pnpm workspaces |
| CI/CD | GitHub Actions: Mac arm64 + Win x64 builds, Apple notarization, private release publishing |

---

## Build from Source

### Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Claude CLI authenticated (`claude auth login`) **or** an OpenAI API key

### Run the native desktop app (development)
```bash
git clone git@github.com:mikegazzaruso/nestbrain.git
cd nestbrain
pnpm install
pnpm desktop:build
pnpm --filter @nestbrain/desktop start
```

On first launch the onboarding flow walks you through creating your NestBrain workspace and choosing an LLM provider.

### Package a distributable binary
```bash
pnpm desktop:package:mac    # → apps/desktop/release/*.dmg (signed if you have a Developer ID cert)
pnpm desktop:package:win    # → apps/desktop/release/*.exe (NSIS installer)
```

Local builds use your own keychain / cert if present; otherwise they produce an unsigned binary (which macOS Gatekeeper will flag as "damaged" — run `xattr -cr /path/to/NestBrain.app` to strip the quarantine xattr).

---

## Project Structure

```
nestbrain/
├── apps/
│   ├── desktop/            # Electron main process, preload, icons, packaging
│   │   ├── src/main.ts     # PTY mgr, IPC, Next.js standalone wrapper, PATH fix, file watcher
│   │   ├── src/preload.ts  # contextBridge API exposed to the renderer
│   │   └── build/          # Icon pipeline, copy-assets, prepare-standalone, after-pack
│   └── web/                # Next.js application (frontend + API)
│       ├── src/app/        # Pages: wiki, mindmap, search, ask, ingest, health, settings, editor
│       ├── src/components/ # Sidebar, file tree (+context menu), editor, terminal, onboarding
│       └── src/lib/        # Contexts, native loader, settings
├── packages/
│   ├── core/               # Business logic
│   │   ├── ingest/         # URL, PDF, markdown, GitHub, arXiv, YouTube, RSS
│   │   ├── compiler/       # Wiki compilation with incremental tracking
│   │   ├── qa/             # Q&A with hybrid search + citation filtering
│   │   ├── search/         # Semantic + keyword hybrid search (normalized)
│   │   ├── lint/           # Wiki health checks
│   │   ├── llm/            # Provider abstraction (Claude CLI, OpenAI)
│   │   └── vectorstore/    # Local embeddings + cosine similarity search
│   ├── shared/             # Shared types and constants
│   ├── db/                 # Vector DB layer
│   └── cli/                # CLI entry point
├── skeleton/               # Template copied into new NestBrain workspaces on setup
│   ├── CLAUDE.md           # Workspace orientation for Claude Code
│   └── Skills/
│       ├── start_session/SKILL.md
│       └── end_session/SKILL.md
├── .github/workflows/      # CI/CD (release.yml: Mac + Win builds, notarization, release publish)
└── NestBrain/              # User workspace (created during onboarding, NOT committed)
    ├── Business/ Context/ Daily/ Library/ Projects/ Skills/ Team/
    ├── CLAUDE.md           # Copied from skeleton/
    ├── Skills/             # Copied from skeleton/
    ├── Library/Knowledge/  # Compiled wiki (Obsidian-compatible)
    └── .nestbrain/         # Internal state (raw sources, settings, vector index)
```

---

## How It Works

```
URL / PDF / GitHub / arXiv            Compiled Wiki
YouTube / RSS / .md                        │
     │                                     ▼
     ▼                              ┌──────────────┐
┌─────────┐    ┌──────────┐   ┌───▶│  Wiki Files  │
│  Ingest │───▶│ Compile  │───┤    │   (.md)      │
│ Pipeline│    │  (LLM)   │   │    └──────┬───────┘
└─────────┘    └──────────┘   │           │
                              │     ┌─────┼──────────────┐
                              │     ▼     ▼              ▼
                              │  ┌─────┐ ┌──────┐ ┌──────────┐
                              │  │Wiki │ │Mind  │ │  Health  │
                              │  │View │ │Map   │ │  Check   │
                              │  └─────┘ └──────┘ └──────────┘
                              │
                              └───▶ Vector Index
                                        │
                              ┌─────────┘
                              ▼
                       ┌────────────┐
                       │  Hybrid    │
                       │  Search    │──▶ Q&A ──▶ Auto-saved to wiki
                       └────────────┘
```

### Ingest
URLs are fetched and converted to Markdown (Readability + Turndown). PDFs are text-extracted via pdfjs-dist. GitHub repos pull README + key files + file tree. arXiv papers download and extract the full PDF. YouTube fetches transcripts. RSS feeds ingest multiple entries. Everything lands in `NestBrain/.nestbrain/raw/`. Duplicates are detected and require confirmation.

### Compile
The LLM processes **only new/changed sources** (incremental). For each new source:
1. Generates a summary article
2. Extracts concepts from **only the new summary**
3. Writes articles for **new concepts only**, passing existing concept names for cross-linking
4. Embeds each article into the local vector index
5. Regenerates the master index and concept map

Cost: ~3–5 LLM calls per new source, regardless of total wiki size. With auto-compile enabled this runs automatically after every ingest.

### Search
Hybrid approach running in parallel, with scores **normalized to [0,1]** before being combined:
- **Semantic search** (weight 0.7) — query embedded via all-MiniLM-L6-v2, cosine similarity against the vector index
- **Keyword search** (weight 0.3) — weighted scoring (title 5x, filename 3x, content 1x) with stop-word filtering (EN + IT)

### Q&A
1. Hybrid search finds top relevant articles
2. Article bodies passed to LLM as context
3. LLM answers **in the user's language**
4. Citations filtered to only those actually referenced in the answer
5. Answer auto-saved to `Library/Knowledge/outputs/`

### Integrated terminal
The Electron main process runs real PTY sessions via node-pty. Each session is tied to a `BrowserWindow` and streamed over IPC to an xterm.js frontend. Tabs, resize, keep-alive on hide, and a status-bar toggle are all first-class.

### Health Check
Automated wiki auditing: orphan detection, broken link detection, stub/empty article detection, gap analysis, LLM-powered inconsistency detection, health score dashboard.

---

## Supported Ingest Sources

| Source | Example | What's Extracted |
|--------|---------|-----------------|
| Web URL | `https://example.com/article` | Clean article text + images |
| PDF | Upload `.pdf` file | Full text extraction |
| Markdown | Upload `.md` file | Direct copy with frontmatter |
| GitHub | `https://github.com/user/repo` | README, key files, file tree, metadata |
| arXiv | `https://arxiv.org/abs/2301.00001` | Abstract, full paper text, metadata |
| YouTube | `https://youtube.com/watch?v=...` | Auto-generated transcript |
| RSS | `https://example.com/feed.xml` | Latest entries as individual sources |

---

## LLM Providers

### Claude (default)
Uses your Claude Max subscription via the CLI. No API costs, no bans — the native app spawns the CLI in the background.

```bash
claude auth login  # authenticate once
```

> NestBrain extends the packaged Electron app's `PATH` at startup so the `claude` CLI is found even when installed in `~/.npm-global/bin`, `/opt/homebrew/bin`, or other non-default locations.

### OpenAI
Uses the OpenAI API. Configure in Settings.

Supports GPT-4o, GPT-4 Turbo, GPT-5, o1, o3, o4 series. The provider automatically handles `max_tokens` vs `max_completion_tokens` and `system` vs `developer` role differences.

---

## CLI

All commands work alongside the desktop app:

```bash
nestbrain ingest <source>       # Ingest any supported source
nestbrain compile               # Compile wiki (incremental)
nestbrain compile --force       # Recompile everything
nestbrain ask "your question"   # Ask with citations
nestbrain search "query"        # Hybrid search
nestbrain lint                  # Run health check
nestbrain serve                 # Start web UI
```

---

## Sessions & Skills

Every NestBrain workspace ships with a `CLAUDE.md` and a `Skills/` directory, auto-copied from [`skeleton/`](skeleton/) on first run.

**Workflow**:
```
$ cd NestBrain/Projects/my-api
$ claude                              # launches Claude Code
> Buongiorno, Claude                  # triggers start_session skill

  In your previous session today you:
  - Wired FastAPI + Postgres
  - Added /users routes
  - Left /auth routes stubbed (JWT impl pending)

  Session started. What shall we work on?

> let's finish the auth routes
  ... (work happens, Claude logs macro-tasks to Daily/2026-04-13_09-30-00.md)

> Arrivederci, Claude                 # triggers end_session skill

  Session closed. 1h 47m across 1 project.
  - Summary, Next, and Git snapshot written to the session file
  - Projects/my-api/.nest/STATE.md updated with current status + next up
```

The `.nest/STATE.md` file is the **context handoff**: future sessions (even on different machines after a git pull) read it first and immediately know where to resume.

---

## Configuration

Settings are managed through the **Settings** page in the app. They are persisted in `NestBrain/.nestbrain/settings.json`, including:

- LLM provider (Claude CLI / OpenAI) + model
- OpenAI API key
- Auto-compile toggle
- Onboarding completion flag
- NestBrain workspace location (movable from Settings)
- Danger-zone wipe

---

## Obsidian Integration

`NestBrain/Library/Knowledge/` is a fully compatible Obsidian vault:

- `[[wikilinks]]` work natively
- YAML frontmatter on every article
- Images with relative paths
- Graph view shows concept connections

Open `NestBrain/Library/Knowledge/` as a vault in Obsidian — you can work on the same knowledge base from both NestBrain and Obsidian simultaneously.

---

## Release & Distribution

NestBrain uses a **free-source / paid-binary** distribution model (similar to Sublime Text, Obsidian Catalyst, Standard Notes). Here's how the pipeline works:

- **Source code** — Fully public on [mikegazzaruso/nestbrain](https://github.com/mikegazzaruso/nestbrain) under GPL-3.0. Free to clone, build, and run forever.
- **CI/CD** — Every push to `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) which builds Mac arm64 + Win x64 binaries in parallel on GitHub Actions runners.
- **Code signing** — Mac builds are signed with an Apple **Developer ID Application** certificate (stored as an encrypted GitHub secret) and **notarized** via Apple's notary service using an app-specific password. Users get a Gatekeeper-clean install on first launch.
- **Distribution** — Successful signed builds are published to a **private** GitHub repo `mikegazzaruso/nestbrain-releases`. Buyers of the Supporter License get read access to this repo via Polar.sh's GitHub Repository Access integration — they can pull new releases directly from GitHub with zero ceremony.
- **Local workspaces** — User data lives entirely in `NestBrain/` on disk. No cloud lock-in, no account, no telemetry.

This keeps the open source story clean (anyone can read and build the source) while letting supporters contribute financially in exchange for convenience.

---

## Author

Created by **Mike Gazzaruso** ([NextEpochs](https://github.com/mikegazzaruso)) in 2026.
Copyright © 2026 NextEpochs. All rights reserved.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
