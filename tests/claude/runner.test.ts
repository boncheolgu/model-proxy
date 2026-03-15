import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDb } from '../../src/store/db.js';
import { SessionRepo } from '../../src/store/session-repo.js';
import { ClaudeRunner } from '../../src/claude/runner.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  kill() {
    this.emit('close', 1);
    return true;
  }
}

function spawnOk(_cmd: string, _args: string[]) {
  const child = new FakeChild();
  process.nextTick(() => {
    child.stdout.write('{"type":"system","session_id":"sid-1"}\n');
    child.stdout.write('{"type":"assistant","text":"hello"}\n');
    child.emit('close', 0);
  });
  return child as any;
}

describe('claude runner', () => {
  it('persists session on success', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-runner-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    const runner = new ClaudeRunner(repo, spawnOk as any);
    const result = await runner.run({
      tenantId: 't1',
      conversationKey: 'c1',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
    });
    expect(result.exitCode).toBe(0);
    expect(repo.get('t1', 'c1')?.claudeSessionId).toBe('sid-1');
    db.close();
  });

  it('rejects concurrent requests for same conversation key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-runner-lock-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    const child = new FakeChild();
    const holdSpawn = () => child as any;
    const runner = new ClaudeRunner(repo, holdSpawn as any);

    const p1 = runner.run({
      tenantId: 't1',
      conversationKey: 'c1',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
    });
    await expect(
      runner.run({
        tenantId: 't1',
        conversationKey: 'c1',
        model: 'claude-sonnet-4-6',
        prompt: 'hello',
      }),
    ).rejects.toThrow(/busy/i);
    child.emit('close', 1);
    await p1;
    db.close();
  });
});
