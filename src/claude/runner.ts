import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import { buildClaudeArgs } from './args.js';
import { parseClaudeEvent } from './events.js';
import { acquireConversationLock, releaseConversationLock } from '../runtime/locks.js';
import { shouldRetryWithoutResume, timeoutMs } from '../runtime/policy.js';
import { SessionRepo } from '../store/session-repo.js';
import type { ModelRunner, RunnerInput, RunnerResult } from '../runners/types.js';
import { canonicalClaudeModel } from '../runners/model-utils.js';

type SpawnFn = typeof spawnProcess;

export class ClaudeRunner implements ModelRunner {
  constructor(
    private readonly repo: SessionRepo,
    private readonly spawnFn: SpawnFn = spawnProcess,
  ) {}

  async run(input: RunnerInput): Promise<RunnerResult> {
    const model = canonicalClaudeModel(input.model);
    const lockKey = `${input.tenantId}:${input.conversationKey}`;
    if (!acquireConversationLock(lockKey)) {
      throw new Error('conversation is busy');
    }

    try {
      const existing = this.repo.get(input.tenantId, input.conversationKey);
      const resumeId = existing && existing.model === model ? existing.claudeSessionId : null;
      const firstAttempt = await this.runOnce({ ...input, model }, resumeId);
      if (firstAttempt.exitCode === 0) return firstAttempt;

      const canRetry = Boolean(resumeId) && shouldRetryWithoutResume(firstAttempt.stderr).retryAsNewSession;
      if (canRetry) {
        this.repo.invalidate(input.tenantId, input.conversationKey);
        return this.runOnce({ ...input, model }, null);
      }

      return firstAttempt;
    } finally {
      releaseConversationLock(lockKey);
    }
  }

  private runOnce(input: RunnerInput, sessionId: string | null): Promise<RunnerResult> {
    return new Promise((resolve, reject) => {
      const configuredWorkdir = process.env.CLAUDE_PROXY_WORKDIR || process.cwd();
      const workdir = fs.existsSync(configuredWorkdir) && fs.statSync(configuredWorkdir).isDirectory()
        ? configuredWorkdir
        : process.cwd();
      if (configuredWorkdir !== workdir) {
        console.warn(`Invalid CLAUDE_PROXY_WORKDIR: ${configuredWorkdir}. Falling back to ${workdir}`);
      }
      const args = buildClaudeArgs({
        model: input.model,
        effort: input.effort,
        sessionId,
        permissions: input.permissions,
        systemPrompt: input.systemPrompt,
        workdir,
      });

      const child = this.spawnFn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        cwd: workdir,
      });

      let fullText = '';
      let latestSessionId: string | null = sessionId;
      let stderrText = '';
      let buffer = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs());

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      const handleNdjson = (text: string) => {
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const parsed = parseClaudeEvent(event);
            if (parsed.sessionId) latestSessionId = parsed.sessionId;
            if (parsed.toolCall) {
              input.onToolCall?.(parsed.toolCall);
            }
            if (parsed.textDelta) {
              fullText += parsed.textDelta;
              input.onDelta?.(parsed.textDelta);
            }
          } catch {
            continue;
          }
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        handleNdjson(lines.join('\n'));
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (buffer.trim()) {
          handleNdjson(buffer);
        }
        const exitCode = code ?? 1;
        if (exitCode === 0 && latestSessionId) {
          this.repo.upsert({
            tenantId: input.tenantId,
            conversationKey: input.conversationKey,
            claudeSessionId: latestSessionId,
            model: input.model,
          });
        }
        resolve({ text: fullText || stderrText, stderr: stderrText, sessionId: latestSessionId, exitCode });
      });

      child.stdin.write(input.prompt);
      child.stdin.end();
    });
  }
}
