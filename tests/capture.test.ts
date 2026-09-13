import { describe, expect, it } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { captureEntries, deriveObservationKey, missingSourceIds, nativeEntryText, pendingToolCalls } from '../src/capture.js';
export const user = (id: string, text: string, parentId: string | null = null): SessionEntry => ({ type: 'message', id, parentId, timestamp: 'now', message: { role: 'user', content: text, timestamp: 0 } });
describe('native capture', () => {
    it('preserves exact user source and rehydrates a fork missing its index', () => {
        const entries = [user('u', 'C:\\work\\file\r\nnext')];
        const records = captureEntries('s', entries);
        expect(records[0].data).toMatchObject({ text: 'C:\\work\\file\r\nnext', origin: 'unknown' });
        expect(missingSourceIds(records, [])).toEqual([records[0].id]);
        expect(missingSourceIds(records, [records[0].id])).toEqual([]);
        expect(nativeEntryText(entries[0])).toBe('C:\\work\\file\r\nnext');
        expect(deriveObservationKey('ab', 'c', 'observation')).not.toBe(deriveObservationKey('a', 'bc', 'observation'));
    });
    it('matches native starts by call id and preserves Windows path metadata', () => {
        const start: SessionEntry = { type: 'message', id: 'a', parentId: null, timestamp: 'now', message: { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'test', stopReason: 'toolUse', timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: [{ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'C:\\work\\file' } }] } };
        const result = { type: 'message', id: 'r', parentId: 'a', timestamp: 'now', message: { role: 'toolResult', toolCallId: 't', toolName: 'read', content: [{ type: 'text', text: 'exact\r\n' }], isError: false, timestamp: 0 } } as SessionEntry;
        expect(pendingToolCalls([start])).toEqual(['t']);
        expect(pendingToolCalls([start, result])).toEqual([]);
        expect(captureEntries('s', [start, result])[0].data).toMatchObject({ path: 'C:\\work\\file', partial: false, outcome: 'success' });
    });
    it('indexes errors and conservatively marks truncated or unmatched results partial', () => {
        const result = { type: 'message', id: 'r', parentId: null, timestamp: 'now', message: { role: 'toolResult', toolCallId: 't', toolName: 'read', content: [{ type: 'text', text: 'abc\r\n' }], isError: true, details: { truncation: { truncated: true } }, timestamp: 0 } } as SessionEntry;
        expect(captureEntries('s', [result])[0].data).toMatchObject({ outcome: 'error', partial: true, toolCallId: 't' });
    });
});
