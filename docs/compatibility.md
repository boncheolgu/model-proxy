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
