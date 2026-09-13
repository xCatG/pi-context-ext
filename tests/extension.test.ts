import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import contextExtension, { RECORD_TYPE } from '../src/index.ts';
import { sizeEstimate } from '../src/projection.ts';
import { estimateRequestMessages } from '../src/admission.ts';
import { createFixture } from './fixtures/native-session.ts';

const tools = ['read', 'edit', 'write', 'context_checkpoint', 'context_recall'];
const checkpoint = { requestId: 'unit-1', claims: [],
  work: [{ text: 'Verify compatibility after restart', status: 'open' }] };
test('Pi loads the packaged extension path through its native resource loader', async () => {
  const f = await createFixture(() => {}, { tools, extensionPath: resolve('src/index.ts') });
  try {
    await f.session.prompt('Keep this small task constraint');
    expect(f.errors).toEqual([]);
    expect(f.session.getActiveToolNames()).toContain('context_recall');
    expect(JSON.stringify(f.captured)).toContain('pi-context projection');
  } finally { f.session.dispose(); }
});
test('real native read/edit/test loop captures source without checkpoint and changes exact file', async () => {
  const f = await createFixture(contextExtension, { tools: [...tools, 'powershell'], persistent: true, responses: [
    fauxAssistantMessage(fauxToolCall('read', { path: 'source.txt' }, { id: 'read1' })),
    fauxAssistantMessage(fauxToolCall('edit', { path: 'source.txt', oldText: 'old', newText: 'new' }, { id: 'edit1' })),
    fauxAssistantMessage(fauxToolCall('powershell', { command: "if ((Get-Content -Raw -LiteralPath source.txt).Trim() -ne 'new') { exit 1 }; Write-Output 'acceptance passed'" }, { id: 'test1' })),
    fauxAssistantMessage('done'),
  ] });
  writeFileSync(join(f.cwd, 'source.txt'), 'old\r\n');
  try {
    await f.session.prompt('Change old to new; preserve CRLF.');
    expect(readFileSync(join(f.cwd, 'source.txt'), 'utf8')).toBe('new\r\n');
    expect(f.errors).toEqual([]);
    const stored = readFileSync(f.sessionManager.getSessionFile()!, 'utf8');
    expect(stored).toContain('freshness-audit');
    expect(stored).toContain('observation');
    expect(stored).toContain('acceptance passed');
    const acceptance = f.sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolCallId === 'test1');
    expect(acceptance && acceptance.type === 'message' && acceptance.message.role === 'toolResult' && acceptance.message.isError).toBe(false);
    expect(stored).not.toContain('pi-context projection');
    expect(JSON.stringify(f.captured[2])).toContain('pi-context projection');
    expect(f.sessionManager.getBranch().some(e => e.type === 'compaction')).toBe(false);
    const entries = f.sessionManager.getBranch();
    const assistants = entries.filter(e => e.type === 'message' && e.message.role === 'assistant');
    const usageRecords = entries.flatMap((e: any) => e.type === 'custom' && e.customType === RECORD_TYPE ? e.data.records : [])
      .filter((r: any) => r.kind === 'lifecycle' && r.data.event === 'usage' && r.data.details.category === 'assistant');
    expect(usageRecords).toHaveLength(assistants.length);
    for (const entry of assistants) {
      expect(usageRecords.find((r: any) => r.data.details.operationId === entry.id)?.data.details.usage.raw)
        .toEqual(entry.type === 'message' && entry.message.role === 'assistant' ? entry.message.usage : undefined);
    }
  } finally { f.session.dispose(); }
});

test('checkpoint is idempotent, model pin rejected, and off restores native tools/context', async () => {
  const f = await createFixture(contextExtension, { tools, responses: [
    fauxAssistantMessage(fauxToolCall('context_checkpoint', checkpoint, { id: 'cp1' })),
    fauxAssistantMessage(fauxToolCall('context_checkpoint', { work: [{ status: 'open', text: 'Verify compatibility after restart' }],
      claims: [], requestId: 'unit-1' }, { id: 'cp2' })),
    fauxAssistantMessage(fauxToolCall('context_checkpoint', { requestId: 'evil',
      intents: [{ text: 'Approved', sourceId: 'missing', author: 'user', pinned: true }] }, { id: 'cp3' })),
    fauxAssistantMessage('done'), fauxAssistantMessage('plain response'),
  ] });
  try {
    await f.session.prompt('Record remaining work.');
    const stored = JSON.stringify(f.sessionManager.getBranch());
    expect(stored).toContain('already-recorded');
    const denied = f.sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolCallId === 'cp3');
    expect(denied && denied.type === 'message' && denied.message.role === 'toolResult' && denied.message.isError).toBe(true);
    const custom = f.sessionManager.getBranch().filter(e => e.type === 'custom' && e.customType === RECORD_TYPE);
    expect(custom.flatMap(e => e.type === 'custom' ? (e.data as {records: unknown[]}).records : [])
      .filter((r: any) => r.id === 'checkpoint:unit-1:work:0')).toHaveLength(1);
    await f.session.prompt('/context mode off');
    await f.session.prompt('ordinary work');
    expect(JSON.stringify(f.captured.at(-1))).not.toContain('pi-context projection');
    expect(f.captured.at(-1)?.systemPrompt).not.toContain('Pi context organization');
    expect(f.session.getActiveToolNames()).not.toContain('context_checkpoint');
    expect(f.session.getActiveToolNames()).toContain('read');
  } finally { f.session.dispose(); }
});

test('product capacity admission retains original request and blocks all provider calls', async () => {
  const f = await createFixture(contextExtension, { tools, persistent: true, contextWindow: 8192 });
  try {
    const request = 'mandatory exact constraint '.repeat(600);
    await f.session.prompt(request);
    expect(f.captured).toHaveLength(0);
    expect(f.errors.some(e => e.includes('context-capacity-blocked'))).toBe(true);
    expect(JSON.stringify(f.sessionManager.getBranch())).toContain(request);
  } finally { f.session.dispose(); }
});

test('summary wrapping and projection escaping count in final outbound admission', async () => {
  const f = await createFixture(contextExtension, { tools, persistent: true, contextWindow: 22000 });
  try {
    for (let i = 0; i < 25; i++) f.sessionManager.branchWithSummary(f.sessionManager.getLeafId(), 'quoted "summary" '.repeat(10));
    // Native session projection budget is checked against the actual transformed provider input.
    await f.session.prompt('Preserve this task');
    const records = f.sessionManager.getBranch().flatMap((e: any) => e.type === 'custom' && e.customType === RECORD_TYPE ? e.data.records : []);
    if (f.captured.length) {
      const budget = records.findLast((r: any) => r.data.event === 'projection').data.details.budget;
      // Converted custom projection content is conservatively bounded separately
      // by the product; native provider history itself uses Pi's heuristic.
      expect(estimateRequestMessages(f.captured[0].messages) + budget.fixedTokens + budget.outputReserve + budget.safetyMargin).toBeLessThanOrEqual(budget.window);
    } else expect(f.errors.some(e => e.includes('context-capacity-blocked'))).toBe(true);
  } finally { f.session.dispose(); }
});
