import { expect, test } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import contextExtension from '../src/index.ts';
import { createFixture } from './fixtures/native-session.ts';

test('opaque provider signatures do not prevent the next ordinary coding turn', async () => {
  // A metadata-heavy assistant response reproduced the measured admission aborts.
  // The signature must still reach the provider intact for native continuation.
  const signature = 'opaque-provider-state'.repeat(12000);
  const f = await createFixture(contextExtension, { persistent: true, responses: [
    fauxAssistantMessage([{ type: 'thinking', thinking: 'Inspect the current file next.', thinkingSignature: signature },
      { type: 'text', text: 'Ready to inspect.' }]),
    fauxAssistantMessage('Continuing with the original constraint.'),
  ] });
  try {
    await f.session.prompt('Preserve the exported API.');
    await f.session.prompt('Continue the task.');
    expect(f.captured).toHaveLength(2);
    expect(f.errors).toEqual([]);
    const previous = f.captured[1].messages.find(m => m.role === 'assistant');
    expect(previous?.content).toContainEqual({ type: 'thinking', thinking: 'Inspect the current file next.', thinkingSignature: signature });
    expect(JSON.stringify(f.captured[1].messages)).toContain('Preserve the exported API.');
  } finally { f.session.dispose(); }
});

test('large actual assistant text still triggers capacity protection', async () => {
  const f = await createFixture(contextExtension, { responses: [
    fauxAssistantMessage('actual source content '.repeat(12000)), fauxAssistantMessage('must not dispatch'),
  ] });
  try {
    await f.session.prompt('Preserve this constraint.');
    await f.session.prompt('Continue.');
    expect(f.captured).toHaveLength(1);
    expect(f.errors.some(e => e.includes('context-capacity-blocked'))).toBe(true);
  } finally { f.session.dispose(); }
});
