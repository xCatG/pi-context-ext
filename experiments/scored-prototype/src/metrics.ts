/** Pure accounting. Adapters must document provider semantics before use. */
type Bucket = 'input' | 'cacheRead' | 'cacheWrite' | 'output';
type Mapping = { kind: Bucket | 'reasoningExclusive' | 'unknown' }
  | { kind: 'subset'; of: string; explanation: string }
  | { kind: 'duplicate'; of: string | string[]; explanation: string }
  | { kind: 'metadata'; explanation: string };
export interface UsageAdapter {
  identity: string;
  input: 'inclusive' | 'uncached';
  /** Dot-separated leaf paths. Every raw leaf requires an explicit classification. */
  fields: Record<string, Mapping>;
  /** Only buckets documented as absent by the provider may be declared zero. */
  zeroBuckets?: Bucket[];
}
export interface NormalizedUsage {
  raw: unknown;
  adapterIdentity: string;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  logicalTokens: number | null;
  issues: string[];
}
function leaves(value: unknown, prefix = '', result: Record<string, unknown> = {}): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) leaves(child, prefix ? `${prefix}.${key}` : key, result);
  } else result[prefix] = value;
  return result;
}
function quantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function normalizeUsage(raw: unknown, adapter: UsageAdapter): NormalizedUsage {
  const values = leaves(raw);
  const issues: string[] = [];
  const sums: Record<Bucket, number> = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const seen = new Set<Bucket>(adapter.zeroBuckets ?? []);
  if (!adapter.identity.trim()) issues.push('Missing adapter identity');
  for (const [path, value] of Object.entries(values)) {
    const mapping = adapter.fields[path];
    if (!mapping || mapping.kind === 'unknown') { issues.push(`Unmapped or ambiguous quantity: ${path}`); continue; }
    if (mapping.kind === 'metadata') {
      if (!mapping.explanation.trim()) issues.push(`Undocumented metadata: ${path}`);
      continue;
    }
    if (!quantity(value)) { issues.push(`Unknown or invalid quantity: ${path}`); continue; }
    if (mapping.kind === 'subset' || mapping.kind === 'duplicate') {
      const references = typeof mapping.of === 'string' ? [mapping.of] : mapping.of;
      const valid = references.length > 0 && new Set(references).size === references.length && references.every(ref =>
        quantity(values[ref]) && adapter.fields[ref] && ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoningExclusive'].includes(adapter.fields[ref].kind));
      const parent = valid ? references.reduce((sum, ref) => sum + (values[ref] as number), 0) : NaN;
      if (!mapping.explanation.trim() || !quantity(parent) ||
          (mapping.kind === 'subset' ? value > parent : value !== parent)) issues.push(`Invalid subset/duplicate: ${path}`);
      continue;
    }
    const bucket = mapping.kind === 'reasoningExclusive' ? 'output' : mapping.kind;
    if (adapter.zeroBuckets?.includes(bucket)) issues.push(`Zero declaration conflicts with reported bucket: ${bucket}`);
    sums[bucket] += value;
    seen.add(bucket);
  }
  for (const [path, mapping] of Object.entries(adapter.fields)) {
    if (mapping.kind !== 'metadata' && !(path in values)) issues.push(`Missing reported quantity: ${path}`);
  }
  for (const bucket of Object.keys(sums) as Bucket[]) if (!seen.has(bucket)) issues.push(`Unknown bucket: ${bucket}`);
  if (adapter.input === 'inclusive') sums.input -= sums.cacheRead + sums.cacheWrite;
  if (Object.values(sums).some(n => !quantity(n))) issues.push('Overlapping or invalid buckets');
  const total = sums.input + sums.cacheRead + sums.cacheWrite + sums.output;
  if (!quantity(total)) issues.push('Invalid total');
  return { raw: structuredClone(raw), adapterIdentity: adapter.identity,
    input: issues.length ? null : sums.input, cacheRead: issues.length ? null : sums.cacheRead,
    cacheWrite: issues.length ? null : sums.cacheWrite, output: issues.length ? null : sums.output,
    logicalTokens: issues.length ? null : total, issues };
}

/**
 * Pi 0.85.1 Usage, NOT raw vendor usage: Pi may already have discarded fields.
 * Audited installed pi-ai dist/types.d.ts and api/openai-completions.js (input
 * subtracts cache read/write), openai-responses-shared.js and google-generative-ai.js.
 * Anthropic maps its separate uncached/cache buckets in api/anthropic-messages.js.
 * Provider calibration is still required before interpreting this as full spend.
 */
export function normalizePiUsage(raw: unknown, outcome: 'succeeded' | 'failed' | 'unknown'): NormalizedUsage {
  const fields: UsageAdapter['fields'] = {
    input: { kind: 'input' }, output: { kind: 'output' }, cacheRead: { kind: 'cacheRead' }, cacheWrite: { kind: 'cacheWrite' },
    totalTokens: { kind: 'duplicate', of: ['input', 'output', 'cacheRead', 'cacheWrite'], explanation: 'Pi disjoint bucket aggregate; verified against component sum' },
    'cost.input': { kind: 'metadata', explanation: 'Pi estimated monetary cost, not token count' },
    'cost.output': { kind: 'metadata', explanation: 'Pi estimated monetary cost, not token count' },
    'cost.cacheRead': { kind: 'metadata', explanation: 'Pi estimated monetary cost, not token count' },
    'cost.cacheWrite': { kind: 'metadata', explanation: 'Pi estimated monetary cost, not token count' },
    'cost.total': { kind: 'metadata', explanation: 'Pi estimated monetary cost, not token count' },
  };
  if (raw && typeof raw === 'object') {
    if ('reasoning' in raw) fields.reasoning = { kind: 'subset', of: 'output', explanation: 'Pi Usage.reasoning is already included in output' };
    if ('cacheWrite1h' in raw) fields.cacheWrite1h = { kind: 'subset', of: 'cacheWrite', explanation: 'Pi Usage.cacheWrite1h is a lifetime subset of cacheWrite' };
  }
  const usage = normalizeUsage(raw, { identity: '@earendil-works/pi-ai/0.85.1/normalized-Usage/v1', input: 'uncached', fields });
  if (outcome !== 'succeeded' && usage.logicalTokens === 0) {
    return { ...usage, input: null, output: null, cacheRead: null, cacheWrite: null, logicalTokens: null,
      issues: [...usage.issues, 'Zero-only unsuccessful Pi usage may be synthesized; consumed usage unknown'] };
  }
  return usage;
}
export interface UsageRecord {
  operationId: string;
  category: string;
  status: 'succeeded' | 'failed' | 'unknown';
  usage: NormalizedUsage;
  billedCost: number | null;
  wallMs: number | null;
}
export function sumKnown(values: readonly (number | null)[]): number | null {
  if (values.some(value => !quantity(value))) return null;
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) ? sum : null;
}
export class UsageLedger {
  private readonly records = new Map<string, UsageRecord>();
  record(record: UsageRecord): boolean {
    if (!record.operationId || !record.category) throw new Error('Operation identity and category required');
    const key = JSON.stringify([record.operationId, record.category]);
    const existing = this.records.get(key);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Conflicting duplicate accounting observation');
      return false;
    }
    this.records.set(key, structuredClone(record));
    return true;
  }
  entries(): UsageRecord[] { return structuredClone([...this.records.values()]); }
  totals() {
    const rows = this.entries();
    return { operations: rows.length, logicalTokens: sumKnown(rows.map(r => r.usage.logicalTokens)),
      input: sumKnown(rows.map(r => r.usage.input)), cacheRead: sumKnown(rows.map(r => r.usage.cacheRead)),
      cacheWrite: sumKnown(rows.map(r => r.usage.cacheWrite)), output: sumKnown(rows.map(r => r.usage.output)),
      billedCost: sumKnown(rows.map(r => r.billedCost)), wallMs: sumKnown(rows.map(r => r.wallMs)) };
  }
}
