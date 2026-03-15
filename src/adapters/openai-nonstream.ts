import type { ChatCompletionResponse } from '../contracts/openai-chat.js';

export function newChatId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 14)}`;
}

export function mapNonStreamResult(input: {
  text: string;
  model: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}): ChatCompletionResponse {
  return {
    id: newChatId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: input.text,
          refusal: null,
          tool_calls: null,
        },
        finish_reason: input.finishReason ?? 'stop',
        logprobs: null,
      },
    ],
  };
}
