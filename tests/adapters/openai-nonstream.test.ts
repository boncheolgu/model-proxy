import { mapNonStreamResult } from '../../src/adapters/openai-nonstream.js';

describe('non-stream adapter', () => {
  it('maps runner output to chat.completion envelope', () => {
    const r = mapNonStreamResult({ text: 'hello', model: 'claude-sonnet-4-6' });
    expect(r.object).toBe('chat.completion');
    expect(r.choices[0].message.content).toBe('hello');
  });
});
