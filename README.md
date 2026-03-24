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

## How It Works

Claude CLI speaks its own protocol (NDJSON over stdio) rather than the OpenAI API format that most developer tools expect. Available usage and rate limits depend on your Claude account and plan. This proxy bridges the gap.

```
Client (OpenAI format)           model-proxy                    Claude CLI

POST /v1/chat/completions  -->  extract messages
                                spawn `claude` subprocess  -->  stdin (prompt)
                                                           <--  stdout (NDJSON events)
                                parse events, convert
                           <--  SSE chunks or JSON body
```

**On each request:**

1. The proxy receives a standard OpenAI chat completion request.
2. Messages are extracted from the request body and piped to the Claude CLI's stdin.
3. The CLI runs with `--output-format stream-json`, emitting NDJSON events on stdout -- text deltas, tool calls, and session metadata.
4. Each NDJSON line is parsed in real time and converted to either OpenAI SSE frames (`data: {...}\n\n`) for streaming or a single JSON response for non-streaming.

**Session continuity across requests:**

The CLI is stateless per invocation, but supports `--resume <session_id>` to continue a prior conversation. The proxy automates this:

- A `conversation_key` (from the `x-conversation-key` header, or auto-generated) is mapped to a `claude_session_id` in SQLite.
- On the next request with the same key, the CLI is spawned with `--resume`, preserving full conversation context.
- If the session has expired on Claude's side, the proxy detects the failure, discards the stale pointer, and transparently retries with a fresh session.

This means any tool that speaks the OpenAI API -- OpenCode, OpenClaw, custom scripts -- can use Claude CLI as its backend without knowing the CLI exists.

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

### Claude CLI authentication

`model-proxy` does not perform interactive Claude login for you. Make sure Claude CLI is already logged in in the environment where the proxy runs.

If Claude CLI is not authenticated, requests will fail with a login-related runner error.

## Runtime Configuration

- `CLAUDE_PROXY_WORKDIR`: working directory used when spawning `claude` (default: proxy process cwd).
- `CLAUDE_PROXY_MCP_CONFIG`: optional path passed as `claude --mcp-config <path>` (relative paths resolve from `CLAUDE_PROXY_WORKDIR`).
- `CLAUDE_PROXY_STRICT_MCP_CONFIG`: when truthy (`1|true|yes|on`) and MCP config is set, adds `--strict-mcp-config`.
- `MODEL_PROXY_UPSTREAM_BASE_URL`: optional OpenAI-compatible upstream base URL used for non-Claude models (example: `https://api.openai.com/v1`).
- `MODEL_PROXY_UPSTREAM_API_KEY`: optional API key for the upstream provider.

### Model Routing

- `claude-*` and `anthropic/claude-*` models run through local Claude CLI (session resume + local MCP support).
- Other model names run through `MODEL_PROXY_UPSTREAM_BASE_URL` when configured.
- If a non-Claude model is requested without upstream configuration, the proxy returns an error.

### Claude Path Tool Policy

- For Claude models (`claude-*`, `anthropic/claude-*`), OpenAI `tools`/`tool_choice` request fields are ignored by model-proxy.
- Use Claude CLI-native tools (MCP/CLI environment) on the Claude path by configuring `CLAUDE_PROXY_WORKDIR` and `CLAUDE_PROXY_MCP_CONFIG`.
- If you need OpenAI tool orchestration (`tools` + tool result loop), use a non-Claude model routed through `MODEL_PROXY_UPSTREAM_BASE_URL`.

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

To mix Claude and non-Claude models in OpenCode with one proxy, keep Claude models in provider config and add upstream model IDs (for example `gpt-4o-mini`). Then run model-proxy with upstream env vars:

```bash
MODEL_PROXY_UPSTREAM_BASE_URL="https://api.openai.com/v1" \
MODEL_PROXY_UPSTREAM_API_KEY="<your-key>" \
npx tsx src/index.ts
```

If MCP tools are not discovered through the proxy, start model-proxy with the same workspace and MCP config that Claude should use:

```bash
CLAUDE_PROXY_WORKDIR="/absolute/path/to/your/project" \
CLAUDE_PROXY_MCP_CONFIG="/absolute/path/to/your/mcp.json" \
npx tsx src/index.ts
```

`CLAUDE_PROXY_WORKDIR` is important because `claude` reads project-local settings from its working directory.

### OpenClaw

Configure the provider in `~/.openclaw/openclaw.json`:

```json5
{
  models: {
    providers: {
      "model-proxy": {
        baseUrl: "http://127.0.0.1:8787/v1",
        apiKey: "test",
        api: "openai-completions",
        models: [
          { id: "claude-opus-4-6",   name: "Claude Opus 4.6 (Proxy)",   contextWindow: 200000, maxTokens: 8192 },
          { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Proxy)", contextWindow: 200000, maxTokens: 8192 },
          { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5 (Proxy)",  contextWindow: 200000, maxTokens: 8192 }
        ]
      }
    }
  }
}
```

Register the models in the same `openclaw.json` so they appear in OpenClaw model selection flows:

```json5
{
  agents: {
    defaults: {
      models: {
        "model-proxy/claude-opus-4-6": {},
        "model-proxy/claude-sonnet-4-6": {},
        "model-proxy/claude-haiku-4-5": {},
      },
    },
  },
}
```

Verify:

```bash
openclaw models list --provider model-proxy
```

Then test an actual request with a `model-proxy/...` model.

Adding a new provider may require a gateway restart.

## Development

```bash
npm install
npm run dev          # tsx watch on :8787
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # tsc --noEmit
```
