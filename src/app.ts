import express from 'express';
import { createChatCompletionsRouter } from './routes/chat-completions.js';
import type { ModelRunner } from './runners/types.js';

type AppDeps = {
  runner: Pick<ModelRunner, 'run'>;
};

export function createApp(deps?: AppDeps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/v1/chat/completions', createChatCompletionsRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found', type: 'not_found', code: 'not_found' } });
  });

  return app;
}
