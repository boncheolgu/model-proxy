import { OpenAICompatibleRunner } from '../../src/openai/runner.js';
import type { RunnerInput } from '../../src/runners/types.js';

function makeInput(stream: boolean): RunnerInput {
  return {
    tenantId: 't1',
    conversationKey: 'c1',
    model: 'gpt-4o-mini',
    prompt: 'hi',
    request: {
      model: 'gpt-4o-mini',
      stream,
      messages: [{ role: 'user', content: 'hi' }],
    },
  };
}

describe('openai compatible runner', () => {
  it('rejects non-https upstream URLs except localhost', () => {
    expect(() => new OpenAICompatibleRunner({ baseUrl: 'http://example.com/v1' })).toThrow(/must be https/i);
    expect(() => new OpenAICompatibleRunner({ baseUrl: 'http://localhost:4000/v1' })).not.toThrow();
  });

  it('maps non-stream completion content', async () => {
    const fetchFn: typeof fetch = async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'hello from upstream' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    const runner = new OpenAICompatibleRunner({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      fetchFn,
    });

    const result = await runner.run(makeInput(false));
    expect(result.exitCode).toBe(0);
    expect(result.text).toBe('hello from upstream');
  });

  it('parses stream deltas and tool call chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":',
      '\\"hi\\"}"}}]}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const fetchFn: typeof fetch = async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const toolCalls: Array<{ name?: string; args?: string; isStart?: boolean }> = [];
    const deltas: string[] = [];
    const runner = new OpenAICompatibleRunner({
      baseUrl: 'https://example.test/v1',
      fetchFn,
    });

    const input = makeInput(true);
    input.onDelta = (txt) => deltas.push(txt);
    input.onToolCall = (delta) => {
      toolCalls.push({ name: delta.name, args: delta.argumentsDelta, isStart: delta.isStart });
    };

    const result = await runner.run(input);
    expect(result.exitCode).toBe(0);
    expect(result.text).toBe('hello');
    expect(deltas).toEqual(['hello']);
    expect(toolCalls[0]?.name).toBe('search');
    expect(toolCalls[0]?.isStart).toBe(true);
    expect(toolCalls[1]?.args).toContain('hi');
  });
});
