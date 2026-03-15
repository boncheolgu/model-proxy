import request from 'supertest';
import { createApp } from '../../src/app.js';

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
});
