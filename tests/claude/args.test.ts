import { buildClaudeArgs } from '../../src/claude/args.js';

describe('claude args', () => {
  it('includes --resume only when session id exists', () => {
    expect(buildClaudeArgs({ model: 'claude-sonnet-4-6', sessionId: 'abc' })).toContain('--resume');
    expect(buildClaudeArgs({ model: 'claude-sonnet-4-6', sessionId: null })).not.toContain('--resume');
  });

  it('does not add dangerous permissions flag on root', () => {
    const args = buildClaudeArgs({ model: 'claude-sonnet-4-6', sessionId: null, permissions: 'auto' });
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(args).not.toContain('--dangerously-skip-permissions');
    }
  });
});
