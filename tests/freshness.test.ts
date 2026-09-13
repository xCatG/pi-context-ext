import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compareSpan } from '../src/freshness.js';
it('audits exact text without normalizing CRLF or authenticating partial output', () => {
    const observation = { toolName: 'read', outcome: 'success' as const, partial: false, digest: createHash('sha256').update('a\r\n').digest('hex') };
    expect(compareSpan(observation, 'a\r\n')).toBe('fresh');
    expect(compareSpan(observation, 'a\n')).toBe('stale');
    expect(compareSpan({ ...observation, partial: true }, 'a\r\n')).toBe('unknown');
    expect(compareSpan({ ...observation, toolName: 'bash' }, 'a\r\n')).toBe('unknown');
});
