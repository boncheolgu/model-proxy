# model-proxy

OpenAI-compatible HTTP proxy that wraps local Claude CLI sessions with conversation persistence.

## Architecture

```
POST /v1/chat/completions
  → middleware/auth.ts        (Bearer token → tenant, conversation key)
  → routes/chat-completions.ts (validate request via Zod schema)
  → claude/runner.ts          (session lookup → spawn CLI → parse events → persist)
  → adapters/openai-stream.ts (SSE frames) or adapters/openai-nonstream.ts (JSON)
  → store/session-repo.ts     (SQLite upsert on success)
```

## Key Modules

| Module | Responsibility |
|---|---|
| `src/routes/chat-completions.ts` | Single endpoint: validates, runs, responds |
| `src/claude/runner.ts` | Session resume decision, subprocess lifecycle, retry-on-stale |
| `src/claude/events.ts` | NDJSON parser; extracts `session_id` from Claude output |
| `src/claude/args.ts` | Builds `claude` CLI args (`--resume`, `--model`, `--output-format`) |
| `src/adapters/openai-stream.ts` | SSE `data:` frames + `[DONE]` sentinel |
| `src/adapters/openai-nonstream.ts` | Full JSON response mapping |
| `src/contracts/openai-chat.ts` | Zod schemas; types derived from schemas |
| `src/store/session-repo.ts` | `get` / `upsert` / `invalidate` on `conversation_sessions` |
| `src/store/db.ts` | SQLite schema init (`better-sqlite3`) |
| `src/middleware/auth.ts` | Bearer parsing, conversation key generation |
| `src/runtime/container.ts` | Singleton DI (db, repo, runner) |
| `src/runtime/locks.ts` | In-memory conversation lock (one request per key) |
| `src/runtime/policy.ts` | Retry decision + timeout config |

## Session Lifecycle

1. **Key resolution**: `x-conversation-key` header or SHA256(random + ip + model + ts).
2. **DB lookup**: `(tenant_id, conversation_key)` → stored `claude_session_id`.
3. **Resume gate**: resume only if stored model === request model.
4. **Spawn**: `claude --resume <id>` (or fresh if no session).
5. **Parse**: NDJSON stream → extract `session_id` from `system`/`result` events.
6. **Persist**: on exit code 0, upsert session row.
7. **Retry**: if resume fails with "session not found", invalidate row and retry fresh.

## Development

```bash
npm install
npm run dev          # tsx watch on :8787
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # tsc or biome
```

## Testing Conventions

- **Framework**: Vitest with globals, node environment.
- **HTTP tests**: `supertest` against `createApp()`.
- **Mocking**: `vi.spyOn` for console/process; `FakeResponse` class for stream tests.
- **Fixtures**: `tests/fixtures/claude-ndjson/*.jsonl` for streaming event data.
- **Structure**: Mirrors `src/` — `tests/adapters/`, `tests/routes/`, `tests/store/`, etc.

## Constraints

- `n != 1` in chat completion request returns `400 unsupported_parameter`.
- Stream errors before SSE headers → `502 runner_failed`; after headers sent → close stream.
- Never suppress types with `as any` or `@ts-ignore`.
- Schemas are source of truth; never hand-write types that Zod can infer.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any shell command containing `curl` or `wget` will be intercepted and blocked by the context-mode plugin. Do NOT retry.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` to fetch and index web pages
- `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any shell command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with shell.
Instead use:
- `context-mode_ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### Direct web fetching — BLOCKED
Do NOT use any direct URL fetching tool. Use the sandbox equivalent.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)
Shell is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `context-mode_ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `context-mode_ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### File reading (for analysis)
If you are reading a file to **edit** it → reading is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `context-mode_ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |
