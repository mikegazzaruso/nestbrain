# MindNest - Development Contract

**Version:** 1.0
**Date:** 2026-04-08
**Parties:** Mike (Product Owner) & Claude Code (Developer)

> This document is the single source of truth for the development of MindNest.
> No work begins until both parties sign off. Any change requires mutual agreement and a versioned amendment.

---

## 1. Product Definition

**MindNest** is a personal knowledge base platform where an LLM compiles raw source material into a structured, interconnected Markdown wiki. The user feeds sources; the system organizes, links, enriches, and maintains the knowledge — all browsable through a stunning Notion-like dark-mode web UI and compatible with Obsidian.

---

## 2. Tech Stack (Locked)

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript (monorepo) |
| **Runtime** | Node.js 20+ |
| **Frontend** | Next.js 14+ (App Router, React 18+) |
| **Styling** | Tailwind CSS + shadcn/ui |
| **Backend API** | Next.js API Routes (or tRPC if needed) |
| **Vector DB** | ChromaDB (embedded mode, local-first) |
| **Embeddings** | Local model via transformers.js (`all-MiniLM-L6-v2`) |
| **LLM Layer** | Provider-agnostic wrapper (claude-cli subprocess default, OpenAI API fallback) |
| **Search** | Vector semantic search (ChromaDB) + full-text search (FlexSearch) |
| **Package Manager** | pnpm |
| **Monorepo** | Turborepo |
| **Containerization** | Docker + docker-compose (prepared, not required for dev) |
| **Testing** | Vitest |
| **Linting** | ESLint + Prettier |

---

## 3. Architecture Overview

```
mindnest/
├── apps/
│   └── web/                    # Next.js application (frontend + API)
│       ├── app/                # App Router pages
│       │   ├── (dashboard)/    # Main wiki browser
│       │   ├── ask/            # Q&A interface
│       │   ├── ingest/         # Source ingestion UI
│       │   ├── search/         # Search interface
│       │   └── api/            # API routes
│       ├── components/         # React components
│       └── lib/                # Frontend utilities
├── packages/
│   ├── core/                   # Core business logic
│   │   ├── ingest/             # Ingestion pipeline
│   │   ├── compiler/           # Wiki compilation engine
│   │   ├── qa/                 # Q&A system
│   │   ├── lint/               # Wiki health checks
│   │   ├── search/             # Search engine
│   │   └── llm/               # LLM provider abstraction
│   ├── db/                     # ChromaDB + embeddings layer
│   ├── cli/                    # CLI entry point (mindnest command)
│   └── shared/                 # Shared types, utils, constants
├── data/                       # Runtime data (gitignored)
│   ├── raw/                    # Ingested source documents
│   │   └── assets/             # Downloaded images/media
│   ├── wiki/                   # Compiled wiki (Obsidian-compatible vault)
│   └── chromadb/               # Vector DB storage
├── docker/                     # Docker configuration
│   ├── Dockerfile
│   └── docker-compose.yml
├── mindnest.yaml               # User configuration
├── turbo.json                  # Turborepo config
├── package.json                # Root package.json
├── CLAUDE.md                   # LLM agent guide
├── DESIDERATA.md               # Requirements
├── ANTHROPIC.md                # LLM integration research
└── DEVELOPMENT_CONTRACT.md     # This file
```

---

## 4. Development Phases

### PHASE 0 — Skeleton
> **Goal:** Project scaffolding. Zero features, everything compiles and runs.

| # | Deliverable | Acceptance Criteria |
|---|-------------|-------------------|
| 0.1 | Monorepo setup (Turborepo + pnpm) | `pnpm install` succeeds, `pnpm build` succeeds |
| 0.2 | Next.js app with App Router | `pnpm dev` starts, shows a placeholder page |
| 0.3 | Tailwind + shadcn/ui configured | Dark mode default, Notion-like base theme visible |
| 0.4 | `packages/core` scaffold | Empty modules with exported types, builds cleanly |
| 0.5 | `packages/db` scaffold | ChromaDB client initializes, embeddings model loads |
| 0.6 | `packages/cli` scaffold | `mindnest --help` prints usage |
| 0.7 | `packages/shared` scaffold | Shared types exported and importable |
| 0.8 | Docker scaffold | `docker-compose up` builds and runs the app |
| 0.9 | ESLint + Prettier + Vitest configured | `pnpm lint` and `pnpm test` run (even if no tests yet) |
| 0.10 | `data/` directory structure | `raw/`, `wiki/`, `chromadb/` created, gitignored |
| 0.11 | `mindnest.yaml` default config | Config file with documented defaults |
| 0.12 | Git init + first commit | Clean repo, proper .gitignore |

