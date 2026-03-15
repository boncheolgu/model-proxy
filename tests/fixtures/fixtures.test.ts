import fs from 'node:fs';
import path from 'node:path';
import { parseNdjsonLines } from '../../src/claude/events.js';

describe('fixture parsing', () => {
  it('matches expected line count for basic fixture stream', () => {
    const p = path.join(process.cwd(), 'tests/fixtures/claude-ndjson/basic-text.jsonl');
    const raw = fs.readFileSync(p, 'utf8');
    const events = parseNdjsonLines(raw);
    expect(events.length).toBe(4);
  });
});
