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
  it('injects tool bridge system prompt for claude models', async () => {
    let captured: any = null;
    const app = createApp({
      runner: {
        run: async (input: any) => {
          captured = input;
          return { text: 'ok', stderr: '', sessionId: 's-tool', exitCode: 0 };
        },
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send({
        model: 'claude-sonnet-4-6',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_web',
              description: 'Search the web',
              parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(captured.systemPrompt).toContain('Tool Bridge Context');
    expect(captured.systemPrompt).toContain('search_web');
  });

  it('does not inject tool bridge for non-claude models', async () => {
    let captured: any = null;
    const app = createApp({
      runner: {
        run: async (input: any) => {
          captured = input;
          return { text: 'ok', stderr: '', sessionId: null, exitCode: 0 };
        },
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send({
        model: 'gpt-4o-mini',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            type: 'function',
            function: { name: 'search_web', parameters: { type: 'object' } },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(captured.systemPrompt).toBeUndefined();
  });

  it('emits structured request start/end logs for non-stream request', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });
    const app = createApp({
      runner: {
        run: async () => ({ text: 'ok', stderr: '', sessionId: 'sess-1', exitCode: 0 }),
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .set('x-conversation-key', 'conv-1')
      .send(payload(false));

    expect(res.status).toBe(200);
    spy.mockRestore();

    const parsed = logs.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<Record<string, unknown>>;

    const startLog = parsed.find((l) => l.event === 'request.start');
    const endLog = parsed.find((l) => l.event === 'request.end');
    expect(startLog).toBeTruthy();
    expect(endLog).toBeTruthy();
    expect(startLog?.model).toBe('claude-sonnet-4-6');
    expect(startLog?.conversationKey).toBe('conv-1');
    expect(endLog?.exitCode).toBe(0);
    expect(endLog?.sessionId).toBe('sess-1');
  });

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

  it('returns 502 for stream request when runner exits non-zero without chunks', async () => {
    const app = createApp({
      runner: {
        run: async () => ({ text: 'runner failed', stderr: 'boom', sessionId: null, exitCode: 1 }),
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send(payload(true));

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('runner_failed');
  });

  it('rejects n greater than 1', async () => {
    const app = createApp({
      runner: {
        run: async () => ({ text: 'ok', stderr: '', sessionId: 's-1', exitCode: 0 }),
      },
    });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send({ ...payload(false), n: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_parameter');
  });
});
