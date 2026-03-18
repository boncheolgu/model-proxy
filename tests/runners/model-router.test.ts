import { ModelRouterRunner } from '../../src/runners/model-router.js';
import type { ModelRunner, RunnerInput } from '../../src/runners/types.js';

function makeInput(model: string): RunnerInput {
  return {
    tenantId: 't1',
    conversationKey: 'c1',
    model,
    prompt: 'hello',
    request: {
      model,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    },
  };
}

describe('model router runner', () => {
  it('routes claude models to claude runner', async () => {
    const claudeRunner: ModelRunner = {
      run: async () => ({ text: 'claude', stderr: '', sessionId: 's1', exitCode: 0 }),
    };
    const upstreamRunner: ModelRunner = {
      run: async () => ({ text: 'upstream', stderr: '', sessionId: null, exitCode: 0 }),
    };
    const runner = new ModelRouterRunner(claudeRunner, upstreamRunner);

    const result = await runner.run(makeInput('claude-sonnet-4-6'));
    expect(result.text).toBe('claude');
  });

  it('routes anthropic/claude-* aliases to claude runner', async () => {
    const claudeRunner: ModelRunner = {
      run: async () => ({ text: 'claude', stderr: '', sessionId: 's1', exitCode: 0 }),
    };
    const upstreamRunner: ModelRunner = {
      run: async () => ({ text: 'upstream', stderr: '', sessionId: null, exitCode: 0 }),
    };
    const runner = new ModelRouterRunner(claudeRunner, upstreamRunner);

    const result = await runner.run(makeInput('anthropic/claude-sonnet-4-6'));
    expect(result.text).toBe('claude');
  });

  it('routes non-claude models to upstream runner', async () => {
    const claudeRunner: ModelRunner = {
      run: async () => ({ text: 'claude', stderr: '', sessionId: 's1', exitCode: 0 }),
    };
    const upstreamRunner: ModelRunner = {
      run: async () => ({ text: 'upstream', stderr: '', sessionId: null, exitCode: 0 }),
    };
    const runner = new ModelRouterRunner(claudeRunner, upstreamRunner);

    const result = await runner.run(makeInput('gpt-4o-mini'));
    expect(result.text).toBe('upstream');
  });

  it('throws clear error for non-claude model without upstream config', async () => {
    const claudeRunner: ModelRunner = {
      run: async () => ({ text: 'claude', stderr: '', sessionId: 's1', exitCode: 0 }),
    };
    const runner = new ModelRouterRunner(claudeRunner);

    await expect(runner.run(makeInput('gpt-4o-mini'))).rejects.toThrow(/non-claude model is not configured/i);
  });
});
