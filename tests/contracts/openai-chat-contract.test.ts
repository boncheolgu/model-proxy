import { parseChatRequest } from '../../src/contracts/openai-chat.js';

describe('openai chat contract', () => {
  it('accepts required model/messages only', () => {
    const parsed = parseChatRequest({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(parsed.model).toBe('gpt-4o-mini');
  });
});
