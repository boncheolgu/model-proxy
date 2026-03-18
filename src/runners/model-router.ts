import type { ModelRunner, RunnerInput, RunnerResult } from './types.js';
import { isClaudeModel } from './model-utils.js';

export class ModelRouterRunner implements ModelRunner {
  constructor(
    private readonly claudeRunner: ModelRunner,
    private readonly upstreamRunner?: ModelRunner,
  ) {}

  async run(input: RunnerInput): Promise<RunnerResult> {
    if (isClaudeModel(input.model)) {
      return this.claudeRunner.run(input);
    }
    if (!this.upstreamRunner) {
      throw new Error('non-claude model is not configured: set MODEL_PROXY_UPSTREAM_BASE_URL');
    }
    return this.upstreamRunner.run(input);
  }
}
