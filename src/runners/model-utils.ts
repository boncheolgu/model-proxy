export function isClaudeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('claude-') || normalized.startsWith('anthropic/claude-');
}

export function canonicalClaudeModel(model: string): string {
  const normalized = model.trim();
  if (normalized.toLowerCase().startsWith('anthropic/claude-')) {
    return normalized.slice('anthropic/'.length);
  }
  return normalized;
}
