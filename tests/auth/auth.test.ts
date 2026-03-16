import request from 'supertest';
import { createApp } from '../../src/app.js';
import { resolveConversationKey } from '../../src/middleware/auth.js';

describe('auth middleware', () => {
  it('rejects missing bearer token', async () => {
    const app = createApp({
      runner: { run: async () => ({ text: 'ok', stderr: '', sessionId: 's1', exitCode: 0 }) },
    });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(401);
  });

  it('accepts bearer test token', async () => {
    const app = createApp({
      runner: { run: async () => ({ text: 'ok', stderr: '', sessionId: 's1', exitCode: 0 }) },
    });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test')
      .send({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(200);
  });

  it('generates different fallback conversation keys when header is missing', () => {
    const req = {
      ip: '127.0.0.1',
      header: (_: string) => undefined,
    } as any;

    const a = resolveConversationKey(req, 'claude-sonnet-4-6');
    const b = resolveConversationKey(req, 'claude-sonnet-4-6');
    expect(a).not.toBe(b);
  });
});
