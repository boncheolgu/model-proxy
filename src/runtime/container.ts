import path from 'node:path';
import { createDb } from '../store/db.js';
import { SessionRepo } from '../store/session-repo.js';
import { ClaudeRunner } from '../claude/runner.js';

const dbPath = process.env.CLAUDE_PROXY_DB_PATH || path.join(process.cwd(), '.data', 'proxy.db');
const db = createDb(dbPath);
const sessionRepo = new SessionRepo(db);
const runner = new ClaudeRunner(sessionRepo);

export function getContainer() {
  return {
    db,
    sessionRepo,
    runner,
  };
}
