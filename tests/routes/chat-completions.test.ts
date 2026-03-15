import request from 'supertest';
import { createApp } from '../../src/app.js';

function payload(stream: boolean) {
  return {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    stream,
  };
}

describe('chat completions route', () => {
  it('supports stream=false and stream=true', async () => {
    const app = createApp({
      runner: {
        run: async ({ onDelta, onToolCall }: any) => {
          onToolCall?.({ index: 0, id: 'call_1', name: 'search_web', isStart: true });
          onToolCall?.({ index: 0, argumentsDelta: '{"q":"hi"}', isStart: false });
          onDelta?.('hello');
          return { text: 'hello', stderr: '', sessionId: 's-1', exitCode: 0 };
        },
      },
    });

    const a = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send(payload(false));
    expect(a.status).toBe(200);
    expect(a.body.object).toBe('chat.completion');

    const b = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send(payload(true));
    expect(b.status).toBe(200);
    expect(b.text.includes('data: [DONE]')).toBe(true);
    expect(b.text.includes('tool_calls')).toBe(true);
  });

  it('closes SSE safely when stream handler throws', async () => {
    const app = createApp({
      runner: {
        run: async ({ onDelta }: any) => {
          onDelta?.('partial');
          throw new Error('boom');
        },
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send(payload(true));

    expect(res.status).toBe(200);
    expect(res.text.includes('data: [DONE]')).toBe(true);

    const dataLines = res.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data: '));
    for (const line of dataLines) {
      const payload = line.slice('data: '.length);
      if (payload === '[DONE]') continue;
      const parsed = JSON.parse(payload);
      expect(parsed.object).toBe('chat.completion.chunk');
    }
  });

  it('emits usage chunk when stream_options.include_usage is true', async () => {
    const app = createApp({
      runner: {
        run: async ({ onDelta }: any) => {
          onDelta?.('hello world');
          return { text: 'hello world', stderr: '', sessionId: 's-2', exitCode: 0 };
        },
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send({ ...payload(true), stream_options: { include_usage: true } });

    expect(res.status).toBe(200);
    const dataLines = res.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data: '));
    const jsonPayloads = dataLines
      .map((line) => line.slice('data: '.length))
      .filter((p) => p !== '[DONE]')
      .map((p) => JSON.parse(p));

    const usageChunk = jsonPayloads.find((p) => Array.isArray(p.choices) && p.choices.length === 0 && p.usage);
    expect(usageChunk).toBeTruthy();
    expect(usageChunk.usage.total_tokens).toBeGreaterThan(0);
  });
});
