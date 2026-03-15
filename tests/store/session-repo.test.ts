import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDb } from '../../src/store/db.js';
import { SessionRepo } from '../../src/store/session-repo.js';

describe('session repo', () => {
  it('stores and loads session by tenant+conversation key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-store-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    repo.upsert({
      tenantId: 't1',
      conversationKey: 'c1',
      claudeSessionId: 'sid-1',
      model: 'claude-sonnet-4-6',
    });
    expect(repo.get('t1', 'c1')?.claudeSessionId).toBe('sid-1');
    db.close();
  });
});
