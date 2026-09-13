import { expect, test } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { NativeRecall } from '../src/recall.ts';

const user = (id: string, text: string): SessionEntry => ({ type: 'message', id, parentId: null,
  timestamp: 'now', message: { role: 'user', content: text, timestamp: 0 } });
const custom = (id: string): SessionEntry => ({ type: 'custom', id, parentId: null,
  timestamp: 'now', customType: 'test', data: {} });
const context = (activeEntries: SessionEntry[]) => ({ sessionId: 'test', generation: 1, activeEntries });

test('literal no-match is distinct from unsupported native history, on every bounded page', () => {
  const recall = new NativeRecall();
  const unavailable = Array.from({ length: 220 }, (_, i) => custom(`unsupported-${i}`));
  const ctx = context([user('source', 'Keep truncation compatible with the public API.'), ...unavailable]);
  const request = { query: 'truncation public API', maxBytes: 1024 };
  let page = recall.recall(ctx, request), pages = 0;
  const ids: string[] = [];
  do {
    expect(page.matchSummary).toEqual({ mode: 'literal-case-sensitive-substring', status: 'no-text-matches',
      scannedTextEntries: 1, matchedTextEntries: 0, unavailableEntries: 220 });
    expect(page.fragments).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024);
    ids.push(...page.unavailable);
    expect(++pages).toBeLessThan(100);
    if (!page.cursor) break;
    page = recall.recall(ctx, { ...request, cursor: page.cursor });
  } while (true);
  expect(ids).toEqual(unavailable.map(e => e.id));
});

test('matching semantics remain literal and case-sensitive; omitted and empty query match empty text', () => {
  const recall = new NativeRecall(), ctx = context([user('a', 'Keep the API stable.'), user('empty', '')]);
  expect(recall.recall(ctx, { query: 'API stable' }).matchSummary.matchedTextEntries).toBe(1);
  expect(recall.recall(ctx, { query: 'api stable' }).matchSummary.status).toBe('no-text-matches');
  expect(recall.recall(ctx, {}).matchSummary).toMatchObject({ mode: 'all-text', matchedTextEntries: 2 });
  expect(recall.recall(ctx, { query: '' }).matchSummary.matchedTextEntries).toBe(2);
  expect(recall.recall(ctx, { entryIds: ['missing'], query: 'API' }).matchSummary)
    .toMatchObject({ status: 'no-text-available', scannedTextEntries: 0, unavailableEntries: 1 });
});

test('snapshot match metadata survives pages, appends, and caller mutation without losing exact text', () => {
  const recall = new NativeRecall(), text = 'Keep "API" \\ \u0000 😀'.repeat(200);
  const ctx = context([user('text', text), ...Array.from({ length: 80 }, (_, i) => custom(`u-${i}-${'x'.repeat(40)}`))]);
  const request = { query: 'API', maxBytes: 1024 };
  let page = recall.recall(ctx, request);
  expect(page.fragments[0]?.text.length).toBeGreaterThan(0);
  const expected = { ...page.matchSummary };
  expect(expected).toMatchObject({ status: 'matched', matchedTextEntries: 1, unavailableEntries: 80 });
  const nextContext = { ...ctx, activeEntries: [...ctx.activeEntries, user('later', 'API')] };
  page.matchSummary.matchedTextEntries = 0;
  let recovered = '', pages = 0;
  const unavailable: string[] = [];
  do {
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024);
    recovered += page.fragments.map(f => f.text).join(''); unavailable.push(...page.unavailable);
    expect(++pages).toBeLessThan(100);
    if (!page.cursor) break;
    page = recall.recall(nextContext, { ...request, cursor: page.cursor });
    expect(page.matchSummary).toEqual(expected);
  } while (true);
  expect(recovered).toBe(text);
  expect(unavailable).toEqual(ctx.activeEntries.slice(1).map(e => e.id));
});

test('mixed text and image can be both matched and explicitly unavailable', () => {
  const mixed: SessionEntry = { type: 'message', id: 'mixed', parentId: null, timestamp: 'now',
    message: { role: 'user', timestamp: 0, content: [{ type: 'text', text: 'API' }, { type: 'image', mimeType: 'image/png', data: 'x' }] } };
  const page = new NativeRecall().recall(context([mixed]), { query: 'API' });
  expect(page.matchSummary).toMatchObject({ status: 'matched', matchedTextEntries: 1, unavailableEntries: 1 });
  expect(page.fragments[0].text).toBe('API'); expect(page.unavailable).toEqual(['mixed']);
});

test('duplicate requested IDs count and return each selected native entry once', () => {
  const page = new NativeRecall().recall(context([user('a', 'API'), custom('unsupported')]),
    { entryIds: ['a', 'a', 'missing', 'missing', 'unsupported', 'unsupported'] });
  expect(page.matchSummary).toMatchObject({ scannedTextEntries: 1, matchedTextEntries: 1, unavailableEntries: 2 });
  expect(page.fragments.map(f => f.entryId)).toEqual(['a']);
  expect(page.unavailable).toEqual(['missing', 'unsupported']);
});
