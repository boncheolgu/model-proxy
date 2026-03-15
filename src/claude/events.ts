export type ClaudeParsedEvent = {
  textDelta?: string;
  sessionId?: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
    isStart?: boolean;
  };
};

export function extractSessionId(event: any): string | null {
  if (event && event.type === 'system' && typeof event.session_id === 'string') {
    return event.session_id;
  }
  if (event && event.type === 'result' && typeof event.session_id === 'string') {
    return event.session_id;
  }
  return null;
}

export function parseClaudeEvent(event: any): ClaudeParsedEvent {
  const parsed: ClaudeParsedEvent = {};
  const sid = extractSessionId(event);
  if (sid) parsed.sessionId = sid;
  if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    parsed.toolCall = {
      index: Number(event.index ?? 0),
      id: typeof event.content_block.id === 'string' ? event.content_block.id : undefined,
      name: typeof event.content_block.name === 'string' ? event.content_block.name : undefined,
      isStart: true,
    };
  }
  if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
    parsed.toolCall = {
      index: Number(event.index ?? 0),
      argumentsDelta: typeof event.delta.partial_json === 'string' ? event.delta.partial_json : '',
      isStart: false,
    };
  }
  if (event?.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
    parsed.textDelta = event.delta.text;
  } else if (event?.type === 'assistant') {
    const txt = typeof event.message?.content?.[0]?.text === 'string'
      ? event.message.content[0].text
      : (typeof event.text === 'string' ? event.text : '');
    if (txt) parsed.textDelta = txt;
  }
  return parsed;
}

export function parseNdjsonLines(chunk: string): any[] {
  const lines = chunk
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: any[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}
