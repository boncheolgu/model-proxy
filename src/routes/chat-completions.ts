import { Router } from 'express';
import { parseChatRequest } from '../contracts/openai-chat.js';
import { requireAuthAndTenant, resolveConversationKey, type AuthedRequest } from '../middleware/auth.js';
import { getContainer } from '../runtime/container.js';
import { mapNonStreamResult } from '../adapters/openai-nonstream.js';
import { beginSse, createStreamState, endStream, writeDelta, writeToolCallDelta } from '../adapters/openai-stream.js';
import type { ClaudeRunner } from '../claude/runner.js';

type RouteContainer = {
  runner: Pick<ClaudeRunner, 'run'>;
};

function getPromptFromMessages(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'system' || m.role === 'developer')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n\n');
}

function estimateTokens(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, parts.length);
}

export function createChatCompletionsRouter(override?: RouteContainer) {
  const router = Router();
  const container = override ?? getContainer();

  router.post('/', requireAuthAndTenant, async (req, res) => {
    let wantsStream = false;
    try {
      const body = parseChatRequest(req.body);
      wantsStream = Boolean(body.stream);
      if (body.n != null && body.n !== 1) {
        return res.status(400).json({
          error: {
            message: 'Only n=1 is supported',
            type: 'invalid_request_error',
            code: 'unsupported_parameter',
          },
        });
      }
      const areq = req as AuthedRequest;
      const conversationKey = resolveConversationKey(req, body.model);
      areq.conversationKey = conversationKey;
      const prompt = getPromptFromMessages(body.messages as Array<{ role: string; content: unknown }>);

      if (body.stream) {
        const state = createStreamState(body.model);
        let sseStarted = false;
        const startSse = () => {
          if (sseStarted) return;
          beginSse(res);
          sseStarted = true;
        };
        const result = await container.runner.run({
          tenantId: areq.tenant.id,
          conversationKey,
          model: body.model,
          prompt,
          onDelta: (txt) => {
            startSse();
            writeDelta(res, state, txt);
          },
          onToolCall: (delta) => {
            startSse();
            writeToolCallDelta(res, state, delta);
          },
        });
        if (result.exitCode !== 0) {
          if (!sseStarted) {
            return res.status(502).json({
              error: {
                message: result.text || 'runner failed',
                type: 'server_error',
                code: 'runner_failed',
              },
            });
          }
          res.end();
          return;
        }
        startSse();
        const promptTokens = estimateTokens(prompt);
        const completionTokens = estimateTokens(result.text || '');
        endStream(res, state, {
          includeUsage: Boolean(body.stream_options?.include_usage),
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        });
        return;
      }

      const result = await container.runner.run({
        tenantId: areq.tenant.id,
        conversationKey,
        model: body.model,
        prompt,
      });

      if (result.exitCode !== 0) {
        return res.status(502).json({
          error: {
            message: result.text || 'runner failed',
            type: 'server_error',
            code: 'runner_failed',
          },
        });
      }

      return res.json(mapNonStreamResult({ text: result.text, model: body.model }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      if (wantsStream || res.headersSent) {
        if (!res.headersSent) {
          beginSse(res);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const status = msg.includes('busy') ? 409 : 400;
      return res.status(status).json({ error: { message: msg, type: 'invalid_request_error', code: 'bad_request' } });
    }
  });

  return router;
}
