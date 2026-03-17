# model-proxy

OpenAI-compatible HTTP proxy that wraps local Claude CLI sessions with conversation persistence.

Allows Claude CLI (Max plan) to be used as a backend for tools like OpenCode and OpenClaw via a standard `/v1/chat/completions` endpoint.

## Features

- OpenAI-compatible streaming (SSE) and non-streaming (JSON) responses
- Conversation-scoped session persistence in SQLite
- Automatic `--resume` bridging per tenant + conversation key
- Stale session detection with transparent retry on fresh session
- Per-conversation locking (one inflight request per key)
- Multi-tenant auth via Bearer token

## Quick Start

```bash
npm install
npx tsx src/index.ts   # starts on http://localhost:8787
```

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Architecture

```
POST /v1/chat/completions
  -> middleware/auth.ts          Bearer token -> tenant, conversation key
  -> routes/chat-completions.ts  validate request (Zod schema)
  -> claude/runner.ts            session lookup -> spawn CLI -> parse events -> persist
  -> adapters/openai-stream.ts   SSE frames (stream: true)
     adapters/openai-nonstream.ts JSON body  (stream: false)
  -> store/session-repo.ts       SQLite upsert on success
```

### Key Modules

| Module | Responsibility |
|---|---|
| `routes/chat-completions.ts` | Single endpoint: validate, run, respond |
| `claude/runner.ts` | Session resume decision, subprocess lifecycle, retry-on-stale |
| `claude/events.ts` | NDJSON parser; extracts `session_id` from Claude output |
| `claude/args.ts` | Builds CLI args (`--resume`, `--model`, `--output-format`) |
| `adapters/openai-stream.ts` | SSE `data:` frames + `[DONE]` sentinel |
| `adapters/openai-nonstream.ts` | Full JSON response mapping |
| `contracts/openai-chat.ts` | Zod schemas; types derived from schemas |
| `store/session-repo.ts` | `get` / `upsert` / `invalidate` on `conversation_sessions` |
| `store/db.ts` | SQLite schema init (better-sqlite3) |
| `middleware/auth.ts` | Bearer parsing, conversation key generation |
| `runtime/container.ts` | Singleton DI (db, repo, runner) |
| `runtime/locks.ts` | In-memory per-conversation lock |
| `runtime/policy.ts` | Retry decision + timeout config |

### Session Lifecycle

1. **Key resolution** -- `x-conversation-key` header, or SHA256(random + ip + model + ts).
2. **DB lookup** -- `(tenant_id, conversation_key)` -> stored `claude_session_id`.
3. **Resume gate** -- resume only when stored model matches request model.
4. **Spawn** -- `claude --resume <id>` (or fresh if no stored session).
5. **Parse** -- NDJSON stream -> extract `session_id` from `system`/`result` events.
6. **Persist** -- on exit code 0, upsert session row.
7. **Retry** -- if resume fails ("session not found"), invalidate row and retry fresh.

## Auth

- Header: `Authorization: Bearer <key>`
- Dev fallback key: `test`
- Multi-tenant key map: `PROXY_API_KEYS="tenantA:keyA,tenantB:keyB"`

## API

`POST /v1/chat/completions`

| Header | Required | Description |
|---|---|---|
| `Authorization` | yes | `Bearer <key>` |
| `x-conversation-key` | no | Bind requests to the same Claude session |

### Constraints

- `n != 1` returns `400 unsupported_parameter`.
- Errors before SSE headers -> `502 runner_failed`; after headers sent -> stream closes.

## Integration

### OpenCode

Add provider config to `opencode.json` (project root or `~/.config/opencode/opencode.json`):

```json
{
  "provider": {
    "model-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Model Proxy Local",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1"
      },
      "models": {
        "claude-sonnet-4-6": { "name": "Claude Sonnet 4.6 (Proxy)" },
        "claude-opus-4-6":   { "name": "Claude Opus 4.6 (Proxy)" },
        "claude-haiku-4-5":  { "name": "Claude Haiku 4.5 (Proxy)" }
      }
    }
  }
}
```

Add API key in `~/.local/share/opencode/auth.json`:

```json
{
  "model-proxy": {
    "type": "api",
    "key": "test"
  }
}
```

If this file already has other providers, merge rather than replace.

Verify:

```bash
opencode models model-proxy
opencode run -m model-proxy/claude-sonnet-4-6 "Reply with exactly: OPENCODE_PROXY_OK"
```

### OpenClaw

Add the provider to `~/.openclaw/agents/main/agent/models.json`:

```json
{
  "providers": {
    "model-proxy": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "apiKey": "test",
      "api": "openai-completions",
      "models": [
        { "id": "claude-opus-4-6",   "name": "Claude Opus 4.6 (Proxy)",   "contextWindow": 200000, "maxTokens": 8192 },
        { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (Proxy)", "contextWindow": 200000, "maxTokens": 8192 },
        { "id": "claude-haiku-4-5",  "name": "Claude Haiku 4.5 (Proxy)",  "contextWindow": 200000, "maxTokens": 8192 }
      ]
    }
  }
}
```

Register models in `~/.openclaw/openclaw.json`:

```json5
{
  agents: {
    defaults: {
      models: {
        "model-proxy/claude-opus-4-6":   { alias: "Opus (Proxy)" },
        "model-proxy/claude-sonnet-4-6": { alias: "Sonnet (Proxy)" },
        "model-proxy/claude-haiku-4-5":  { alias: "Haiku (Proxy)" },
      },
    },
  },
}
```

To expose models in channel `/models` commands, add an auth profile:

```json5
{
  auth: {
    profiles: {
      "model-proxy:default": {
        provider: "model-proxy",
        mode: "api_key",
      },
    },
  },
}
```

Verify:

```bash
openclaw models list --provider model-proxy
```

Adding a new provider may require a gateway restart.

## Development

```bash
npm install
npm run dev          # tsx watch on :8787
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # tsc --noEmit
```
