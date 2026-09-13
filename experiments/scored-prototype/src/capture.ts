import { createHash } from 'node:crypto';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
export type SourceOrigin = 'unknown' | 'interactive' | 'rpc' | 'extension';
export interface ObservationData {
    sourceSessionId?: string;
    entryId: string;
    toolCallId: string;
    toolName: string;
    digest: string;
    partial: boolean;
    outcome: 'success' | 'error' | 'unknown';
    path?: string;
}
export type CapturedRecord = {
    schemaVersion: 1;
    id: string;
    anchor: string;
} & ({
    kind: 'user_source';
    data: {
        sourceSessionId: string;
        entryId: string;
        text: string;
        origin: SourceOrigin;
    };
} | {
    kind: 'observation';
    data: ObservationData;
});
export const textDigest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export function deriveObservationKey(sessionId: string, entryId: string, kind: string): string {
    return textDigest([sessionId, entryId, kind].map(value => `${Buffer.byteLength(value)}:${value}`).join(''));
}
/** Exact text blocks in native order, without inserted separators or normalization. */
export function nativeEntryText(entry: SessionEntry): string {
    if (entry.type === 'compaction' || entry.type === 'branch_summary')
        return entry.summary;
    const content = entry.type === 'custom_message' ? entry.content : entry.type === 'message' && 'content' in entry.message ? entry.message.content : undefined;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content))
        return content.filter(block => block.type === 'text').map(block => block.text).join('');
    return '';
}
function toolCalls(entries: readonly SessionEntry[]) {
    const calls = new Map<string, {
        name: string;
        arguments: Record<string, unknown>;
    }>();
    for (const entry of entries)
        if (entry.type === 'message' && entry.message.role === 'assistant') {
            for (const block of entry.message.content)
                if (block.type === 'toolCall')
                    calls.set(block.id, { name: block.name, arguments: block.arguments });
        }
    return calls;
}
export function pendingToolCalls(entries: readonly SessionEntry[]): string[] {
    const calls = toolCalls(entries);
    for (const entry of entries)
        if (entry.type === 'message' && entry.message.role === 'toolResult')
            calls.delete(entry.message.toolCallId);
    return [...calls.keys()];
}
export function captureEntries(sessionId: string, entries: readonly SessionEntry[], origins: ReadonlyMap<string, SourceOrigin> = new Map()): CapturedRecord[] {
    const calls = toolCalls(entries);
    const records: CapturedRecord[] = [];
    for (const entry of entries) {
        if (entry.type !== 'message')
            continue;
        const message = entry.message;
        if (message.role === 'user')
            records.push({ schemaVersion: 1, id: deriveObservationKey(sessionId, entry.id, 'user_source'), anchor: entry.id, kind: 'user_source', data: { sourceSessionId: sessionId, entryId: entry.id, text: nativeEntryText(entry), origin: origins.get(entry.id) ?? 'unknown' } });
        if (message.role === 'toolResult') {
            const call = calls.get(message.toolCallId);
            const text = nativeEntryText(entry);
            const details = message.details as {
                truncation?: {
                    truncated?: boolean;
                    firstLineExceedsLimit?: boolean;
                };
                truncated?: boolean;
            } | undefined;
            const partial = !call || call.name !== message.toolName || message.content.some(block => block.type !== 'text') || !!details?.truncated || !!details?.truncation?.truncated || !!details?.truncation?.firstLineExceedsLimit || call.arguments.offset !== undefined || call.arguments.limit !== undefined || /\[(?:Showing|Output truncated|Use offset)/i.test(text);
            const path = typeof call?.arguments.path === 'string' ? call.arguments.path : undefined;
            records.push({ schemaVersion: 1, id: deriveObservationKey(sessionId, entry.id, 'observation'), anchor: entry.id, kind: 'observation', data: { sourceSessionId: sessionId, entryId: entry.id, toolCallId: message.toolCallId, toolName: message.toolName, digest: textDigest(text), partial, outcome: message.isError ? 'error' : 'success', ...(path === undefined ? {} : { path }) } });
        }
    }
    return records;
}
/** Return deterministic record IDs that need appending on this active branch. */
export function missingSourceIds(records: readonly CapturedRecord[], existingIds: Iterable<string>): string[] {
    const existing = new Set(existingIds);
    return records.filter(record => !existing.has(record.id)).map(record => record.id);
}
