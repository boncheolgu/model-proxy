import request from 'supertest';
import { createApp } from '../src/app.js';

describe('smoke', () => {
  it('returns 404 for unknown route', async () => {
    const app = createApp({
      runner: {
        run: async () => ({ text: 'ok', stderr: '', sessionId: 's1', exitCode: 0 }),
      },
    });
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
