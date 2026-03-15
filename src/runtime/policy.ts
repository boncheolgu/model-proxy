export type RetryPolicyDecision = {
  retryAsNewSession: boolean;
};

export function shouldRetryWithoutResume(stderr: string): RetryPolicyDecision {
  const text = stderr.toLowerCase();
  const markers = ['no conversation found with session id', 'session not found', 'resume failed'];
  return { retryAsNewSession: markers.some((m) => text.includes(m)) };
}

export function timeoutMs(): number {
  const raw = Number(process.env.CLAUDE_PROXY_TIMEOUT_MS || 120000);
  return Number.isFinite(raw) && raw > 1000 ? raw : 120000;
}
