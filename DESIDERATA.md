# MindNest - DESIDERATA

## 1. Vision

MindNest is a personal knowledge base platform where LLMs act as the primary authors and maintainers of a structured wiki. Users feed raw source material, and the system compiles, organizes, links, and continuously enriches a collection of Markdown articles — all viewable and navigable through Obsidian (or a built-in web UI).

The guiding principle: **the user never writes the wiki manually; the LLM does.**

---

## 2. Original Concept Breakdown

### 2.1 Data Ingest

- Users collect source documents (articles, papers, repos, datasets, images) into a `raw/` directory.
- An LLM incrementally **compiles** the raw data into a structured wiki (`.md` files in a directory tree).
- The wiki includes:
  - Summaries of every item in `raw/`.
  - Backlinks between articles.
  - Concept extraction and categorization.
  - Auto-generated articles for each concept.
  - Cross-linking across all articles.
- Web content is clipped to Markdown (e.g. via Obsidian Web Clipper or similar).
- Related images are downloaded locally so the LLM can reference them.

### 2.2 IDE / Frontend

- Obsidian serves as the primary viewing layer for:
  - Raw source data.
  - The compiled wiki.
  - Derived visualizations (slides, charts, diagrams).
- The LLM writes and maintains all wiki data; the user rarely edits directly.
- Plugins extend rendering: Marp (slides), chart renderers, etc.

### 2.3 Q&A / Research

- Once the wiki reaches critical mass (~100+ articles, ~400K+ words), users can ask complex questions and the LLM researches answers across the wiki.
- No heavy RAG infrastructure needed at small scale — the LLM auto-maintains index files and brief summaries, reading related data on demand.

### 2.4 Output

- Answers are rendered as:
  - Markdown articles.
  - Slide decks (Marp format).
  - Charts and images (matplotlib or similar).
  - Viewable directly in Obsidian or the web UI.
- Outputs can be **filed back** into the wiki, so every query enriches the knowledge base over time.

### 2.5 Linting / Health Checks

- LLM-driven audits over the wiki:
  - Find inconsistent data.
  - Impute missing data (with web search).
  - Discover interesting connections for new article candidates.
  - Suggest further questions to explore.
- Incremental cleanup to improve data integrity.

### 2.6 Extra Tools

- Custom CLI tools for processing data (e.g. a naive search engine over the wiki).
- Tools are usable both by the user (via web UI) and by the LLM (via CLI) for larger queries.

### 2.7 Future Directions

- Synthetic data generation + fine-tuning so the LLM internalizes the knowledge in its weights rather than relying solely on context windows.

---

## 3. Requirements (Desiderata for Implementation)

### R01 - Project Scaffolding

- Monorepo structure with clear separation: `raw/`, `wiki/`, `tools/`, `web/`, `config/`.
- Git-tracked so the entire knowledge base is versioned.
- A `CLAUDE.md` at the root to guide the LLM agent.

### R02 - Raw Data Ingestion Pipeline

- A CLI command (e.g. `mindnest ingest <source>`) that:
  - Accepts URLs, local files (PDF, HTML, MD, TXT, images), or directories.
  - Converts web pages to clean Markdown (stripping boilerplate).
  - Downloads and stores related images locally in `raw/assets/`.
  - Stores the result in `raw/` with metadata frontmatter (source URL, date, title, type).
- Bulk ingest mode for multiple sources at once.

### R03 - Wiki Compilation Engine

- A CLI command (e.g. `mindnest compile`) that:
  - Scans `raw/` for new or updated sources.
  - Generates or updates summary articles in `wiki/`.
  - Extracts concepts/entities and creates dedicated concept pages.
  - Builds backlinks and cross-references between articles.
  - Maintains a master index (`wiki/_index.md`) with brief summaries of every article.
  - Maintains a concept map (`wiki/_concepts.md`).
  - Is **incremental** — only reprocesses changed/new sources, not the entire corpus.
- The compilation is driven by LLM calls at runtime (Anthropic SDK / Claude API).

### R04 - Q&A System

