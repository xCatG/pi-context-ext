import { describe, expect, it } from 'vitest';
import { rebuild, validateRecord } from '../src/records.js';

const active = new Set(['u1', 't1', 'c1']);
const rec = (id: string, kind: string, data: object, anchor = 'c1') => ({ schemaVersion: 1, id, anchor, kind, data });
const claim = (id: string, supersedes?: string) => rec(id, 'claim', { text: id, status: 'conclusion', evidenceIds: [], counterEvidenceIds: [], ...(supersedes ? { supersedes, reason: 'new evidence' } : {}) });

describe('record validation', () => {
  it('validates every source origin without granting acceptance', () => {
    for (const origin of ['interactive', 'rpc', 'extension', 'unknown']) expect(validateRecord(rec(origin, 'user_source', { entryId: 'u1', text: '', origin } )).ok).toBe(true);
    expect(validateRecord(rec('i', 'intent', { text: 'proposal', sourceId: 'u', author: 'model', pinned: false })).ok).toBe(true);
    for (const extra of [{ pinned: true }, { accepted: true }]) expect(validateRecord(rec('i', 'intent', { text: 'proposal', sourceId: 'u', author: 'model', pinned: false, ...extra })).ok).toBe(false);
  });
  it('rejects unknown versions, malformed data, and hidden observation revisions', () => {
    expect(validateRecord({ ...claim('A'), schemaVersion: 99 }).ok).toBe(false);
    expect(validateRecord(rec('a', 'claim', { text: 'x', status: 'conclusion', evidenceIds: 'x', counterEvidenceIds: [] })).ok).toBe(false);
    expect(validateRecord(rec('o', 'observation', { entryId: 't1', toolCallId: 'call', toolName: 'read', digest: 'abc', partial: true, outcome: 'success', supersedes: 'old' })).ok).toBe(false);
    expect(validateRecord(rec('A', 'claim', { ...claim('A').data, status: ['conclusion'] })).ok).toBe(false);
  });
});

describe('branch reconstruction', () => {
  it('revises only the target and filters abandoned branches', () => {
    expect(rebuild([claim('A'), claim('independent'), claim('replacement', 'A'), claim('abandoned', undefined)], new Set()).activeClaimIds).toEqual([]);
    expect(rebuild([claim('A'), claim('independent'), claim('replacement', 'A'), { ...claim('branch'), anchor: 'elsewhere' }], active).activeClaimIds).toEqual(['independent', 'replacement']);
  });
  it('is idempotent for identical IDs independent of property order', () => {
    const a = claim('A');
    expect(rebuild([a, { data: a.data, kind: a.kind, anchor: a.anchor, id: a.id, schemaVersion: 1 }], active)).toMatchObject({ health: 'ready', activeClaimIds: ['A'] });
  });
  it('never resurrects predecessors after an identifiable invalid revision', () => {
    const invalid = { ...claim('C', 'B'), schemaVersion: 99 };
    const result = rebuild([claim('A'), claim('B', 'A'), invalid, claim('independent')], active);
    expect(result.health).toBe('degraded');
    expect(result.activeClaimIds).toEqual(['independent']);
    expect(result.conflictIds).toEqual(expect.arrayContaining(['A', 'B']));
  });
  it('disables claim state when an invalid claim has an unidentifiable target', () => {
    expect(rebuild([claim('A'), rec('bad', 'claim', { supersedes: 42 })], active)).toMatchObject({ health: 'degraded', activeClaimIds: [], claimStateAvailable: false });
    expect(rebuild([claim('A'), null], active).conflictIds).toContain('claim-state-unavailable');
  });
  it('degrades conflicting duplicates, cycles, unknown targets, and sibling revisions', () => {
    for (const records of [
      [claim('A'), { ...claim('A'), data: { ...claim('A').data, text: 'different' } }],
      [claim('A', 'B'), claim('B', 'A')],
      [claim('A', 'missing')],
      [claim('A'), claim('B', 'A'), claim('C', 'A')],
    ]) {
      const result = rebuild(records, active);
      expect(result.health).toBe('degraded');
      expect(result.activeClaimIds).toEqual([]);
      expect(result.conflictIds.length).toBeGreaterThan(0);
    }
  });
  it('tracks explicit work completion independently and retains immutable observations', () => {
    const observation = rec('o', 'observation', { entryId: 't1', toolCallId: 'call', toolName: 'read', digest: 'abc', partial: true, outcome: 'success' });
    const result = rebuild([observation, rec('w', 'work', { text: 'verify', status: 'open' }), rec('w2', 'work', { text: 'verified', status: 'done', supersedes: 'w', reason: 'model reports completion' }), rec('pending', 'work', { text: 'next', status: 'open' })], active);
    expect(result.openWorkIds).toEqual(['pending']);
    expect(result.records).toContainEqual(observation);
    expect(result.health).toBe('ready');
  });
  it('conflicts missing evidence and cross-kind supersession', () => {
    expect(rebuild([rec('A', 'claim', { ...claim('A').data, evidenceIds: ['missing'] })], active).activeClaimIds).toEqual([]);
    expect(rebuild([rec('w', 'work', { text: 'task', status: 'open' }), claim('A', 'w')], active).health).toBe('degraded');
  });
});
