import { expect, test, vi } from 'vitest';
import { buildInspectorLines, showInspector } from '../src/inspector.ts';
import { rebuild, type RecordEnvelope } from '../src/records.ts';
import { visibleWidth } from '@earendil-works/pi-tui';

const state = () => rebuild([
  { schemaVersion: 1, id: 'source', anchor: 'u1', kind: 'user_source', data: { entryId: 'u1', origin: 'rpc', text: 'Keep runtime unchanged\x1b[2J\x1b]52;c;evil\x07\r\b' } },
  { schemaVersion: 1, id: 'obs', anchor: 't1', kind: 'observation', data: { entryId: 't1', toolCallId: 'call', toolName: 'read', path: 'src/a.ts', digest: 'hash', partial: true, outcome: 'success' } },
  { schemaVersion: 1, id: 'claim', anchor: 'u1', kind: 'claim', data: { text: 'Possible diagnosis', status: 'hypothesis', evidenceIds: ['obs'], counterEvidenceIds: [] } },
  { schemaVersion: 1, id: 'work', anchor: 'u1', kind: 'work', data: { text: 'Verify behavior', status: 'open' } },
] as RecordEnvelope[], new Set(['u1', 't1']));
const options = { mode: 'organized', sessionId: 'session', omittedIds: ['obs'], budget: { nativeTokens: 10 }, projection: { status: 'active' as const, requestId: 'request-1' }, recent: [{ id: 'a1', text: 'Historical conclusion\u202eevil' }] };

test('inspector exposes provenance, selection and uncertainty without changing durable records', () => {
  const s = state(), before = JSON.stringify(s);
  const lines = buildInspectorLines(s, options), text = lines.join('\n');
  expect(text).toContain('u1');
  expect(text).toContain('src/a.ts');
  expect(text).toContain('partial');
  expect(text).toContain('hypothesis');
  expect(text).toContain('omitted');
  expect(text).toContain('not semantic verification');
  expect(text).toContain('Historical');
  expect(lines.every(line => !/[\x00-\x1f\x7f-\x9f\u202a-\u202e]/u.test(line))).toBe(true);
  expect(JSON.stringify(s)).toBe(before);
  expect(lines.length).toBeLessThanOrEqual(500);
});

test('headless inspector returns bounded structured notification without opening custom UI', async () => {
  const notify = vi.fn(), custom = vi.fn();
  await showInspector({ hasUI: false, ui: { notify, custom } } as any, ['source\x1b[2J', '界'.repeat(2000)]);
  expect(custom).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledOnce();
  const text = notify.mock.calls[0][0];
  expect(() => JSON.parse(text)).not.toThrow();
  expect(text).not.toContain('\x1b');
  expect(text.length).toBeLessThan(100000);
});

test('RPC with hasUI never invokes a TUI custom component', async () => {
  const notify = vi.fn(), custom = vi.fn();
  await showInspector({ mode: 'rpc', hasUI: true, ui: { notify, custom } } as any, ['snapshot']);
  expect(custom).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledOnce();
});

test('large evidence section cannot hide work, conflicts, budget or recent conversation', () => {
  const s = state();
  for (let i = 0; i < 250; i++) s.records.push({ ...s.records[1], id: `obs-${i}` } as RecordEnvelope);
  s.conflictIds = ['disputed'];
  const text = buildInspectorLines(s, options).join('\n');
  for (const value of ['Verify behavior', 'disputed', 'Last projection admission diagnostics', 'Historical conclusion', 'omitted from preview', 'persistence=unknown', 'indexed active-branch']) expect(text).toContain(value);
  expect(text).not.toContain('durable active-branch');
});

test('pins, revisions, conflicts and unknown operations remain explicit in bounded previews', () => {
  const s = state();
  s.records.push(
    { schemaVersion: 1, id: 'pin:source', anchor: 'u1', kind: 'intent', data: { text: 'Constraint', sourceId: 'source', author: 'user', pinned: true } },
    { schemaVersion: 1, id: 'revision', anchor: 'u1', kind: 'claim', data: { text: 'Corrected interpretation', status: 'uncertain', evidenceIds: [], counterEvidenceIds: ['obs'], supersedes: 'claim', reason: 'Contrary result' } },
    { schemaVersion: 1, id: 'pending', anchor: 'u1', kind: 'lifecycle', data: { event: 'unknown-operation', details: { operation: 'unsettled read' } } },
  );
  s.conflictIds = ['revision'];
  const text = buildInspectorLines(s, options).join('\n');
  for (const value of ['Pin pin:source', 'uncertain', 'supersedes=claim', 'counterevidence=obs', 'Unknown operation pending', 'Conflict: revision']) expect(text).toContain(value);
  const many = buildInspectorLines(s, { ...options, recent: Array.from({ length: 600 }, (_, i) => ({ id: String(i), text: '界'.repeat(300) })) });
  expect(many.length).toBeLessThanOrEqual(500);
  expect(many.every(line => visibleWidth(line) <= 160)).toBe(true);
  expect(many.join('\n')).toContain('omitted from preview');
});

