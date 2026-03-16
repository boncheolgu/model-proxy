import { Router } from 'express';
import { randomUUID } from 'node:crypto';
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
    const startedAt = Date.now();
    const runId = randomUUID();
    let ended = false;
    const log = (event: 'request.start' | 'request.end', payload: Record<string, unknown>) => {
      try {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            runId,
            event,
            ...payload,
          }),
        );
      } catch {
        return;
      }
    };
    const logEnd = (payload: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      log('request.end', {
        elapsedMs: Date.now() - startedAt,
        ...payload,
      });
    };
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
      log('request.start', {
        model: body.model,
        stream: wantsStream,
        tenantId: areq.tenant.id,
        conversationKey,
      });
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
            logEnd({
              stream: true,
              isError: true,
              statusCode: 502,
              exitCode: result.exitCode,
              sessionId: result.sessionId,
            });
            return res.status(502).json({
              error: {
                message: result.text || 'runner failed',
                type: 'server_error',
                code: 'runner_failed',
              },
            });
          }
          logEnd({
            stream: true,
            isError: true,
            statusCode: 200,
            exitCode: result.exitCode,
            sessionId: result.sessionId,
          });
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
        logEnd({
          stream: true,
          isError: false,
          statusCode: 200,
          exitCode: result.exitCode,
          sessionId: result.sessionId,
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
        logEnd({
          stream: false,
          isError: true,
          statusCode: 502,
          exitCode: result.exitCode,
          sessionId: result.sessionId,
        });
        return res.status(502).json({
          error: {
            message: result.text || 'runner failed',
            type: 'server_error',
            code: 'runner_failed',
          },
        });
      }

      logEnd({
        stream: false,
        isError: false,
        statusCode: 200,
        exitCode: result.exitCode,
        sessionId: result.sessionId,
      });
      return res.json(mapNonStreamResult({ text: result.text, model: body.model }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      if (wantsStream || res.headersSent) {
        if (!res.headersSent) {
          beginSse(res);
        }
        logEnd({
          stream: true,
          isError: true,
          statusCode: 200,
          error: msg,
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const status = msg.includes('busy') ? 409 : 400;
      logEnd({
        stream: false,
        isError: true,
        statusCode: status,
        error: msg,
      });
      return res.status(status).json({ error: { message: msg, type: 'invalid_request_error', code: 'bad_request' } });
    }
  });

  return router;
}