**Exit Criteria:** `pnpm install && pnpm build && pnpm dev` works. Docker builds. CLI prints help. Empty dark-mode page renders.

---

### PHASE 1 — MVP
> **Goal:** Ingest 10 sources, compile a navigable wiki, ask questions against it.

| # | Deliverable | Acceptance Criteria |
|---|-------------|-------------------|
| **Ingest** | | |
| 1.1 | URL web ingestion | Provide a URL → clean Markdown saved in `raw/` with frontmatter |
| 1.2 | Local .md file ingestion | Drag/drop or select .md files → copied to `raw/` |
| 1.3 | PDF ingestion | Upload PDF → extracted text saved as .md in `raw/` |
| 1.4 | Image download | Images from web sources downloaded to `raw/assets/`, paths rewritten |
| 1.5 | Ingest Web UI | Page with input field (URL/upload), shows ingested sources list |
| **Compile** | | |
| 1.6 | Source summarization | Each raw source gets a summary article in `wiki/sources/` |
| 1.7 | Concept extraction | LLM identifies concepts, creates `wiki/concepts/` articles |
| 1.8 | Cross-linking | Articles contain `[[wikilinks]]` to related articles |
| 1.9 | Index generation | `wiki/_index.md` auto-maintained with all articles + summaries |
| 1.10 | Incremental compilation | Only new/changed sources reprocessed |
| 1.11 | Obsidian compatibility | `wiki/` folder opens in Obsidian as a valid vault |
| **Embeddings & Search** | | |
| 1.12 | Embedding pipeline | Every wiki article embedded and stored in ChromaDB on compile |
| 1.13 | Semantic search | Search query → top-K relevant articles via vector similarity |
| 1.14 | Full-text search | Keyword search as fallback/complement to semantic |
| 1.15 | Search Web UI | Search page with results, snippets, links to articles |
| **Q&A** | | |
| 1.16 | Ask a question | User asks → system retrieves relevant articles → LLM answers |
| 1.17 | Source citations | Answers include links to wiki articles used |
| 1.18 | Save answer to wiki | Option to file the answer back into `wiki/outputs/` |
| 1.19 | Q&A Web UI | Chat-like interface for asking questions |
| **Wiki Browser** | | |
| 1.20 | Article viewer | Render wiki .md files as styled pages (Notion-like, dark mode) |
| 1.21 | Sidebar navigation | Tree/list of all articles, collapsible by category |
| 1.22 | Backlinks panel | Each article shows what links to it |
| 1.23 | Tags & filtering | Filter articles by tags |
| **LLM Integration** | | |
| 1.24 | Claude CLI wrapper | `claude -p` subprocess wrapper with JSON output parsing |
| 1.25 | Provider abstraction | Interface so we can swap to API key or other providers later |
| 1.26 | System prompts | Dedicated prompts for: summarize, extract concepts, answer Q&A |

**Exit Criteria:** User can ingest 10 web URLs, run compile, browse the resulting wiki in the web UI, search it, and ask questions — getting answers with citations. The `wiki/` folder works in Obsidian.

---

### PHASE 2 — Full App
> **Goal:** All ingest sources, linting, advanced UI, production-ready.

| # | Deliverable | Acceptance Criteria |
|---|-------------|-------------------|
| **Additional Ingest** | | |
| 2.1 | GitHub repo ingestion | Provide repo URL → README + key files ingested |
| 2.2 | arXiv paper ingestion | arXiv URL → paper PDF downloaded, extracted, ingested |
| 2.3 | YouTube transcription | YouTube URL → transcript fetched and saved as .md |
| 2.4 | RSS feed ingestion | RSS URL → all/recent entries ingested as individual sources |
| 2.5 | Bulk ingest | Ingest multiple sources at once (list of URLs, folder of files) |
| **Linting & Health** | | |
| 2.6 | Inconsistency detection | LLM finds contradictions across articles |
| 2.7 | Orphan detection | Find articles with no backlinks |
| 2.8 | Gap analysis | Suggest new articles based on concept gaps |
| 2.9 | Health report | Markdown report with all findings |
| 2.10 | Lint Web UI | Dashboard showing wiki health metrics |
| **Advanced UI** | | |
| 2.11 | Concept graph visualization | Interactive node graph of concepts and their connections |
| 2.12 | Dashboard home | Overview: stats, recent articles, recent queries, health score |
| 2.13 | Article editor | Edit wiki articles from the web UI (with LLM assist) |
| 2.14 | Marp slide export | Generate presentation from articles/query results |
| 2.15 | Chart/diagram rendering | Mermaid diagrams rendered inline in articles |
| 2.16 | Image viewer/gallery | Browse all images in the knowledge base |
| 2.17 | Dark/light mode toggle | Default dark, option to switch |
| **Infrastructure** | | |
| 2.18 | Auth layer (prepared) | Login/session system ready but disabled by default |
| 2.19 | Docker production build | Optimized multi-stage Docker build |
| 2.20 | Environment config | `.env` support for secrets, config validation |
| 2.21 | Error handling & logging | Structured logging, user-friendly error messages |
| 2.22 | Rate limiting | LLM call rate limiting to avoid quota issues |
| **CLI** | | |
| 2.23 | `mindnest ingest <source>` | Full CLI for all ingest types |
| 2.24 | `mindnest compile` | Trigger compilation from terminal |
| 2.25 | `mindnest ask "<q>"` | Ask questions from terminal |
| 2.26 | `mindnest search "<q>"` | Search from terminal |
| 2.27 | `mindnest lint` | Run health checks from terminal |
| 2.28 | `mindnest serve` | Start the web UI |

