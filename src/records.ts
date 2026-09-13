export type Mode = 'off' | 'organized';
export type Health = 'ready' | 'degraded' | 'context-capacity-blocked';
export interface RecordDataMap {
  user_source: { entryId: string; text: string; origin: 'interactive' | 'rpc' | 'extension' | 'unknown'; sourceSessionId?: string };
  intent: { text: string; sourceId: string; author: 'user' | 'model'; pinned: boolean };
  observation: { entryId: string; toolCallId: string; toolName: string; digest: string; partial: boolean; outcome: 'success' | 'error' | 'unknown'; path?: string; sourceSessionId?: string };
  claim: { text: string; status: 'hypothesis' | 'conclusion' | 'uncertain'; evidenceIds: string[]; counterEvidenceIds: string[]; supersedes?: string; reason?: string };
  work: { text: string; status: 'open' | 'done' | 'withdrawn'; supersedes?: string; reason?: string };
  lifecycle: { event: string; details?: Record<string, unknown> };
}
export type RecordEnvelope = { [K in keyof RecordDataMap]: { schemaVersion: 1; id: string; anchor: string; kind: K; data: RecordDataMap[K] } }[keyof RecordDataMap];
export type ContextRecord = RecordEnvelope;
export interface Diagnostic { code: string; recordId?: string; message: string }
export interface RebuiltState {
  records: RecordEnvelope[];
  diagnostics: Diagnostic[];
  health: Health;
  openWorkIds: string[];
  activeClaimIds: string[];
  conflictIds: string[];
  claimStateAvailable: boolean;
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const text = (v: unknown) => typeof v === 'string';
const ids = (v: unknown) => Array.isArray(v) && v.every(id);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));

export function validateRecord(value: unknown): { ok: true; record: RecordEnvelope } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!object(value) || value.schemaVersion !== 1 || !id(value.id) || !id(value.anchor) || !keys(value, ['schemaVersion', 'id', 'anchor', 'kind', 'data']) || !object(value.data)) return fail('Invalid record envelope or unsupported schema version');
  const d = value.data;
  let valid = false;
  switch (value.kind) {
    case 'user_source': valid = keys(d, ['entryId', 'text', 'origin', 'sourceSessionId']) && id(d.entryId) && text(d.text) && typeof d.origin === 'string' && ['interactive', 'rpc', 'extension', 'unknown'].includes(d.origin) && (d.sourceSessionId === undefined || id(d.sourceSessionId)); break;
    case 'intent': valid = keys(d, ['text', 'sourceId', 'author', 'pinned']) && text(d.text) && id(d.sourceId) && typeof d.author === 'string' && ['user', 'model'].includes(d.author) && typeof d.pinned === 'boolean' && !(d.author === 'model' && d.pinned); break;
    case 'observation': valid = keys(d, ['entryId', 'toolCallId', 'toolName', 'digest', 'partial', 'outcome', 'path', 'sourceSessionId']) && id(d.entryId) && id(d.toolCallId) && id(d.toolName) && id(d.digest) && typeof d.partial === 'boolean' && typeof d.outcome === 'string' && ['success', 'error', 'unknown'].includes(d.outcome) && (d.path === undefined || text(d.path)) && (d.sourceSessionId === undefined || id(d.sourceSessionId)); break;
    case 'claim':
    case 'work': {
      const claim = value.kind === 'claim';
      valid = keys(d, ['text', 'status', 'supersedes', 'reason', ...(claim ? ['evidenceIds', 'counterEvidenceIds'] : [])]) && text(d.text) && typeof d.status === 'string' && (claim ? ['hypothesis', 'conclusion', 'uncertain'] : ['open', 'done', 'withdrawn']).includes(d.status) && (!claim || (ids(d.evidenceIds) && ids(d.counterEvidenceIds))) && (d.supersedes === undefined || (id(d.supersedes) && id(d.reason))) && (d.reason === undefined || id(d.reason));
      break;
    }
    case 'lifecycle': valid = keys(d, ['event', 'details']) && id(d.event) && (d.details === undefined || object(d.details)); break;
  }
  return valid ? { ok: true, record: value as RecordEnvelope } : fail('Invalid kind-specific data');
}

