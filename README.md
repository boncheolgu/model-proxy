# model-proxy

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
    "model-proxy": {
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
  "model-proxy": {
    "type": "api",
    "key": "test"
  }
}
```

If this file already has other providers, merge this object instead of replacing the file.

### 4) Verify in OpenCode

```bash
opencode models model-proxy
opencode run -m model-proxy/claude-sonnet-4-6 "Reply with exactly: OPENCODE_PROXY_OK"
```

Expected output includes: `OPENCODE_PROXY_OK`

## OpenClaw Integration

Use this proxy as a custom OpenAI-compatible provider in OpenClaw.

### 1) Start the proxy

```bash
PORT=8787 npx tsx src/index.ts
```

### 2) Add provider to agent models.json

Edit `~/.openclaw/agents/main/agent/models.json` and add the `model-proxy` provider. This file takes precedence over `openclaw.json` for provider configuration.

```json
{
  "providers": {
    "model-proxy": {
      "baseUrl": "http://127.0.0.1:8787/v1",
      "apiKey": "test",
      "api": "openai-completions",
      "models": [
        {
          "id": "claude-opus-4-6",
          "name": "Claude Opus 4.6 (Proxy)",
          "contextWindow": 200000,
          "maxTokens": 8192
        },
        {
          "id": "claude-sonnet-4-6",
          "name": "Claude Sonnet 4.6 (Proxy)",
          "contextWindow": 200000,
          "maxTokens": 8192
        },
        {
          "id": "claude-haiku-4-5",
          "name": "Claude Haiku 4.5 (Proxy)",
          "contextWindow": 200000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

If this file already has other providers, merge the `model-proxy` entry into the existing `providers` object.

### 3) Register models in openclaw.json

Add the models to `agents.defaults.models` in `~/.openclaw/openclaw.json`. This section acts as the allowlist for available models.

```json5
{
  agents: {
    defaults: {
      models: {
        "model-proxy/claude-opus-4-6": { alias: "Opus (Proxy)" },
        "model-proxy/claude-sonnet-4-6": { alias: "Sonnet (Proxy)" },
        "model-proxy/claude-haiku-4-5": { alias: "Haiku (Proxy)" },
      },
    },
  },
}
```

To make the provider visible in channel `/models` commands (Telegram, Slack, etc.), also add an auth profile:

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

### 4) Verify in OpenClaw

```bash
openclaw models list --provider model-proxy
```

Models should appear in `/models` on connected channels. If a newly added model does not appear, restart the OpenClaw gateway.

> **Note:** OpenClaw config supports hot reload for model changes, but adding a new provider may require a gateway restart.

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
```
