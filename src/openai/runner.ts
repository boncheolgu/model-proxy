import type { ModelRunner, RunnerInput, RunnerResult, ToolCallDelta } from '../runners/types.js';
import { timeoutMs } from '../runtime/policy.js';

type FetchFn = typeof fetch;

type OpenAICompatibleRunnerOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchFn?: FetchFn;
};

export class OpenAICompatibleRunner implements ModelRunner {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchFn: FetchFn;

  constructor(options: OpenAICompatibleRunnerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    const parsed = new URL(this.baseUrl);
    const isLocalHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      throw new Error('MODEL_PROXY_UPSTREAM_BASE_URL must be https:// (or local http://localhost)');
    }
  }

  async run(input: RunnerInput): Promise<RunnerResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input.request),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : 'upstream request failed';
      return { text: message, stderr: message, sessionId: null, exitCode: 1 };
    }

    if (!response.ok) {
      const errText = await response.text();
      clearTimeout(timer);
      return { text: errText || `upstream failed: ${response.status}`, stderr: errText, sessionId: null, exitCode: 1 };
    }

    if (!input.request.stream) {
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string | Array<unknown> } }>;
      };
      clearTimeout(timer);
      const raw = payload.choices?.[0]?.message?.content;
      const text = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : '';
      return { text, stderr: '', sessionId: null, exitCode: 0 };
    }

    const body = response.body;
    if (!body) {
      clearTimeout(timer);
      return { text: 'upstream streaming body missing', stderr: 'upstream streaming body missing', sessionId: null, exitCode: 1 };
    }

    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    let fullText = '';

    const parseJsonPayload = (payload: string) => {
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              function_call?: { name?: string; arguments?: string };
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          fullText += delta.content;
          input.onDelta?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const mapped: ToolCallDelta = {
              index: Number(toolCall.index ?? 0),
              id: toolCall.id,
              name: toolCall.function?.name,
              argumentsDelta: toolCall.function?.arguments,
              isStart: Boolean(toolCall.id || toolCall.function?.name),
            };
            input.onToolCall?.(mapped);
          }
        }
        if (delta?.function_call) {
          input.onToolCall?.({
            index: 0,
            name: delta.function_call.name,
            argumentsDelta: delta.function_call.arguments,
            isStart: Boolean(delta.function_call.name),
          });
        }
      } catch {
        return;
      }
    };

    const parseSseBlock = (block: string): boolean => {
      const lines = block.split(/\r?\n/);
      const dataLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        dataLines.push(trimmed.slice('data:'.length).trim());
      }
      if (dataLines.length === 0) return false;
      const payload = dataLines.join('\n');
      if (!payload || payload === '[DONE]') return true;
      parseJsonPayload(payload);
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const match = buffer.match(/\r?\n\r?\n/);
        if (!match || match.index == null) break;
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const doneFrame = parseSseBlock(block);
        if (doneFrame) {
          clearTimeout(timer);
          return { text: fullText, stderr: '', sessionId: null, exitCode: 0 };
        }
      }
    }

    if (buffer.trim()) {
      parseSseBlock(buffer);
    }

    clearTimeout(timer);
    return { text: fullText, stderr: '', sessionId: null, exitCode: 0 };
  }
}
