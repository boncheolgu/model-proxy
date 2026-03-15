const active = new Set<string>();

export function acquireConversationLock(key: string): boolean {
  if (active.has(key)) return false;
  active.add(key);
  return true;
}

export function releaseConversationLock(key: string): void {
  active.delete(key);
}