**Exit Criteria:** All ingest sources work. Wiki linting operational. Concept graph renders. Docker image builds and runs. CLI fully functional. UI is polished, stunning, Notion-like dark mode.

---

## 5. Design Principles (Immutable)

1. **The LLM writes the wiki, not the user.** The user feeds sources and asks questions. The LLM does the rest.
2. **Markdown is the source of truth.** The wiki is a directory of `.md` files. No proprietary format. No lock-in.
3. **Obsidian-compatible always.** `[[wikilinks]]`, YAML frontmatter, relative image paths. The `wiki/` folder must open in Obsidian at any time.
4. **Incremental, not destructive.** Compilation adds/updates articles. It never wipes the wiki. Unchanged sources are skipped.
5. **Local-first.** Everything runs on the user's machine. Cloud needed only for LLM calls. No telemetry.
6. **Provider-agnostic LLM layer.** Today it's Claude via CLI. Fallback is OpenAI API. Future: Ollama, others. The abstraction must support this.
7. **Every interaction enriches the wiki.** Q&A results, lint findings, explorations — all can be filed back into the knowledge base.

---

## 6. UI Design Direction

- **Aesthetic:** Notion-like. Clean, spacious, typographically beautiful.
- **Color scheme:** Dark mode default. Deep grays (#0a0a0a, #1a1a1a), subtle borders, accent color for links and actions.
- **Typography:** Inter or similar clean sans-serif. Good heading hierarchy. Comfortable reading width.
- **Animations:** Subtle transitions, smooth page changes. Wow factor through polish, not gimmicks.
- **Layout:** Sidebar (collapsible) + main content area. Breadcrumbs for navigation.
- **Components:** shadcn/ui as base, customized to match the aesthetic.

---

## 7. Wiki Article Format (Locked)

```markdown
---
title: "Article Title"
created: 2026-04-08
updated: 2026-04-08
source: "raw/filename.md"
type: concept | source-summary | qa-output | lint-report
tags: [tag1, tag2]
backlinks: ["[[Other Article]]"]
summary: "One-line summary for index files"
---

# Article Title

Content with [[wikilinks]] to other articles.

## See Also

- [[Related Article]]
```

---

## 8. Configuration Format (Locked)

```yaml
# mindnest.yaml

wiki:
  name: "My Knowledge Base"
  path: "./data/wiki"
  raw_path: "./data/raw"

llm:
  provider: "claude-cli"        # claude-cli | openai | ollama
  model: "sonnet"
  max_turns: 5
  # api_key: env:OPENAI_API_KEY  # for OpenAI fallback mode

embeddings:
  model: "all-MiniLM-L6-v2"    # local model via transformers.js
  chunk_size: 512
  chunk_overlap: 50

search:
  semantic_top_k: 10
  fulltext_enabled: true

server:
  port: 3000
  host: "localhost"
```

---

## 9. Rules of Engagement

1. **Phase gates are strict.** We do not start Phase N+1 until Phase N exit criteria are fully met.
2. **No scope creep within a phase.** If we discover something new, it goes into the next phase.
3. **Test as we go.** Each deliverable includes basic tests. No accumulating tech debt.
4. **Commit often.** Small, focused commits with clear messages.
5. **This contract can be amended** only by mutual agreement. Amendments are versioned (v1.1, v1.2, etc.) with date and rationale.

---

## 10. Sign-Off

```
┌─────────────────────────────────────────────┐
│                                             │
│  Mike (Product Owner)         : ✓ Approved   │
│  Claude Code (Developer)      : ✓ Approved   │
│                                              │
│  Date: 2026-04-08                            │
│  Version: 1.0                                │
│                                              │
└──────────────────────────────────────────────┘
```

> **Status: SIGNED — DEVELOPMENT AUTHORIZED**
> Signed by both parties on 2026-04-08. Phase 0 may begin.
