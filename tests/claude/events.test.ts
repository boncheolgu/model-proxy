import { extractSessionId, parseClaudeEvent, parseNdjsonLines } from '../../src/claude/events.js';

describe('claude events', () => {
  it('extracts session id from claude system event', () => {
    const sid = extractSessionId({ type: 'system', session_id: 's-123' });
    expect(sid).toBe('s-123');
  });

  it('parses ndjson lines and skips invalid entries', () => {
    const parsed = parseNdjsonLines('{"type":"system","session_id":"s"}\nnope\n{"type":"assistant","text":"h"}');
    expect(parsed.length).toBe(2);
  });

  it('extracts tool call start and argument deltas', () => {
    const start = parseClaudeEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_1', name: 'search_web' },
    });
    expect(start.toolCall?.id).toBe('tool_1');
    const delta = parseClaudeEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"q":"hello"}' },
    });
    expect(delta.toolCall?.argumentsDelta).toContain('hello');
  });
});
