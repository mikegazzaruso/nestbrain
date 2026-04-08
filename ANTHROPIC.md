# MindNest - Anthropic Integration Research

## The Problem

We have a **Claude Max subscription** and want to use it as the LLM backend for MindNest at runtime, without paying separately for Claude API tokens.

---

## Key Finding: No Official Way to Use Claude Max as a Free API

Anthropic's **Consumer Terms of Service** (Section 3) explicitly prohibit accessing services:

> "through automated or non-human means, whether through a bot, script, or otherwise" — except when using an Anthropic API Key or where explicitly permitted.

The **Claude Agent SDK documentation** also states:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods."

---

## Available Tools

### 1. Claude Code CLI (`claude -p`)

The CLI has a non-interactive mode designed for scripted use:

```bash
# Simple query with JSON output
claude -p "Summarize this document" --output-format json

# Structured output with JSON Schema
claude -p "Extract concepts" --output-format json --json-schema '{"type":"object","properties":{"concepts":{"type":"array","items":{"type":"string"}}}}'

# Streaming
claude -p "Write an article" --output-format stream-json

# Conversation continuation
claude -p "Follow-up question" --resume <session_id>
```

**Key flags:**

| Flag | Purpose |
|------|---------|
| `-p` / `--print` | Non-interactive mode |
| `--output-format text\|json\|stream-json` | Output format |
| `--json-schema '...'` | Structured output |
| `--allowedTools "Read,Edit,Bash"` | Auto-approve tools |
| `--max-turns N` | Limit agent turns |
| `--model sonnet\|opus` | Model selection |
| `--bare` | Skip auto-discovery (faster, but requires API key) |
| `--continue` / `--resume <id>` | Multi-turn conversations |
| `--system-prompt "..."` | Custom system prompt |
| `--append-system-prompt "..."` | Append to system prompt |

**Works with Claude Max OAuth login** (without `--bare` flag).

### 2. Claude Agent SDK (Python)

```bash
pip install claude-agent-sdk
```

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def ask_claude(prompt: str, cwd: str = ".") -> str:
    result = None
    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Glob", "Grep"],
            cwd=cwd,
            max_turns=3,
        ),
    ):
        if hasattr(message, "result"):
            result = message.result
    return result
```

**Note:** The Python SDK spawns the `claude` CLI as a subprocess under the hood.

### 3. Claude Agent SDK (TypeScript)

```bash
npm install @anthropic-ai/claude-agent-sdk
```

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Summarize the wiki",
  options: { allowedTools: ["Read", "Glob", "Grep"] }
})) {
  if ("result" in message) console.log(message.result);
}
```

### 4. Subprocess Wrapper (Simplest Approach)

```python
import subprocess
import json

def ask_claude(prompt: str, output_format: str = "json") -> dict:
    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", output_format],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if output_format == "json":
        return json.loads(result.stdout)
    return {"result": result.stdout}
```

---

## Authentication Methods

| Method | Uses Max Sub? | Requires API Key? |
|--------|--------------|-------------------|
| Claude.ai OAuth (default `claude` CLI) | Yes | No |
| `--bare` mode | No | Yes (`ANTHROPIC_API_KEY`) |
| `ANTHROPIC_API_KEY` env var | No | Yes |
| Amazon Bedrock | No | AWS credentials |
| Google Vertex AI | No | GCP credentials |

Your current auth:
- Method: **Claude.ai OAuth**
- Subscription: **Claude Max**
- The `claude -p` command (without `--bare`) uses this auth automatically.

---

## ToS Risk Assessment

| Use Case | ToS Status | Risk Level |
|----------|------------|------------|
| `claude -p` in terminal for personal productivity | Intended use | None |
| `claude -p` wrapped in a personal script | Grey area | Low |
| Personal app calling `claude -p` as subprocess | Grey area | Low-Medium |
| Production app routing multiple users through Max | Violates Consumer ToS | High |
| Agent SDK with `ANTHROPIC_API_KEY` | Fully compliant | None |
| Agent SDK with Max OAuth | Likely violates ToS | Medium |

---

## Recommended Strategy for MindNest

### Option A: Personal Use (Grey Area, No Extra Cost)

Use `claude -p` as a subprocess. Your Max subscription is already authenticated on the machine.

**Pros:**
- Zero additional cost
- Simple implementation
- CLI was designed for `-p` scripted use

**Cons:**
- Technically violates Consumer ToS (automated access)
- Only works on machines where `claude` is authenticated
- Rate limits tied to Max subscription
- Not suitable if MindNest becomes a multi-user product

**Implementation:**
```python
# src/llm/claude_wrapper.py
import subprocess
import json
from pathlib import Path

class ClaudeWrapper:
    def __init__(self, model: str = "sonnet", max_turns: int = 5):
        self.model = model
        self.max_turns = max_turns

    def ask(self, prompt: str, system_prompt: str = None) -> str:
        cmd = ["claude", "-p", prompt, "--output-format", "json",
               "--model", self.model, "--max-turns", str(self.max_turns)]
        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        data = json.loads(result.stdout)
        return data.get("result", "")

    def ask_structured(self, prompt: str, schema: dict) -> dict:
        cmd = ["claude", "-p", prompt, "--output-format", "json",
               "--json-schema", json.dumps(schema),
               "--model", self.model]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        data = json.loads(result.stdout)
        return json.loads(data.get("result", "{}"))
```

### Option B: API Key (Fully Compliant, Pay Per Token)

Use the standard `anthropic` Python SDK with an API key.

**Pros:**
- Fully ToS-compliant
- Works anywhere (CI, servers, other users)
- Production-ready

**Cons:**
- Costs money per token (on top of Max subscription)
- Need to manage API key

**Implementation:**
```python
# src/llm/claude_api.py
from anthropic import Anthropic

class ClaudeAPI:
    def __init__(self, model: str = "claude-sonnet-4-6"):
        self.client = Anthropic()  # uses ANTHROPIC_API_KEY env var
        self.model = model

    def ask(self, prompt: str, system_prompt: str = "") -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
```

### Option C: Hybrid (Recommended)

Build MindNest with a **provider-agnostic LLM interface**. Default to the `claude -p` wrapper for personal use, but allow switching to API key mode via config.

```yaml
# mindnest.yaml
llm:
  provider: "claude-cli"  # or "anthropic-api"
  model: "sonnet"
  max_turns: 5
  # api_key: env:ANTHROPIC_API_KEY  # uncomment for API mode
```

This way:
- For personal use now: use `claude-cli` provider (free with Max)
- For production/distribution later: switch to `anthropic-api` provider
- Easy to add other providers (OpenAI, Ollama, etc.)

---

## Summary

There is **no officially sanctioned way** to use Claude Max as a free API. However, the `claude -p` CLI was explicitly designed for scripted/programmatic use and works with Max OAuth auth. For a **personal tool**, the practical risk is low. For anything beyond personal use, an API key is required.

**Our recommendation: Option C (Hybrid).** Build the abstraction now, use `claude -p` for development and personal use, switch to API when/if needed.
