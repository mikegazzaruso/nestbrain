# MindNest

**LLM-powered personal knowledge base.** Raw sources go in, a structured Markdown wiki comes out — compiled, linked, and maintained entirely by AI.

![MindNest](https://img.shields.io/badge/status-Full_App-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What is MindNest?

MindNest ingests raw documents — articles, papers, PDFs, GitHub repos, arXiv papers, YouTube transcripts, RSS feeds — and uses an LLM to compile them into an interconnected wiki of Markdown files. The wiki is browsable through a stunning dark-mode web UI, compatible with Obsidian, and queryable via natural language.

**You feed sources. The LLM builds the knowledge base. You explore it.**

### Key Features

- **Ingest** — Paste a URL or upload files. Supports web pages, PDFs, GitHub repos, arXiv papers, YouTube transcripts, and RSS feeds.
- **Compile** — The LLM summarizes sources, extracts concepts, creates wiki articles with `[[wikilinks]]`, and builds a navigable knowledge graph. Compilation is incremental and scales to hundreds of sources.
- **Browse** — Wikipedia-style wiki browser with navigable wikilinks, backlinks panel, tags, breadcrumbs, and article translation (12 languages).
- **Mind Map** — Interactive radial visualization of concepts and their connections. Zoom, pan, click to navigate. Concepts branch organically from central nodes.
- **Ask** — Query your knowledge base in natural language. Answers are grounded in your wiki via hybrid semantic + keyword search, with filtered citations. Responds in the language you ask in.
- **Search** — Hybrid search: semantic (local embeddings via all-MiniLM-L6-v2) combined with weighted keyword search.
- **Health Check** — LLM-powered wiki auditing: finds orphans, broken links, stubs, inconsistencies, and suggests new articles. Dashboard with health score.
- **Translate** — Every wiki article can be translated on-the-fly to 12 languages via LLM.
- **Dark/Light Mode** — Toggle between dark and light themes.
- **Obsidian Compatible** — The `wiki/` folder is a valid Obsidian vault. Open it anytime.
- **CLI** — Full command-line interface: `ingest`, `compile`, `ask`, `search`, `lint`, `serve`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (monorepo) |
| Frontend | Next.js 16 (App Router) |
| Styling | Tailwind CSS |
| Embeddings | Local model via @huggingface/transformers (all-MiniLM-L6-v2) |
| LLM | Claude CLI (Max subscription) or OpenAI API |
| Diagrams | Mermaid (rendered inline in articles) |
| Monorepo | Turborepo + pnpm |
| Containerization | Docker + docker-compose |

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Claude CLI authenticated (`claude auth login`) **or** an OpenAI API key

### Install & Run

```bash
git clone git@github.com:mikegazzaruso/MindNest.git
cd MindNest
pnpm install
pnpm build
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### First Steps

1. Go to **Settings** — choose your LLM provider (Claude or OpenAI)
2. Go to **Ingest** — paste a URL, upload a file, or try a GitHub/arXiv/YouTube link
3. Click **Compile** in the sidebar — watch the progress indicator as the LLM builds your wiki
4. Browse the **Wiki**, explore the **Mind Map**, ask questions in **Ask**, run a **Health Check**

---

## Project Structure

```
MindNest/
├── apps/web/              # Next.js application (frontend + API)
│   ├── src/app/           # Pages: wiki, mindmap, search, ask, ingest, health, settings
│   ├── src/components/    # Sidebar, markdown renderer, mermaid, translate
│   └── src/lib/           # Compile state, theme, settings, logger, rate limiter
├── packages/
│   ├── core/              # Business logic
│   │   ├── ingest/        # URL, PDF, markdown, GitHub, arXiv, YouTube, RSS
│   │   ├── compiler/      # Wiki compilation with incremental tracking
│   │   ├── qa/            # Q&A with hybrid search + citation filtering
│   │   ├── search/        # Semantic + keyword hybrid search
│   │   ├── lint/          # Wiki health checks
│   │   ├── llm/           # Provider abstraction (Claude CLI, OpenAI)
│   │   └── vectorstore/   # Local embeddings + cosine similarity search
│   ├── shared/            # Shared types and constants
│   ├── db/                # Vector DB layer
│   └── cli/               # CLI entry point (all commands functional)
├── data/                  # Runtime data (gitignored)
│   ├── raw/               # Ingested source documents
│   └── wiki/              # Compiled wiki (Obsidian-compatible)
├── docker/                # Docker configuration (production-ready)
└── mindnest.yaml          # Configuration
```

---

## How It Works

```
URL / PDF / GitHub / arXiv            Compiled Wiki
YouTube / RSS / .md                        │
     │                                     ▼
     ▼                              ┌──────────────┐
┌─────────┐    ┌──────────┐   ┌───▶│  Wiki Files  │
│  Ingest  │───▶│ Compile  │───┤    │   (.md)      │
│ Pipeline │    │  (LLM)   │   │    └──────┬───────┘
└─────────┘    └──────────┘   │           │
                              │     ┌─────┼──────────────┐
                              │     ▼     ▼              ▼
                              │  ┌─────┐ ┌──────┐ ┌──────────┐
                              │  │Wiki │ │Mind  │ │  Health   │
                              │  │View │ │Map   │ │  Check    │
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

URLs are fetched and converted to Markdown (Readability + Turndown). PDFs are text-extracted. GitHub repos pull README + key files + file tree. arXiv papers download and extract the full PDF. YouTube fetches transcripts. RSS feeds ingest multiple entries. Everything lands in `data/raw/`.

### Compile

The LLM processes **only new/changed sources** (incremental). For each new source:
1. Generates a summary article
2. Extracts concepts from **only the new summary** (not all 200)
3. Writes articles for **new concepts only**, passing existing concept names for cross-linking
4. Embeds each article into the local vector index
5. Regenerates the master index and concept map

Cost: ~3-5 LLM calls per new source, regardless of total wiki size.

### Search

Hybrid approach running in parallel:
- **Semantic search** — query embedded via all-MiniLM-L6-v2, cosine similarity against vector index
- **Keyword search** — weighted scoring (title 5x, filename 3x, content 1x) with stop word filtering (EN + IT)
- Results merged with semantic getting 2x weight

### Q&A

1. Hybrid search finds top 8 relevant articles
2. Article bodies passed to LLM as context
3. LLM answers **in the user's language**
4. Citations filtered to only those actually referenced in the answer
5. Answer auto-saved to `wiki/outputs/`

### Health Check

Automated wiki auditing:
- Orphan detection (articles with no backlinks)
- Broken link detection
- Stub/empty article detection
- Gap analysis (frequently linked but non-existent concepts)
- LLM-powered inconsistency detection
- Health score dashboard

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

Uses your Claude Max subscription via the CLI. No API costs.

```bash
claude auth login  # authenticate once
```

### OpenAI

Uses the OpenAI API. Configure in Settings or set `OPENAI_API_KEY`.

Supports all models: GPT-4o, GPT-4 Turbo, GPT-5, o1, o3, o4 series. The provider automatically handles `max_tokens` vs `max_completion_tokens` and `system` vs `developer` role differences.

---

## CLI

All commands are fully functional:

```bash
mindnest ingest <source>       # Ingest any supported source
mindnest compile               # Compile wiki (incremental)
mindnest compile --force       # Recompile everything
mindnest ask "your question"   # Ask with citations
mindnest search "query"        # Hybrid search
mindnest lint                  # Run health check
mindnest serve                 # Start web UI
```

---

## Configuration

Settings are managed through the web UI (**Settings** page) and persisted in `data/settings.json`.

You can also edit `mindnest.yaml` for advanced options:

```yaml
wiki:
  name: "My Knowledge Base"
  path: "./data/wiki"
  raw_path: "./data/raw"

llm:
  provider: "claude-cli"  # or "openai"
  model: "sonnet"

embeddings:
  model: "Xenova/all-MiniLM-L6-v2"
  chunk_size: 512

search:
  semantic_top_k: 10

server:
  port: 3000
```

---

## Docker

```bash
cd docker
docker-compose up
```

This starts MindNest (production build) and a ChromaDB instance. Environment variables:

```bash
OPENAI_API_KEY=sk-...   # if using OpenAI
LOG_LEVEL=info           # debug | info | warn | error
PORT=3000
```

---

## Obsidian Integration

The `data/wiki/` directory is a fully compatible Obsidian vault:

- `[[wikilinks]]` work natively
- YAML frontmatter on every article
- Images with relative paths
- Graph view shows concept connections

Just open `data/wiki/` as a vault in Obsidian.

---

## Roadmap

- [x] **Phase 0** — Project skeleton
- [x] **Phase 1** — MVP (ingest, compile, wiki, search, Q&A, mind map, settings)
- [x] **Phase 2** — Full app (all ingest sources, linting, dashboard, translate, dark/light mode, CLI, Docker, health checks)

---

## Inspired By

This project is inspired by [Andrej Karpathy's workflow](https://x.com/karpathy) of using LLMs to build personal knowledge bases — compiling raw sources into interconnected wikis, querying them, and letting every interaction enrich the knowledge base over time.

> *"Raw data from a given number of sources is collected, then compiled by an LLM into a .md wiki, then operated on by various CLIs by the LLM to do Q&A and to incrementally enhance the wiki. I think there is room here for an incredible new product instead of a hacky collection of scripts."*

MindNest is that product.

---

## License

MIT
