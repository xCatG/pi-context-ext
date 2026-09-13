import test from 'node:test';
import assert from 'node:assert/strict';
import { count, defaults, prune, visible } from './prune.mjs';

const text = 'const value = 17;\n'.repeat(500);
const aggressive = { chunkTokens: 1, keepTokens: 0 };
function fixture(specs) {
  const branchEntries = [];
  const add = message => branchEntries.push({ type: 'message', id: `entry-${branchEntries.length}`,
    parentId: branchEntries.at(-1)?.id ?? null, timestamp: 'now', message });
  add({ role: 'user', content: 'Fix this.', timestamp: 0 });
  for (const [args = { path: '/task/a' }, body = text, extra = {}] of specs) {
    const id = `call-${branchEntries.length}`;
    add({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: args }], timestamp: 0 });
    add({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: body }], isError: false, timestamp: 0, ...extra });
  }
  return { branchEntries, messages: branchEntries.map(e => e.message), leafId: branchEntries.at(-1).id };
}

test('frozen 8k/4k policy actually replaces duplicate reads without changing raw history or pairing', () => {
  assert.deepEqual(defaults, { chunkTokens: 8000, keepTokens: 4000 });
  const input = fixture(Array.from({ length: 8 }, () => [])), before = JSON.stringify(input);
  const result = prune(input);
  assert.ok(result.replacements.length > 0);
  assert.ok(count(result.messages) < count(input.messages));
  assert.equal(JSON.stringify(input), before);
  for (let i = 0; i < input.messages.length; i++) {
    const old = input.messages[i], next = result.messages[i];
    if (old.content !== next.content) {
      assert.equal(old.role, 'toolResult');
      assert.deepEqual({ ...next, content: old.content }, old);
    } else assert.equal(next, old);
  }
});

test('every replacement points directly to the final retained matching read through the boundary', () => {
  const input = fixture([[], [], []]), result = prune(input, aggressive);
  assert.equal(result.replacements.length, 2);
  const last = input.messages.at(-1);
  for (const replacement of result.replacements) {
    assert.equal(replacement.witness, last.toolCallId);
    assert.ok(!result.replacements.some(r => r.toolCallId === replacement.witness));
  }
  assert.equal(result.messages.at(-1), last);
});

test('partial, failed, truncated, image, changed-version and different-path reads never qualify', () => {
  const variants = [
    [{ path: '/task/a', offset: 1 }], [{ path: '/task/a', limit: 9999 }],
    [{ path: '/task/a' }, text, { isError: true }],
    [{ path: '/task/a' }, text, { details: { truncation: { truncated: true } } }],
    [{ path: '/task/a' }, text, { details: { truncation: { firstLineExceedsLimit: true } } }],
    [{ path: '/task/a' }, text + '\n[Showing lines 1-2 of 3. Use offset=3 to continue.]'],
    [{ path: '/task/a' }, text + '\n[42 more lines in file. Use offset=3 to continue.]'],
    [{ path: '/task/a' }, '[Line 1 is 80KB, exceeds 50KB limit. Use bash: ...]'],
    [{ path: '/task/a' }, 'Read image file [image/png]'],
    [{ path: '/task/a' }, text + 'changed'], [{ path: '/task/b' }],
  ];
  for (const variant of variants) {
    assert.equal(prune(fixture([[], variant]), aggressive).replacements.length, 0);
    assert.equal(prune(fixture([variant, []]), aggressive).replacements.length, 0);
    if (!variant[1]?.endsWith('changed') && variant[0]?.path !== '/task/b')
      assert.equal(prune(fixture([variant, variant]), aggressive).replacements.length, 0);
  }
});

test('explicit leaf ancestry rejects sibling witnesses, including sibling compaction entries', () => {
  const input = fixture([[], []]);
  input.branchEntries[3].parentId = input.branchEntries[0].id;
  assert.equal(prune(input, aggressive).replacements.length, 0);
  const prior = input.branchEntries[2].id;
  input.branchEntries.push({ type: 'compaction', id: 'sibling-compaction', parentId: input.leafId, summary: 'sibling' });
  const fork = { ...input, leafId: prior, messages: input.messages.slice(0, 3) };
  assert.equal(prune(fork, aggressive).replacements.length, 0);
  assert.deepEqual(prune(fork, aggressive), prune({ ...fork, branchEntries: fork.branchEntries.slice(0, 3) }, aggressive));
  assert.equal(prune({ ...input, leafId: 'unknown' }, aggressive).replacements.length, 0);
});

