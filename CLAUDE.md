# NestBrain

LLM-powered personal knowledge base platform. Raw sources go in, a structured Markdown wiki comes out — compiled, linked, and maintained entirely by AI.

## Project Overview

NestBrain ingests raw documents (articles, papers, repos, images) and uses LLM agents to compile them into an interconnected wiki of Markdown files. The wiki is viewable in Obsidian or a built-in web UI. Users query the knowledge base, and every interaction enriches it over time.

## Architecture

```
NestBrain_OK/
├── CLAUDE.md            # This file — project guide for the LLM agent
├── DESIDERATA.md        # Requirements and design document
├── nestbrain.yaml        # Project configuration
├── raw/                 # Source documents (user-provided)
│   ├── assets/          # Downloaded images and media
│   └── ...              # Articles, papers, PDFs, etc.
├── wiki/                # Compiled wiki (LLM-generated, Obsidian-compatible)
│   ├── _index.md        # Master index with summaries
│   ├── _concepts.md     # Concept map
│   ├── concepts/        # One .md per extracted concept
│   ├── sources/         # Summaries of raw sources
│   ├── outputs/         # Q&A results, slides, charts
│   └── ...
├── src/                 # Application source code
│   ├── cli/             # CLI entry points (ingest, compile, ask, lint, search)
│   ├── ingest/          # Ingestion pipeline (URL→MD, PDF→MD, etc.)
│   ├── compiler/        # Wiki compilation engine
│   ├── qa/              # Q&A system
│   ├── lint/            # Wiki health checks
│   ├── search/          # Search engine
│   └── utils/           # Shared utilities
├── web/                 # Web UI (browse, search, trigger operations)
├── tests/               # Test suite
└── docs/                # Project documentation
```

## Tech Stack

- **Language**: Python 3.11+
- **CLI framework**: Click
- **LLM integration**: Anthropic SDK (Claude API) — used at runtime for wiki compilation, Q&A, linting
- **Web UI**: FastAPI + lightweight frontend
- **Search**: Whoosh or similar lightweight full-text search
- **Config**: YAML (`nestbrain.yaml`)
- **Package manager**: uv (preferred) or pip

## Key Commands

```bash
nestbrain ingest <source>       # Ingest a URL, file, or directory into raw/
nestbrain compile               # Compile raw/ into wiki/ (incremental)
nestbrain ask "<question>"      # Ask a question against the wiki
nestbrain search "<query>"      # Full-text search over the wiki
nestbrain lint                  # Run health checks on the wiki
nestbrain serve                 # Start the web UI
```

## Coding Conventions

- Use type hints on all function signatures.
- Write docstrings only for public API functions.
- Keep modules focused — one responsibility per file.
- Use `pathlib.Path` for all file system operations.
- All wiki output must be valid Markdown with YAML frontmatter.
- Use `[[wikilinks]]` syntax for internal wiki links (Obsidian compatibility).
- Handle errors at boundaries (CLI, API endpoints); let exceptions propagate internally.
- Prefer simple, direct implementations over abstractions.

## Wiki File Format

Every generated wiki article must follow this structure:

```markdown
---
title: "Article Title"
created: 2025-01-15
updated: 2025-01-15
source: "raw/filename.md"         # if derived from a source
tags: [concept, topic]
backlinks: ["[[Other Article]]"]
---

# Article Title

Content here...

## See Also

- [[Related Article]]
- [[Another Article]]
```

## LLM Agent Guidelines

- The wiki is the LLM's domain. Generate and maintain all wiki content programmatically.
- Always be incremental: don't reprocess unchanged sources during compilation.
- Maintain `_index.md` and `_concepts.md` as the wiki's navigational backbone.
- When answering questions, cite wiki articles by linking to them.
- When linting, produce actionable suggestions with specific file references.
- Minimize token usage: read indexes and summaries first, then dive into full articles only when needed.
- Never delete user-provided raw data. Wiki content can be regenerated.

## Testing

- Run tests with `pytest`.
- Test the CLI commands, compilation logic, and search independently.
- Use fixtures for sample raw data and expected wiki output.

## Important Notes

- The `raw/` directory contains user data — never modify or delete its contents.
- The `wiki/` directory is fully regenerable from `raw/` — treat it as a build artifact.
- API keys must come from environment variables or `nestbrain.yaml`, never hardcoded.
- All file paths in the wiki must be relative for portability.
