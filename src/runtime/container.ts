import path from 'node:path';
import { createDb } from '../store/db.js';
import { SessionRepo } from '../store/session-repo.js';
import { ClaudeRunner } from '../claude/runner.js';
import { OpenAICompatibleRunner } from '../openai/runner.js';
import { ModelRouterRunner } from '../runners/model-router.js';

const dbPath = process.env.CLAUDE_PROXY_DB_PATH || path.join(process.cwd(), '.data', 'proxy.db');
const db = createDb(dbPath);
const sessionRepo = new SessionRepo(db);
const claudeRunner = new ClaudeRunner(sessionRepo);
const upstreamBaseUrl = process.env.MODEL_PROXY_UPSTREAM_BASE_URL;
const upstreamRunner = upstreamBaseUrl
  ? new OpenAICompatibleRunner({
      baseUrl: upstreamBaseUrl,
      apiKey: process.env.MODEL_PROXY_UPSTREAM_API_KEY,
    })
  : undefined;
const runner = new ModelRouterRunner(claudeRunner, upstreamRunner);

export function getContainer() {
  return {
    db,
    sessionRepo,
    runner,
  };
}
