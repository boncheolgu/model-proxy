import type { Response } from 'express';
import { beginSse, createStreamState, endStream, writeDelta, writeToolCallDelta } from '../../src/adapters/openai-stream.js';

class FakeResponse {
  headers: Record<string, string> = {};
  frames: string[] = [];
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  write(chunk: string) {
    this.frames.push(chunk.trimEnd());
    return true;
  }
  end() {
    return this;
  }
}

function parseJsonFrames(frames: string[]) {
  return frames
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}

describe('stream adapter', () => {
  it('emits SSE chunks and terminal [DONE]', () => {
    const res = new FakeResponse();
    beginSse(res as unknown as Response);
    const state = createStreamState('claude-sonnet-4-6');
    writeDelta(res as unknown as Response, state, 'hello');
    endStream(res as unknown as Response, state);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.frames.at(-1)).toBe('data: [DONE]');
  });

  it('emits tool call delta chunks', () => {
    const res = new FakeResponse();
    beginSse(res as unknown as Response);
    const state = createStreamState('claude-sonnet-4-6');
    writeToolCallDelta(res as unknown as Response, state, { index: 7, id: 'call_1', name: 'search_web', isStart: true });
    writeToolCallDelta(res as unknown as Response, state, { index: 7, argumentsDelta: '{"q":"x"}', isStart: false });
    endStream(res as unknown as Response, state);
    const joined = res.frames.join('\n');
    expect(joined.includes('tool_calls')).toBe(true);
    expect(joined.includes('call_1')).toBe(true);
    expect(joined.includes('"role":"assistant"')).toBe(true);
    expect(joined.includes('"index":0')).toBe(true);
  });

  it('uses stop finish_reason when both tool_calls and text are streamed', () => {
    const res = new FakeResponse();
    beginSse(res as unknown as Response);
    const state = createStreamState('claude-sonnet-4-6');
    writeToolCallDelta(res as unknown as Response, state, { index: 1, id: 'call_1', name: 'search_web', isStart: true });
    writeDelta(res as unknown as Response, state, 'final answer');
    endStream(res as unknown as Response, state);

    const frames = parseJsonFrames(res.frames);
    const final = frames.at(-1);
    expect(final.choices[0].finish_reason).toBe('stop');
  });

  it('emits usage chunk before DONE when include_usage is requested', () => {
    const res = new FakeResponse();
    beginSse(res as unknown as Response);
    const state = createStreamState('claude-sonnet-4-6');
    writeDelta(res as unknown as Response, state, 'hello');
    endStream(res as unknown as Response, state, {
      includeUsage: true,
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });

    const frames = parseJsonFrames(res.frames);
    const usageFrame = frames.at(-1);
    expect(usageFrame.choices).toEqual([]);
    expect(usageFrame.usage.total_tokens).toBe(7);
    expect(res.frames.at(-1)).toBe('data: [DONE]');
  });
});
