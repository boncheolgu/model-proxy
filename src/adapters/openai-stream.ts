import type { Response } from 'express';
import type { ChatCompletionChunk } from '../contracts/openai-chat.js';
import { newChatId } from './openai-nonstream.js';

type StreamState = {
  id: string;
  model: string;
  created: number;
  sentRole: boolean;
  announcedToolCalls: Map<number, { id: string; name: string }>;
  toolIndexMap: Map<number, number>;
  hasTextOutput: boolean;
};

type EndStreamOptions = {
  includeUsage?: boolean;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export function beginSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function writeFrame(res: Response, payload: ChatCompletionChunk | '[DONE]') {
  if (payload === '[DONE]') {
    res.write('data: [DONE]\n\n');
    return;
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createStreamState(model: string): StreamState {
  return {
    id: newChatId(),
    model,
    created: Math.floor(Date.now() / 1000),
    sentRole: false,
    announcedToolCalls: new Map(),
    toolIndexMap: new Map(),
    hasTextOutput: false,
  };
}

function ensureRoleChunk(res: Response, state: StreamState) {
  if (state.sentRole) return;
  writeFrame(res, {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });
  state.sentRole = true;
}

function normalizeToolIndex(state: StreamState, sourceIndex: number): number {
  const existing = state.toolIndexMap.get(sourceIndex);
  if (existing != null) return existing;
  const mapped = state.toolIndexMap.size;
  state.toolIndexMap.set(sourceIndex, mapped);
  return mapped;
}

export function writeToolCallDelta(
  res: Response,
  state: StreamState,
  input: { index: number; id?: string; name?: string; argumentsDelta?: string; isStart?: boolean },
) {
  ensureRoleChunk(res, state);
  const normalizedIndex = normalizeToolIndex(state, input.index);
  const known = state.announcedToolCalls.get(normalizedIndex);
  const id = input.id ?? known?.id ?? `call_${input.index}`;
  const name = input.name ?? known?.name ?? 'tool';
  if (input.isStart) {
    state.announcedToolCalls.set(normalizedIndex, { id, name });
  }
  const isFirst = input.isStart || !known;
  if (isFirst && !state.announcedToolCalls.has(normalizedIndex)) {
    state.announcedToolCalls.set(normalizedIndex, { id, name });
  }

  writeFrame(res, {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: normalizedIndex,
              ...(isFirst ? { id, type: 'function' as const, function: { name, arguments: input.argumentsDelta ?? '' } } : { function: { arguments: input.argumentsDelta ?? '' } }),
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
}

export function writeDelta(res: Response, state: StreamState, text: string) {
  ensureRoleChunk(res, state);
  if (text) state.hasTextOutput = true;
  writeFrame(res, {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
}

export function endStream(res: Response, state: StreamState, options: EndStreamOptions = {}) {
  const finishReason = state.announcedToolCalls.size > 0 && !state.hasTextOutput ? 'tool_calls' : 'stop';
  writeFrame(res, {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  });
  if (options.includeUsage && options.usage) {
    writeFrame(res, {
      id: state.id,
      object: 'chat.completion.chunk',
      created: state.created,
      model: state.model,
      choices: [],
      usage: options.usage,
    });
  }
  writeFrame(res, '[DONE]');
  res.end();
}