test('compacted-away witnesses are unavailable and only current context drives chunk scheduling', () => {
  const input = fixture([[], [], []]);
  const compacted = { ...input, messages: [{ role: 'user', content: 'Native compaction summary', timestamp: 0 }, ...input.messages.slice(-2)] };
  assert.equal(prune(compacted, aggressive).replacements.length, 0);
  assert.equal(prune(compacted).boundaryId, null);
  const retained = { ...input, messages: [{ role: 'user', content: 'Native compaction summary', timestamp: 0 }, ...input.messages.slice(-4)] };
  assert.equal(prune(retained, aggressive).replacements.length, 1);
  assert.equal(prune(retained, aggressive).replacements[0].witness, input.messages.at(-1).toolCallId);
});

test('restart is deterministic, every prefix is nonexpanding and decisions are stable inside a boundary', () => {
  const input = fixture(Array.from({ length: 12 }, () => []));
  let previous;
  for (let i = 1; i <= input.branchEntries.length; i++) {
    const prefix = { branchEntries: input.branchEntries.slice(0, i), messages: input.messages.slice(0, i), leafId: input.branchEntries[i - 1].id };
    const result = prune(prefix);
    assert.deepEqual(result, prune(JSON.parse(JSON.stringify(prefix))));
    assert.ok(count(result.messages) <= count(prefix.messages));
    if (previous?.boundaryId === result.boundaryId) assert.deepEqual(previous.replacements, result.replacements);
    previous = result;
  }
  assert.equal(prune(input, { chunkTokens: 1, keepTokens: 1e9 }).replacements.length, 0);
  assert.equal(prune(fixture([[{}, 'x'], [{}, 'x']]), aggressive).replacements.length, 0);
  assert.equal(prune(fixture([[{ path: '/task/a' }, 'x'], [{ path: '/task/a' }, 'x']]), aggressive).replacements.length, 0);
});

test('a visible result without an unambiguous active call is not eligible', () => {
  const input = fixture([[], []]);
  input.branchEntries[1].message.content[0].name = 'bash';
  assert.equal(prune(input, aggressive).replacements.length, 0);
});

test('context extension registers only its transform and preserves current native summary/messages', async () => {
  const { default: extension } = await import('./extension.ts');
  const handlers = [];
  extension({ on: (name, handler) => handlers.push({ name, handler }) });
  assert.deepEqual(handlers.map(h => h.name), ['context']);
  const input = fixture(Array.from({ length: 8 }, () => []));
  const ctx = { sessionManager: { getBranch: () => input.branchEntries, getLeafId: () => input.leafId } };
  const { messages } = handlers[0].handler({ messages: input.messages }, ctx);
  assert.ok(count(messages) < count(input.messages));
  const summary = { role: 'compactionSummary', summary: 'Native summary preserved', timestamp: 0 };
  const compacted = [summary, ...input.messages.slice(-2)];
  assert.deepEqual(handlers[0].handler({ messages: compacted }, ctx).messages, compacted);
});

test('native summary and bash text participate in the visible proxy without replacing them', () => {
  const summary = { role: 'compactionSummary', summary: text, timestamp: 0 };
  assert.equal(visible(summary).summary, text);
  assert.ok(count([summary]) > 1000);
  const input = fixture([[], []]);
  const first = prune({ ...input, messages: [summary, ...input.messages] }, aggressive);
  const second = prune({ ...input, messages: [{ ...summary, summary: text + 'changed' }, ...input.messages] }, aggressive);
  assert.notEqual(first.boundaryId, second.boundaryId);
  const bash = { role: 'bashExecution', command: 'cat a', output: text, exitCode: 0 };
  assert.equal(visible(bash).output, text);
  assert.ok(count([bash]) > 1000);
});
