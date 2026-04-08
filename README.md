# MindNest

**LLM-powered personal knowledge base.** Raw sources go in, a structured Markdown wiki comes out — compiled, linked, and maintained entirely by AI.

![MindNest](https://img.shields.io/badge/status-MVP-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What is MindNest?

MindNest ingests raw documents — articles, papers, PDFs, web pages — and uses an LLM to compile them into an interconnected wiki of Markdown files. The wiki is browsable through a stunning dark-mode web UI, compatible with Obsidian, and queryable via natural language.

**You feed sources. The LLM builds the knowledge base. You explore it.**

### Key Features

- **Ingest** — Paste a URL or upload files (.md, .pdf). MindNest fetches, parses, and stores the content.
- **Compile** — The LLM reads your sources, generates summaries, extracts concepts, creates wiki articles with `[[wikilinks]]`, and builds a navigable knowledge graph.
- **Browse** — Wikipedia-style wiki browser with backlinks, cross-references, tags, and breadcrumbs.
- **Mind Map** — Interactive tree-layout visualization of concepts and their connections. Zoom, pan, click to navigate.
- **Ask** — Query your knowledge base in natural language. Answers are grounded in your wiki articles via semantic search, with citations.
- **Search** — Semantic search powered by local embeddings (all-MiniLM-L6-v2). Falls back to keyword search.
- **Obsidian Compatible** — The `wiki/` folder is a valid Obsidian vault. Open it anytime.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (monorepo) |
| Frontend | Next.js 16 (App Router) |
| Styling | Tailwind CSS |
| Embeddings | Local model via @huggingface/transformers (all-MiniLM-L6-v2) |
| LLM | Claude CLI (Max subscription) or OpenAI API |
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
2. Go to **Ingest** — paste a URL or upload a file
3. Click **Compile** in the sidebar — watch the LLM build your wiki
4. Browse the **Wiki**, explore the **Mind Map**, ask questions in **Ask**

---

## Project Structure

```
MindNest/
├── apps/web/              # Next.js application (frontend + API)
├── packages/
│   ├── core/              # Business logic (ingest, compile, Q&A, search, LLM)
│   ├── shared/            # Shared types and constants
│   ├── db/                # Vector DB layer
│   └── cli/               # CLI entry point
├── data/                  # Runtime data (gitignored)
│   ├── raw/               # Ingested source documents
│   └── wiki/              # Compiled wiki (Obsidian-compatible)
├── docker/                # Docker configuration
└── mindnest.yaml          # Configuration
```

---

## How It Works

```
URL / PDF / .md                    Compiled Wiki
     │                                  │
     ▼                                  ▼
┌─────────┐    ┌──────────┐    ┌──────────────┐
│  Ingest  │───▶│ Compile  │───▶│  Wiki Files  │
│ Pipeline │    │  (LLM)   │    │   (.md)      │
└─────────┘    └──────────┘    └──────┬───────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                  ▼
             ┌────────────┐  ┌──────────────┐  ┌──────────────┐
             │  Semantic   │  │  Wiki        │  │  Mind Map    │
             │  Search     │  │  Browser     │  │  Graph       │
             └─────┬──────┘  └──────────────┘  └──────────────┘
                   │
                   ▼
            ┌────────────┐
            │  Q&A       │──▶ Answers saved back to wiki
            │  System    │
            └────────────┘
```

1. **Ingest** — URLs are fetched and converted to Markdown (via Readability + Turndown). PDFs are extracted. Files are copied. Everything lands in `data/raw/`.

2. **Compile** — The LLM processes each new source: generates a summary, extracts concepts, writes wiki articles with `[[wikilinks]]`. Compilation is incremental — unchanged sources are skipped. Every article is embedded into a local vector index for semantic search.

3. **Browse** — The web UI renders wiki articles with navigable wikilinks, backlinks panel, tag filtering, and breadcrumbs. The `data/wiki/` folder is also a valid Obsidian vault.

4. **Ask** — Questions are embedded and matched against the vector index. The top relevant articles are passed to the LLM as context. Answers include citations and are auto-saved to the wiki.

5. **Mind Map** — An interactive tree visualization built from the wiki's link graph. Concepts branch out from central nodes with organic bezier curves. Hover to highlight connections.

---

## LLM Providers

### Claude (default)

Uses your Claude Max subscription via the CLI. No API costs.

```bash
claude auth login  # authenticate once
```

### OpenAI

Uses the OpenAI API. Configure in Settings or set `OPENAI_API_KEY`.

Supports all models including GPT-4o, GPT-5, o1, o3, o4 series.

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

This starts MindNest and a ChromaDB instance for vector storage.

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
- [x] **Phase 1** — MVP (ingest, compile, wiki, search, Q&A, mind map)
- [ ] **Phase 2** — GitHub/arXiv/YouTube/RSS ingest, wiki linting, concept graph, slide export, auth layer, Docker production build

---

## Inspired By

This project is inspired by [Andrej Karpathy's workflow](https://x.com/karpathy) of using LLMs to build personal knowledge bases — compiling raw sources into interconnected wikis, querying them, and letting every interaction enrich the knowledge base over time.

> *"Raw data from a given number of sources is collected, then compiled by an LLM into a .md wiki, then operated on by various CLIs by the LLM to do Q&A and to incrementally enhance the wiki. I think there is room here for an incredible new product instead of a hacky collection of scripts."*

MindNest is that product.

---

## License

MIT
