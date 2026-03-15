import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool', 'developer']),
  content: z.union([z.string(), z.array(z.any())]),
}).passthrough();

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(messageSchema).min(1),
    stream: z.boolean().optional().default(false),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    n: z.number().int().positive().optional(),
    stream_options: z
      .object({
        include_usage: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export type ChatCompletionResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string; refusal: null; tool_calls: null };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
    logprobs: null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ChatCompletionChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export function parseChatRequest(input: unknown): ChatCompletionRequest {
  return chatCompletionRequestSchema.parse(input);
}
