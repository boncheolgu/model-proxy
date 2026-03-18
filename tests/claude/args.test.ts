import { buildClaudeArgs } from '../../src/claude/args.js';

describe('claude args', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it('adds mcp config args from environment', () => {
    vi.stubEnv('CLAUDE_PROXY_MCP_CONFIG', '/tmp/mcp.json');
    vi.stubEnv('CLAUDE_PROXY_STRICT_MCP_CONFIG', 'true');
    const args = buildClaudeArgs({ model: 'claude-sonnet-4-6' });
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/mcp.json');
    expect(args).toContain('--strict-mcp-config');
  });

  it('resolves relative mcp config path against workdir', () => {
    vi.stubEnv('CLAUDE_PROXY_MCP_CONFIG', '.mcp.json');
    const args = buildClaudeArgs({ model: 'claude-sonnet-4-6', workdir: '/tmp/workspace-a' });
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/tmp/workspace-a/.mcp.json');
  });

  it('does not add strict mcp flag without mcp config', () => {
    vi.stubEnv('CLAUDE_PROXY_STRICT_MCP_CONFIG', 'true');
    const args = buildClaudeArgs({ model: 'claude-sonnet-4-6' });
    expect(args).not.toContain('--strict-mcp-config');
  });
});