- A CLI command (e.g. `mindnest ask "<question>"`) that:
  - Reads the wiki index and relevant articles.
  - Researches the answer across the knowledge base.
  - Returns a well-structured Markdown answer.
  - Optionally saves the answer back into the wiki (`--save` flag).
- Interactive mode for follow-up questions with context retention.

### R05 - Output Rendering

- Support multiple output formats:
  - **Markdown** (default) — viewable in Obsidian or any MD viewer.
  - **Marp slides** — for presentations.
  - **Images** — charts/diagrams via matplotlib, mermaid, or similar.
- A CLI flag to choose format: `mindnest ask "..." --format slides`.
- Output files saved to `wiki/outputs/` or a user-specified path.

### R06 - Wiki Linting & Health Checks

- A CLI command (e.g. `mindnest lint`) that:
  - Detects inconsistencies across articles.
  - Finds orphan pages (no backlinks).
  - Identifies missing data and suggests or auto-fills it (with web search).
  - Proposes new article candidates based on concept gaps.
  - Generates a health report in Markdown.

### R07 - Search Engine

- A built-in search tool:
  - Full-text search over the wiki.
  - Usable via CLI (`mindnest search "<query>"`).
  - Usable via a lightweight web UI.
  - Exposable as an MCP tool so the LLM agent can call it during research.

### R08 - Web UI

- A minimal, clean web interface for:
  - Browsing the wiki (rendered Markdown).
  - Viewing the concept graph visually.
  - Searching.
  - Triggering ingest/compile/lint operations.
- Tech stack: lightweight (e.g. Next.js or simple Flask/FastAPI + static frontend).

### R09 - Obsidian Compatibility

- The `wiki/` directory must be a valid Obsidian vault:
  - Standard `[[wikilinks]]` syntax for internal links.
  - YAML frontmatter on every article.
  - Images referenced with relative paths.
  - A `.obsidian/` config directory (optional, gitignored).

### R10 - Configuration

- A `mindnest.yaml` (or `.mindnestrc`) config file for:
  - LLM provider and model selection.
  - API keys (or reference to env vars).
  - Wiki compilation rules (depth, summary length, link style).
  - Output format defaults.
  - Ignored source patterns.

### R11 - Extensibility

- Plugin/tool architecture so users can add:
  - Custom ingest adapters (e.g. for specific APIs, RSS feeds).
  - Custom output renderers.
  - Custom lint rules.
- Tools are callable by the LLM agent as CLI subcommands.

### R12 - Incremental Knowledge Growth

- Every interaction (Q&A, lint, manual exploration) can optionally feed results back into the wiki.
- The knowledge base is designed to compound over time.
- Deduplication and merge logic when new data overlaps with existing articles.

---

## 4. Implementation Priorities

| Priority | Requirement | Rationale |
|----------|-------------|-----------|
| P0 | R01 - Scaffolding | Foundation for everything else |
| P0 | R02 - Ingest | No wiki without data |
| P0 | R03 - Compile | Core value proposition |
| P1 | R04 - Q&A | Primary user interaction |
| P1 | R09 - Obsidian compat | Viewing layer |
| P1 | R10 - Config | Needed before first LLM call |
| P2 | R06 - Lint | Quality improvement loop |
| P2 | R07 - Search | Enables deeper research |
| P2 | R05 - Output formats | Enhanced output |
| P3 | R08 - Web UI | Nice-to-have frontend |
| P3 | R11 - Extensibility | Post-MVP |
| P3 | R12 - Knowledge growth | Post-MVP refinement |

---

## 5. Non-Functional Requirements

- **Performance**: Incremental compilation must handle wikis up to ~1000 articles without re-processing unchanged content.
- **Cost awareness**: Minimize token usage by leveraging indexes and summaries rather than sending full articles to the LLM every time.
- **Offline-first**: The wiki is local Markdown files. No cloud dependency for viewing/searching. Cloud needed only for LLM calls.
- **Privacy**: Raw data and wiki stay local. No telemetry. API keys stored securely.
- **Portability**: The `wiki/` folder is a plain directory of `.md` files — works with Obsidian, VS Code, any Markdown tool, or just `cat`.
