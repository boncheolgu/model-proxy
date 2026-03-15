import { shouldRetryWithoutResume } from '../../src/runtime/policy.js';

describe('policy', () => {
  it('invalidates stale session and retries once on resume-not-found marker', () => {
    const outcome = shouldRetryWithoutResume('No conversation found with session ID: abc');
    expect(outcome.retryAsNewSession).toBe(true);
  });
});
