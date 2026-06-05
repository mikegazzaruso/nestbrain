---
name: nestbrain-ask
description: Query the user's NestBrain knowledge base from inside Claude Code, using natural language. Use whenever the user says variants of "cerca sulla mia knowledge …" / "search my knowledge …" / "what do I have in my knowledge about …" — with an optional project scope ("progetto X" / "project X"). Returns retrieved articles synthesized into a grounded answer with `[[wikilink]]` citations.
---

# nestbrain-ask

Run a NestBrain knowledge search and answer from the cited articles. **Be terse.** No narration, no "let me try …", no fallbacks beyond what's written here.

## Steps — execute in order, do not improvise

### 1. Resolve CLI invocation (one shot, do not announce)

Try in this order, use the first that resolves:

1. `command -v nestbrain` succeeds → use `nestbrain`.
2. The installed NestBrain.app ships the CLI. Test these paths (first that exists wins) and use it directly via `node`:
   - macOS: `/Applications/NestBrain.app/Contents/Resources/web/apps/web/nestbrain.bundle.cjs`
   - Windows: `%LOCALAPPDATA%\Programs\NestBrain\resources\web\apps\web\nestbrain.bundle.cjs`
   When found, the invocation is `node "<that path>"`.
3. Dev source: `<nestbrain_root>/Projects/nestbrain/packages/cli/src/index.ts` exists → `npx tsx "<that path>"`.
4. None of the above → reply *"NestBrain CLI not found."* and stop.

Don't say what you tried. Just use what works.

### 2. Parse user input

- **Question**: the part after "cerca sulla mia knowledge" / "search my knowledge" / "what do I have in my knowledge about" (and after the optional project clause).
- **Project**: the value following "progetto X" / "project X" / "per il progetto X" / "from project X", if present.

### 3. Run ONE search

```bash
<CLI> search [-p <project>] "<question>" -l 5
```

Run from the NestBrain root (`cd <nestbrain_root>`) so the CLI auto-resolves the workspace paths.

**Do not** try alternate phrasings, translations, or broader queries. One search. Done.

### 4. Branch on the result

**Zero results** → reply (matching the user's language):

> Non ho trovato nulla nella knowledge.   _(IT)_
> Nothing in the knowledge for this.       _(EN)_

Then stop. Do not grep `Library/Knowledge/` directly. Do not read files. Do not speculate. Do not list what you tried.

**Any results** → read the top 2–3 results' files at `<nestbrain_root>/Library/Knowledge/<filePath>`, then synthesize a concise answer.

### 5. Answer (only when results were found)

- Match the user's language.
- Stick to what the read articles actually say. No invention.
- End with a `**Fonti:**` (IT) or `**Sources:**` (EN) line listing the citations as `[[<slug>]]` (the filename without `.md`).

## Hard rules

- **No nested Claude calls.** Never use `nestbrain ask` — only `nestbrain search`. The synthesis is your job.
- **No "thinking out loud".** No phrases like "provo con", "let me also try", "verify the index". One search, then either the answer or "non ho trovato nulla". A user reading the transcript should see the result, not the reasoning steps.
- **No direct grep / file walks** as a "fallback" when search returns nothing. If the CLI says nothing was found, that's the answer.
- **Scope is restrictive.** When the user named a project, `-p <name>` filters to that project only. When they didn't, omit the flag — search everything.
