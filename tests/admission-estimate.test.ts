import { expect, test } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { estimateRequestMessages } from '../src/admission.ts';
import { project, PROJECTION_TYPE, transformMessages } from '../src/projection.ts';
import { rebuild } from '../src/records.ts';

test('large tool arguments and many tiny messages cannot disappear from admission', () => {
  const tool = fauxAssistantMessage({ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'x'.repeat(262144) } });
  expect(estimateRequestMessages([tool])).toBeGreaterThan(65536);
  const tiny = Array.from({ length: 1000 }, () => ({ role: 'user' as const, content: '', timestamp: 0 }));
  expect(estimateRequestMessages(tiny)).toBeGreaterThanOrEqual(32000);
});

test('projection and persisted recall retain full escaped-content byte bounds', () => {
  const content = [{ type: 'text' as const, text: '"\\\n漢😀'.repeat(1000) }];
  const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
  expect(estimateRequestMessages([{ role: 'custom', customType: PROJECTION_TYPE, content, display: false, timestamp: 0 }])).toBeGreaterThanOrEqual(bytes);
  expect(estimateRequestMessages([{ role: 'toolResult', toolName: 'context_recall', toolCallId: 'r', content, isError: false, timestamp: 0 }])).toBeGreaterThanOrEqual(bytes);
});

test('summary wrappers count and prior usage does not change current message estimation', () => {
  const source = [{ role: 'compactionSummary' as const, summary: 'Prior diagnosis', tokensBefore: 900000, timestamp: 0 }];
  expect(estimateRequestMessages(transformMessages(source, ''))).toBeGreaterThan(estimateRequestMessages(source));
  const assistant = fauxAssistantMessage('same visible content');
  const before = estimateRequestMessages([assistant]);
  assistant.usage.input = 999999;
  assistant.usage.output = 999999;
  expect(estimateRequestMessages([assistant])).toBe(before);
});

test('native unicode and images remain a heuristic, while image payload bytes are not text tokens', () => {
  const text = '漢😀'.repeat(100);
  expect(estimateRequestMessages([{ role: 'user', content: text, timestamp: 0 }])).toBeLessThan(Buffer.byteLength(text));
  const image = (data: string) => ({ role: 'user' as const, content: [{ type: 'image' as const, data, mimeType: 'image/png' }], timestamp: 0 });
  expect(estimateRequestMessages([image('AAAA')])).toBe(estimateRequestMessages([image('AAAA'.repeat(10000))]));
  expect(estimateRequestMessages([image('AAAA'), image('AAAA')])).toBeGreaterThan(estimateRequestMessages([image('AAAA')]));
});

test('mandatory projection accepts exact byte headroom and rejects one byte less', () => {
  const state = rebuild([], new Set());
  const budget = { window: 100000, nativeTokens: 0, fixedTokens: 0, outputReserve: 0, safetyMargin: 0, softTarget: 0 };
  const first = project(state, budget);
  if (first.status !== 'ready') throw Error('Fixture must fit');
  const bytes = Buffer.byteLength(first.text, 'utf8');
  expect(project(state, { ...budget, window: bytes }).status).toBe('ready');
  expect(project(state, { ...budget, window: bytes - 1 }).status).toBe('blocked');
});

test('escaped optional data is omitted when only mandatory context fits', () => {
  const state = rebuild([{ schemaVersion: 1, id: 'claim', anchor: 'u', kind: 'claim', data: {
    text: '\\'.repeat(300), status: 'hypothesis', evidenceIds: [], counterEvidenceIds: [],
  } }], new Set(['u']));
  const budget = { window: 100000, nativeTokens: 0, fixedTokens: 0, outputReserve: 0, safetyMargin: 0, softTarget: 100000 };
  const full = project(state, budget);
  if (full.status !== 'ready') throw Error('Fixture must fit');
  const empty = estimateRequestMessages(transformMessages([], ''));
  const measure = (text: string) => estimateRequestMessages(transformMessages([], text)) - empty;
  const result = project(state, { ...budget, window: Buffer.byteLength(full.text) }, measure);
  expect(result.status).toBe('ready');
  if (result.status === 'ready') expect(result.omittedIds).toEqual(['claim']);
});

test.each([NaN, Infinity, -1])('invalid projection cost %s cannot admit content', value => {
  expect(project(rebuild([], new Set()), { window: 100000, nativeTokens: 0, fixedTokens: 0,
    outputReserve: 0, safetyMargin: 0, softTarget: 10000 }, () => value).status).toBe('blocked');
});
