import type { ChatCompletionRequest } from '../contracts/openai-chat.js';

export type ToolCallDelta = {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
  isStart?: boolean;
};

export type RunnerInput = {
  tenantId: string;
  conversationKey: string;
  model: string;
  prompt: string;
  request: ChatCompletionRequest;
  systemPrompt?: string;
  effort?: string;
  permissions?: 'auto' | 'default';
  onDelta?: (text: string) => void;
  onToolCall?: (delta: ToolCallDelta) => void;
};

export type RunnerResult = {
  text: string;
  stderr: string;
  sessionId: string | null;
  exitCode: number;
};

export type ModelRunner = {
  run(input: RunnerInput): Promise<RunnerResult>;
};