// Object key order does not change the identity of a persisted JSON record.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function rebuild(input: readonly unknown[], activeEntryIds: ReadonlySet<string>): RebuiltState {
  const records = new Map<string, RecordEnvelope>();
  const fingerprints = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  const conflicts = new Set<string>();
  const links = new Map<string, Set<string>>();
  const superseded = new Set<string>();
  let claimStateAvailable = true;
  const diagnose = (code: string, recordId: string | undefined, message: string) => diagnostics.push({ code, recordId, message });
  const link = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b); links.get(b)!.add(a);
  };
  for (const raw of input) {
    const parsed = validateRecord(raw);
    // Invalid payloads must not hide their revision targets behind a bogus anchor.
    // Callers pass records from active native containers; valid other-branch
    // records remain excluded by the pure reducer's ancestry contract.
    if (parsed.ok && !activeEntryIds.has(parsed.record.anchor)) continue;
    const recordId = object(raw) && id(raw.id) ? raw.id : undefined;
    const target = object(raw) && object(raw.data) && id(raw.data.supersedes) ? raw.data.supersedes : undefined;
    if (target) {
      superseded.add(target);
      if (recordId) link(recordId, target);
    }
    if (!parsed.ok) {
      diagnose('invalid-record', recordId, parsed.error);
      if (recordId) conflicts.add(recordId);
      if (target) conflicts.add(target);
      else if (!object(raw) || !['user_source', 'intent', 'observation', 'work', 'lifecycle'].includes(String(raw.kind))) claimStateAvailable = false;
      continue;
    }
    const r = parsed.record;
    const fingerprint = canonical(r);
    if (fingerprints.has(r.id)) {
      if (fingerprints.get(r.id) !== fingerprint) {
        diagnose('conflicting-duplicate', r.id, 'Same ID has different content');
        conflicts.add(r.id);
      }
      continue;
    }
    fingerprints.set(r.id, fingerprint);
    records.set(r.id, r);
  }
  const revisions = new Map<string, string[]>();
  for (const r of records.values()) {
    if (r.kind === 'intent') {
      const source = records.get(r.data.sourceId);
      if (source?.kind !== 'user_source') {
        diagnose('unknown-source', r.id, 'Intent source is unavailable'); conflicts.add(r.id);
      } else if (r.data.author === 'user' && (!r.data.pinned || r.data.text !== source.data.text ||
          r.id !== `pin:${source.id}` || r.anchor !== source.anchor)) {
        diagnose('invalid-user-pin', r.id, 'User pins must preserve the exact attributed native source with canonical identity');
        conflicts.add(r.id);
      }
    }
    if (r.kind !== 'claim' && r.kind !== 'work') continue;
    if (r.kind === 'claim' && [...r.data.evidenceIds, ...r.data.counterEvidenceIds].some(e => !records.has(e))) {
      diagnose('unknown-evidence', r.id, 'Claim evidence is unavailable'); conflicts.add(r.id);
    }
    const target = r.data.supersedes;
    if (!target) continue;
    const prior = records.get(target);
    if (!prior || prior.kind !== r.kind) {
      diagnose('invalid-target', r.id, 'Supersession target is missing or has another kind'); conflicts.add(r.id); conflicts.add(target);
    }
    const siblings = revisions.get(target) ?? [];
    siblings.push(r.id); revisions.set(target, siblings);
    const seen = new Set<string>([r.id]);
    let current: RecordEnvelope | undefined = prior;
    while (current && (current.kind === 'claim' || current.kind === 'work')) {
      if (seen.has(current.id)) { diagnose('revision-cycle', r.id, 'Supersession cycle'); conflicts.add(r.id); break; }
      seen.add(current.id);
      current = current.data.supersedes ? records.get(current.data.supersedes) : undefined;
    }
  }
  for (const [target, siblings] of revisions) if (siblings.length > 1) {
    diagnose('conflicting-revisions', target, 'Multiple revisions supersede one target'); conflicts.add(target);
  }
  // Quarantine the entire affected revision chain; never revive a predecessor.
  if (!claimStateAvailable) conflicts.add('claim-state-unavailable');
  const queue = [...conflicts];
  for (let i = 0; i < queue.length; i++) for (const neighbor of links.get(queue[i]) ?? []) if (!conflicts.has(neighbor)) { conflicts.add(neighbor); queue.push(neighbor); }
  const all = [...records.values()];
  return {
    records: all, diagnostics, health: diagnostics.length ? 'degraded' : 'ready',
    openWorkIds: all.filter(r => r.kind === 'work' && r.data.status === 'open' && (!superseded.has(r.id) || conflicts.has(r.id))).map(r => r.id),
    activeClaimIds: claimStateAvailable ? all.filter(r => r.kind === 'claim' && !superseded.has(r.id) && !conflicts.has(r.id)).map(r => r.id) : [],
    conflictIds: [...conflicts], claimStateAvailable,
  };
}
