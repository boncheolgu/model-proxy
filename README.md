# claude-openai-proxy

OpenAI-compatible proxy for `POST /v1/chat/completions` backed by local Claude CLI sessions.

## Features

- OpenAI-compatible non-stream and stream response modes
- Conversation-scoped session persistence in SQLite
- Claude `--resume` bridge per tenant + conversation key
- Replay-safe fallback when stored resume session is invalid

## Run

```bash
pnpm install
pnpm dev
```

Default server: `http://localhost:8787`

## Auth

- Header: `Authorization: Bearer <key>`
- Dev fallback key: `test`
- Optional key map env: `PROXY_API_KEYS="tenantA:keyA,tenantB:keyB"`

## API

- `POST /v1/chat/completions`
- Optional header: `x-conversation-key` to bind requests to same Claude session

## OpenCode Integration

Use this proxy as a custom OpenAI-compatible provider in OpenCode.

### 1) Start the proxy

```bash
PORT=8787 npx tsx src/index.ts
```

### 2) Add provider config

Create or update `opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "claude-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Claude Proxy Local",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1"
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6 (Proxy)"
        }
      }
    }
  }
}
```

### 3) Add API key for the provider

In `~/.local/share/opencode/auth.json`, add:

```json
{
  "claude-proxy": {
    "type": "api",
    "key": "test"
  }
}
```

If this file already has other providers, merge this object instead of replacing the file.

### 4) Verify in OpenCode

```bash
opencode models claude-proxy
opencode run -m claude-proxy/claude-sonnet-4-6 "Reply with exactly: OPENCODE_PROXY_OK"
```

Expected output includes: `OPENCODE_PROXY_OK`

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
```
