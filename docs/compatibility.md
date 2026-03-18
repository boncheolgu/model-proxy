# OpenAI Compatibility

## Supported in v1

- Endpoint: `POST /v1/chat/completions`
- Request fields: `model`, `messages`, `stream`
- Non-stream response object: `chat.completion`
- Stream response object: `chat.completion.chunk`
- SSE terminator: `data: [DONE]`
- Streaming `tool_calls` delta (initial support): tool call start + argument chunk passthrough

## Partially supported

- `temperature`, `top_p`, `stop`, `max_tokens` accepted but not fully mapped to Claude behavior

## Not fully supported in v1

- Full tool/function call parity across every Claude event variant
- `n > 1` multiple choices
- Logprobs and full token usage parity

## Session Modes

- `sticky` mode (default): uses stored Claude `session_id` via `--resume`
- `replay` mode (planned): reconstructs prompt from request messages without resume

## Multi-Backend Routing

- Claude models (`claude-*`, `anthropic/claude-*`) run via local Claude CLI.
- Non-Claude models are forwarded to `MODEL_PROXY_UPSTREAM_BASE_URL` as OpenAI-compatible `/chat/completions` requests.

## MCP Notes

- model-proxy forwards Claude CLI MCP configuration via runtime env vars:
  - `CLAUDE_PROXY_WORKDIR`
  - `CLAUDE_PROXY_MCP_CONFIG`
  - `CLAUDE_PROXY_STRICT_MCP_CONFIG`
- Relative `CLAUDE_PROXY_MCP_CONFIG` paths are resolved from `CLAUDE_PROXY_WORKDIR`.
- If MCP tools are missing in client integrations, verify proxy runtime directory/config path first.
- For Claude-model requests with OpenAI `tools`, model-proxy injects a tool summary into the initial session system prompt.
