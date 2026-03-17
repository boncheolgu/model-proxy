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
