export type ClaudeArgsInput = {
  model: string;
  effort?: string;
  sessionId?: string | null;
  permissions?: 'auto' | 'default';
  systemPrompt?: string;
};

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  if ((input.permissions ?? 'auto') === 'auto' && !isRoot) args.push('--dangerously-skip-permissions');
  if (input.sessionId) args.push('--resume', input.sessionId);
  args.push('--max-turns', '50');
  if (input.model && input.model !== 'default') args.push('--model', input.model);
  if (input.effort && input.effort !== 'medium') args.push('--effort', input.effort);
  if (!input.sessionId && input.systemPrompt) args.push('--append-system-prompt', input.systemPrompt);
  return args;
}
