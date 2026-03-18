import path from 'node:path';

export type ClaudeArgsInput = {
  model: string;
  effort?: string;
  sessionId?: string | null;
  permissions?: 'auto' | 'default';
  systemPrompt?: string;
  workdir?: string;
};

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  if ((input.permissions ?? 'auto') === 'auto' && !isRoot) args.push('--dangerously-skip-permissions');
  const mcpConfigPath = process.env.CLAUDE_PROXY_MCP_CONFIG?.trim();
  if (mcpConfigPath) {
    const mcpConfigResolved = path.isAbsolute(mcpConfigPath)
      ? mcpConfigPath
      : path.resolve(input.workdir ?? process.cwd(), mcpConfigPath);
    args.push('--mcp-config', mcpConfigResolved);
  }
  if (mcpConfigPath && envFlagEnabled(process.env.CLAUDE_PROXY_STRICT_MCP_CONFIG)) {
    args.push('--strict-mcp-config');
  }
  if (input.sessionId) args.push('--resume', input.sessionId);
  args.push('--max-turns', '50');
  if (input.model && input.model !== 'default') args.push('--model', input.model);
  if (input.effort && input.effort !== 'medium') args.push('--effort', input.effort);
  if (!input.sessionId && input.systemPrompt) args.push('--append-system-prompt', input.systemPrompt);
  return args;
}
