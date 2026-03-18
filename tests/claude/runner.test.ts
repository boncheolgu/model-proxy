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

function makeRequest(model: string) {
  return {
    model,
    stream: false,
    messages: [{ role: 'user' as const, content: 'hello' }],
  };
}

describe('claude runner', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
      request: makeRequest('claude-sonnet-4-6'),
    });
    expect(result.exitCode).toBe(0);
    expect(repo.get('t1', 'c1')?.claudeSessionId).toBe('sid-1');
    db.close();
  });

  it('canonicalizes anthropic model aliases for stored session model', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-runner-alias-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    const runner = new ClaudeRunner(repo, spawnOk as any);
    const result = await runner.run({
      tenantId: 't1',
      conversationKey: 'c1',
      model: 'anthropic/claude-sonnet-4-6',
      prompt: 'hello',
      request: makeRequest('anthropic/claude-sonnet-4-6'),
    });

    expect(result.exitCode).toBe(0);
    expect(repo.get('t1', 'c1')?.model).toBe('claude-sonnet-4-6');
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
      request: makeRequest('claude-sonnet-4-6'),
    });
    await expect(
      runner.run({
        tenantId: 't1',
        conversationKey: 'c1',
        model: 'claude-sonnet-4-6',
        prompt: 'hello',
        request: makeRequest('claude-sonnet-4-6'),
      }),
    ).rejects.toThrow(/busy/i);
    child.emit('close', 1);
    await p1;
    db.close();
  });

  it('uses CLAUDE_PROXY_WORKDIR as claude process cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-runner-cwd-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-workspace-'));
    vi.stubEnv('CLAUDE_PROXY_WORKDIR', workspaceDir);

    const spawnCalls: Array<{ cwd?: string }> = [];
    const spawnWithCapture = (_cmd: string, _args: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cwd: options?.cwd });
      return spawnOk(_cmd, _args) as any;
    };

    const runner = new ClaudeRunner(repo, spawnWithCapture as any);
    const result = await runner.run({
      tenantId: 't1',
      conversationKey: 'c1',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
      request: makeRequest('claude-sonnet-4-6'),
    });

    expect(result.exitCode).toBe(0);
    expect(spawnCalls[0]?.cwd).toBe(workspaceDir);
    db.close();
  });

  it('falls back to process cwd when CLAUDE_PROXY_WORKDIR is invalid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-runner-cwd-fallback-'));
    const db = createDb(path.join(dir, 'db.sqlite'));
    const repo = new SessionRepo(db);
    vi.stubEnv('CLAUDE_PROXY_WORKDIR', '/tmp/does-not-exist-xyz');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawnCalls: Array<{ cwd?: string }> = [];
    const spawnWithCapture = (_cmd: string, _args: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cwd: options?.cwd });
      return spawnOk(_cmd, _args) as any;
    };

    const runner = new ClaudeRunner(repo, spawnWithCapture as any);
    const result = await runner.run({
      tenantId: 't1',
      conversationKey: 'c1',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
      request: makeRequest('claude-sonnet-4-6'),
    });

    expect(result.exitCode).toBe(0);
    expect(spawnCalls[0]?.cwd).toBe(process.cwd());
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    db.close();
  });
});
