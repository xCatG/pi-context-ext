import { randomUUID } from 'node:crypto';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { nativeEntryText, textDigest } from './capture.ts';
export interface RecallContext {
    sessionId: string;
    generation: string | number;
    activeEntries: readonly SessionEntry[];
    allEntries?: readonly SessionEntry[];
}
/** maxBytes bounds the full JSON.stringify response, including its envelope. */
export interface RecallRequest {
    scope?: 'active' | 'historical';
    entryIds?: string[];
    /** Literal case-sensitive substring of native text; omitted/empty matches all supported text. */
    query?: string;
    cursor?: string;
    maxBytes?: number;
}
export interface RecallMatchSummary {
    mode: 'all-text' | 'literal-case-sensitive-substring';
    status: 'matched' | 'no-text-matches' | 'no-text-available';
    /** Totals for the frozen snapshot, not just this page; counts entries, not occurrences. */
    scannedTextEntries: number;
    matchedTextEntries: number;
    /** Independent of query matches; may overlap mixed text/nontext entries. */
    unavailableEntries: number;
}
export interface RecallResult {
    /** Fixed-size metadata: does not echo the query or enumerate matching identifiers. */
    matchSummary: RecallMatchSummary;
    provenance: {
        sessionId: string;
        scope: 'active' | 'historical';
        authority: 'source-data';
        representation: 'text-blocks-only';
        snapshotLeaf: string | null;
    };
    fragments: {
        entryId: string;
        byteOffset: number;
        text: string;
        complete: boolean;
    }[];
    /** Missing entries, unsupported entries, or entries with unavailable nontext content. */
    unavailable: string[];
    cursor?: string;
}
interface Snapshot {
    sessionId: string;
    generation: string | number;
    leaf: string | null;
    ancestry: string[];
    key: string;
    scope: 'active' | 'historical';
    matchSummary: RecallMatchSummary;
    entries: {
        id: string;
        text: string;
    }[];
    unavailable: string[];
}
interface Position {
    snapshot: Snapshot;
    index: number;
    offset: number;
    unavailableIndex: number;
}
const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
function textSupport(entry: SessionEntry): {
    supported: boolean;
    nontext: boolean;
} {
    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        return { supported: true, nontext: false };
    }
    if (entry.type !== 'message' || !['user', 'assistant', 'toolResult'].includes(entry.message.role) || !('content' in entry.message)) {
        return { supported: false, nontext: true };
    }
    const content = entry.message.content;
    if (typeof content === 'string')
        return { supported: true, nontext: false };
    return {
        supported: content.some(block => block.type === 'text'),
        nontext: content.some(block => block.type !== 'text'),
    };
}
/** Disposable cursor store. Source strings are frozen at the first page. */
export class NativeRecall {
    private cursors = new Map<string, Position>();
    recall(context: RecallContext, request: RecallRequest = {}): RecallResult {
        const scope = request.scope ?? 'active';
        if (scope !== 'active' && scope !== 'historical')
            throw new Error('Invalid recall scope');
        const maxBytes = request.maxBytes ?? 16384;
        if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536) {
            throw new Error('maxBytes must be an integer between 1024 and 65536');
        }
        if (request.entryIds && (!Array.isArray(request.entryIds) || request.entryIds.length > 128)) {
            throw new Error('At most 128 entryIds may be requested');
        }
        if (request.entryIds?.some(id => typeof id !== 'string' || Buffer.byteLength(id) > 512)) {
            throw new Error('entryIds must be strings of at most 512 UTF-8 bytes');
        }
        const key = textDigest(JSON.stringify({ scope, entryIds: request.entryIds ?? null, query: request.query ?? '' }));
        let position: Position;
        if (request.cursor) {
            const stored = this.cursors.get(request.cursor);
            if (!stored || stored.snapshot.sessionId !== context.sessionId || stored.snapshot.generation !== context.generation || stored.snapshot.key !== key || !stored.snapshot.ancestry.every((id, index) => context.activeEntries[index]?.id === id)) {
                throw new Error('stale recall cursor');
            }
            position = { ...stored };
        }
        else {
            const available = scope === 'historical' ? (context.allEntries ?? context.activeEntries) : context.activeEntries;
            const byId = new Map(available.map(entry => [entry.id, entry]));
            const requestedIds = request.entryIds ? [...new Set(request.entryIds)] : undefined;
            const selected = requestedIds ? requestedIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []) : available;
            const unavailable = requestedIds?.filter(id => !byId.has(id)) ?? [];
            const entries: Snapshot['entries'] = [];
            let scannedTextEntries = 0;
            for (const entry of selected) {
                const support = textSupport(entry);
                if (!support.supported || support.nontext)
                    unavailable.push(entry.id);
                if (support.supported) {
                    scannedTextEntries++;
                    const text = nativeEntryText(entry);
                    if (!request.query || text.includes(request.query))
                        entries.push({ id: entry.id, text });
                }
            }
            position = {
                index: 0, offset: 0, unavailableIndex: 0,
                snapshot: {
                    sessionId: context.sessionId, generation: context.generation, key, scope,
                    leaf: context.activeEntries.at(-1)?.id ?? null,
                    ancestry: context.activeEntries.map(entry => entry.id), entries, unavailable,
                    matchSummary: {
                        mode: request.query ? 'literal-case-sensitive-substring' : 'all-text',
                        status: entries.length ? 'matched' : scannedTextEntries ? 'no-text-matches' : 'no-text-available',
                        scannedTextEntries, matchedTextEntries: entries.length, unavailableEntries: unavailable.length,
                    },
                },
            };
        }
        const snapshot = position.snapshot;
        // Reserve a fixed-size continuation token even for a final page.
        const result: RecallResult = {
            matchSummary: { ...snapshot.matchSummary },
            provenance: {
                sessionId: snapshot.sessionId, scope: snapshot.scope, authority: 'source-data',
                representation: 'text-blocks-only', snapshotLeaf: snapshot.leaf,
            },
            fragments: [], unavailable: [], cursor: randomUUID(),
        };
        if (jsonBytes(result) > maxBytes)
            throw new Error('Recall provenance exceeds maxBytes; increase the budget');
        // Prioritize exact matching evidence over potentially large unavailable-ID lists.
        while (position.index < snapshot.entries.length && result.fragments.length < 128) {
            const entry = snapshot.entries[position.index];
            const bytes = Buffer.from(entry.text, 'utf8');
            const fragment = { entryId: entry.id, byteOffset: position.offset, text: '', complete: false };
            result.fragments.push(fragment);
            let room = maxBytes - jsonBytes(result);
            if (room < 0) {
                result.fragments.pop();
                break;
            }
            // Per-scalar JSON cost accounts for escaped control characters and preserves UTF-8 boundaries.
            const parts: string[] = [];
            let consumed = 0;
            for (const scalar of bytes.subarray(position.offset).toString('utf8')) {
                const cost = jsonBytes(scalar) - 2;
                if (cost > room)
                    break;
                room -= cost;
                consumed += Buffer.byteLength(scalar);
                parts.push(scalar);
            }
            if (!consumed && position.offset < bytes.length) {
                result.fragments.pop();
                break;
            }
            fragment.text = parts.join('');
            position.offset += consumed;
            fragment.complete = position.offset === bytes.length;
            if (fragment.complete) {
                position.index++;
                position.offset = 0;
            }
            else {
                break;
            }
        }
        while (position.unavailableIndex < snapshot.unavailable.length) {
            result.unavailable.push(snapshot.unavailable[position.unavailableIndex]);
            if (jsonBytes(result) > maxBytes) {
                result.unavailable.pop();
                break;
            }
            position.unavailableIndex++;
        }
        const more = position.index < snapshot.entries.length || position.unavailableIndex < snapshot.unavailable.length;
        if (more) {
            if (!result.fragments.length && !result.unavailable.length) {
                throw new Error('Recall entry metadata exceeds maxBytes; increase the budget');
            }
            this.cursors.set(result.cursor!, position);
            while (this.cursors.size > 128)
                this.cursors.delete(this.cursors.keys().next().value!);
        }
        else {
            delete result.cursor;
        }
        return result;
    }
}
