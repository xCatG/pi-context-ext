import { describe, expect, it } from 'vitest';
import { normalizeUsage, normalizePiUsage, UsageLedger, type UsageAdapter } from '../src/metrics.ts';

const adapter: UsageAdapter = { identity: 'synthetic/inclusive/v1', input: 'inclusive', fields: {
  input_tokens: { kind: 'input' }, cached_tokens: { kind: 'cacheRead' },
  cache_creation: { kind: 'cacheWrite' }, output_tokens: { kind: 'output' },
  reasoning: { kind: 'subset', of: 'output_tokens', explanation: 'Included in output' },
  cache_5m: { kind: 'subset', of: 'cache_creation', explanation: 'Lifetime breakdown' },
  latency: { kind: 'metadata', explanation: 'Milliseconds, not tokens' },
} };
const raw = { input_tokens: 100, cached_tokens: 20, cache_creation: 10, output_tokens: 30, reasoning: 5, cache_5m: 10, latency: 42 };
describe('auditable usage', () => {
  it('maps pinned Pi normalized usage with validated aggregate and optional subsets', () => {
    const pi = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cacheWrite1h: 5, reasoning: 3,
      totalTokens: 100, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
    expect(normalizePiUsage(pi, 'succeeded')).toMatchObject({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, logicalTokens: 100, raw: pi });
    expect(normalizePiUsage({ ...pi, totalTokens: 101 }, 'succeeded').logicalTokens).toBeNull();
    expect(normalizePiUsage({ ...pi, vendorExtraTokens: 1 }, 'succeeded').logicalTokens).toBeNull();
    expect(normalizePiUsage({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100 }, 'failed').logicalTokens).toBe(100);
  });
  it('keeps zero-only failed/unknown Pi usage unknown instead of inventing zero spend', () => {
    const zeros = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    expect(normalizePiUsage(zeros, 'failed').logicalTokens).toBeNull();
    expect(normalizePiUsage(zeros, 'unknown').logicalTokens).toBeNull();
    expect(normalizePiUsage(zeros, 'succeeded').logicalTokens).toBe(0);
  });
  it('subtracts inclusive caches and never adds documented subsets twice', () => {
    expect(normalizeUsage(raw, adapter)).toMatchObject({ input: 70, cacheRead: 20, cacheWrite: 10, output: 30, logicalTokens: 130, adapterIdentity: adapter.identity, raw });
  });
  it('adds exclusive reasoning once', () => {
    expect(normalizeUsage(raw, { ...adapter, fields: { ...adapter.fields, reasoning: { kind: 'reasoningExclusive' } } }).logicalTokens).toBe(135);
  });
  it('propagates missing, negative, overlapping and unmapped values as unknown', () => {
    for (const usage of [null, { ...raw, future_tokens: 7 }, { ...raw, input_tokens: null }, { ...raw, cached_tokens: 101 }, { ...raw, reasoning: 31 }]) {
      expect(normalizeUsage(usage, adapter).logicalTokens).toBeNull();
    }
    expect(normalizeUsage(raw, { ...adapter, fields: { ...adapter.fields, reasoning: { kind: 'unknown' } } }).logicalTokens).toBeNull();
  });
  it('deduplicates nested observations and includes failed calls with unknown usage', () => {
    const ledger = new UsageLedger();
    const call = { operationId: 'native-summary-1', category: 'summary', status: 'failed' as const, usage: normalizeUsage(raw, adapter), billedCost: null, wallMs: 50 };
    expect(ledger.record(call)).toBe(true);
    expect(ledger.record(call)).toBe(false);
    expect(ledger.totals()).toMatchObject({ logicalTokens: 130, billedCost: null, wallMs: 50, operations: 1 });
    ledger.record({ ...call, operationId: 'retry-2', usage: normalizeUsage(null, adapter) });
    expect(ledger.totals()).toMatchObject({ logicalTokens: null, wallMs: 100, operations: 2 });
  });
  it('retains immutable raw evidence and rejects conflicting duplicate accounting', () => {
    const ledger = new UsageLedger();
    const call = { operationId: 'one', category: 'provider', status: 'succeeded' as const, usage: normalizeUsage(raw, adapter), billedCost: 1, wallMs: 50 };
    ledger.record(call);
    call.usage.logicalTokens = 0;
    expect(ledger.totals().logicalTokens).toBe(130);
    expect(() => ledger.record(call)).toThrow('Conflicting duplicate');
    ledger.record({ ...call, category: 'tool', usage: normalizeUsage(null, adapter) });
    expect(ledger.totals().operations).toBe(2);
  });
  it('requires documented zeros and handles nested provider fields and duplicate totals', () => {
    expect(normalizeUsage({ usage: { prompt: 10, completion: 2, total: 12 } }, {
      identity: 'nested/v1', input: 'uncached', fields: { 'usage.prompt': { kind: 'input' }, 'usage.completion': { kind: 'output' },
        'usage.total': { kind: 'unknown' } }, zeroBuckets: ['cacheRead', 'cacheWrite'],
    }).logicalTokens).toBeNull();
    expect(normalizeUsage({ prompt: 10, completion: 2, duplicate: 2 }, {
      identity: 'nested/v1', input: 'uncached', fields: { prompt: { kind: 'input' }, completion: { kind: 'output' },
        duplicate: { kind: 'duplicate', of: 'completion', explanation: 'Same reported output' } }, zeroBuckets: ['cacheRead', 'cacheWrite'],
    }).logicalTokens).toBe(12);
    expect(normalizeUsage({ prompt: 10, completion: 2, total: 12 }, {
      identity: 'aggregate/v1', input: 'uncached', fields: { prompt: { kind: 'input' }, completion: { kind: 'output' },
        total: { kind: 'duplicate', of: ['prompt', 'completion'], explanation: 'Provider total input plus output' } }, zeroBuckets: ['cacheRead', 'cacheWrite'],
    }).logicalTokens).toBe(12);
  });
});