test('custom inspector bounds scrolling, redraws and closes with q or Escape', async () => {
  for (const close of ['q', '\x1b']) {
    const done = vi.fn(), requestRender = vi.fn();
    let component: any;
    const custom = vi.fn(async factory => { component = factory({ terminal: { rows: 8 }, requestRender }, {}, {}, done); });
    await showInspector({ mode: 'tui', hasUI: true, ui: { custom } } as any, Array.from({ length: 30 }, (_, i) => `row${i}`));
    const first = component.render(16);
    for (let i = 0; i < 40; i++) component.handleInput('\x1b[6~');
    const last = component.render(16);
    expect(last.join(' ')).toContain('row29');
    expect(last.length).toBeLessThanOrEqual(8);
    expect(last.every((l: string) => visibleWidth(l) <= 16)).toBe(true);
    for (let i = 0; i < 40; i++) component.handleInput('\x1b[5~');
    expect(component.render(16)).toEqual(first);
    component.handleInput(close);
    expect(done).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalled();
  }
});

test('bounded sections prioritize current records and disclose exact preview omissions', () => {
  const s = state();
  for (let i = 0; i < 100; i++) {
    s.records.push(
      { schemaVersion: 1, id: `source-${i}`, anchor: 'u1', kind: 'user_source', data: { entryId: `u-${i}`, text: `Constraint ${i}`, origin: 'rpc' } },
      { schemaVersion: 1, id: `claim-${i}`, anchor: 'u1', kind: 'claim', data: { text: `Diagnosis ${i}`, status: 'hypothesis', evidenceIds: [], counterEvidenceIds: [] } },
      { schemaVersion: 1, id: `work-${i}`, anchor: 'u1', kind: 'work', data: { text: `Task ${i}`, status: 'done' } },
      { schemaVersion: 1, id: `unknown-${i}`, anchor: 'u1', kind: 'lifecycle', data: { event: 'unknown-operation' } },
    );
    s.diagnostics.push({ code: `diagnostic-${i}`, message: `Problem ${i}` });
  }
  s.activeClaimIds = ['claim-99'];
  s.conflictIds = ['claim-98', 'work-98'];
  const lines = buildInspectorLines(s, options), text = lines.join('\n');
  for (const expected of ['Source source |', 'Constraint 99', 'Diagnosis 99', 'Diagnosis 98', 'Verify behavior', 'Task 98', 'Unknown operation unknown-99', 'diagnostic-99', 'Conflict: claim-98', 'Conflict: work-98']) expect(text).toContain(expected);
  const goals = text.split('--- Goals and user pins ---')[1].split('--- Evidence')[0];
  expect(goals).toContain('42 lines omitted from preview');
  expect(text).not.toContain('exact records remain retrievable');
  expect(text).toContain('Source/observation native entry IDs');
  expect(text).toContain('Inspect native session records for model claims, intents, work and lifecycle data.');
  expect(lines.length).toBeLessThanOrEqual(500);
});

test.each(['none', 'stale', 'disabled'] as const)('projection %s cannot advertise current selection', status => {
  const text = buildInspectorLines(state(), { ...options, projection: { status, requestId: 'old-request' } }).join('\n');
  expect(text).not.toContain('omitted from selection');
  expect(text).not.toContain('selected candidate');
  expect(text).not.toContain('omitted: obs');
  expect(text).toContain(status === 'disabled' ? 'Selection disabled' : 'Selection unknown');
  if (status === 'stale') {
    expect(text).toContain('last snapshot');
    expect(text).toContain('Last projection admission diagnostics');
  } else expect(text).not.toContain('nativeTokens');
});

test('missing projection metadata means selection unknown; active snapshot is attributed', () => {
  const unknown = buildInspectorLines(state(), { ...options, projection: undefined }).join('\n');
  expect(unknown).toContain('Selection unknown');
  expect(unknown).not.toContain('nativeTokens');
  const active = buildInspectorLines(state(), options).join('\n');
  expect(active).toContain('omitted from selection');
  expect(active).toContain('request-1');
});

test('conflict and diagnostic floods retain both categories without truncating an ID list', () => {
  const s = state();
  s.conflictIds = Array.from({ length: 90 }, (_, i) => `conflicted-record-${i}`);
  s.diagnostics = Array.from({ length: 80 }, (_, i) => ({ code: `issue-${i}`, message: `Details ${i}` }));
  const lines = buildInspectorLines(s, options);
  const start = lines.indexOf('--- Conflicts and diagnostics ---');
  const end = lines.indexOf('--- Selection versus indexed active-branch records ---');
  const section = lines.slice(start, end);
  expect(section).toHaveLength(61);
  expect(section).toContain('Conflict: conflicted-record-89');
  expect(section).toContain('Diagnostic issue-79 : Details 79');
  expect(section[60]).toContain('112 lines omitted from preview');
  expect(section.filter(line => line.startsWith('Conflict: '))).toHaveLength(29);
});
