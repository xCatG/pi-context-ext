import { expect, test } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import contextExtension, { RECORD_TYPE } from '../src/index.ts';
import { deriveObservationKey } from '../src/capture.ts';
import { createFixture } from './fixtures/native-session.ts';

const tools = ['read', 'context_checkpoint'];
const records = (f: any): any[] => f.sessionManager.getBranch().flatMap((e: any) => e.type === 'custom' && e.customType === RECORD_TYPE ? e.data.records : []);
const projection = (f: any) => {
  const messages = f.captured.at(-1).messages;
  return messages.map((m: any) => { try { return JSON.parse(typeof m.content === 'string' ? m.content : m.content?.find((b: any) => b.type === 'text')?.text); } catch { return null; } }).find((m: any) => m?.type === 'pi-context projection');
};

test.each(['native', 'source'])('considered %s IDs survive replay and omit only the considered later source', async form => {
  let consideredId = '';
  const args = () => ({ requestId: 'considered', consideredIds: [consideredId], work: [{ text: 'Retest compatibility', status: 'open' }] });
  const f = await createFixture(contextExtension, { persistent: true, tools, responses: [
    fauxAssistantMessage('first'), fauxAssistantMessage('second'),
    () => fauxAssistantMessage(fauxToolCall('context_checkpoint', args(), { id: 'cp' })), fauxAssistantMessage('recorded ' + 'history '.repeat(200)),
    fauxAssistantMessage('Compaction summary: preserve open compatibility work and original constraints.'),
    fauxAssistantMessage('Turn prefix: checkpoint recorded the considered source; compatibility work remains open.'),
  ] });
  let path = '';
  try {
    await f.session.prompt('Initial constraint');
    await f.session.prompt('Later considered constraint');
    const user = f.sessionManager.getBranch().findLast(e => e.type === 'message' && e.message.role === 'user')!;
    consideredId = form === 'native' ? user.id : deriveObservationKey(f.sessionManager.getSessionId(), user.id, 'user_source');
    await f.session.prompt('Another still unresolved constraint');
    expect(records(f).find(r => r.id === 'checkpoint:considered:receipt')?.data.details.consideredIds).toEqual([consideredId]);
    expect(projection(f).userSources.map((r: any) => r.data.text)).toEqual(['Initial constraint', 'Another still unresolved constraint']);
    await f.session.compact();
    expect(f.sessionManager.getBranch().some(e => e.type === 'compaction')).toBe(true);
    path = f.sessionManager.getSessionFile()!;
  } finally { f.session.dispose(); }
  const next = await createFixture(contextExtension, { sessionFile: path, tools, responses: [
    () => fauxAssistantMessage(fauxToolCall('context_checkpoint', args(), { id: 'retry' })), fauxAssistantMessage('done'),
    () => fauxAssistantMessage(fauxToolCall('context_checkpoint', { ...args(), work: [] }, { id: 'changed' })), fauxAssistantMessage('rejected'),
  ] });
  try {
    await next.session.prompt('Restart');
    expect(records(next).filter(r => r.id === 'checkpoint:considered:receipt')).toHaveLength(1);
    expect(JSON.stringify(next.captured)).toContain('already-recorded');
    expect(projection(next).userSources.some((r: any) => r.data.text === 'Later considered constraint')).toBe(false);
    expect(projection(next).conflicts).toEqual([]);
    await next.session.prompt('Attempt changed successful request');
    expect(JSON.stringify(next.captured)).toContain('requestId already used for different content');
    expect(records(next).filter(r => r.id === 'checkpoint:considered:receipt')).toHaveLength(1);
  } finally { next.session.dispose(); }
});

test.each(['foreign', 'observation', 'status', 'pin'])('invalid %s checkpoint cannot partially append records', async kind => {
  let badId = 'foreign-session-id';
  const f = await createFixture(contextExtension, { tools, responses: [
    fauxAssistantMessage(fauxToolCall('read', { path: 'missing-file' }, { id: 'read' })), fauxAssistantMessage('read ended'),
    () => fauxAssistantMessage(fauxToolCall('context_checkpoint', {
      requestId: 'invalid', work: [{ text: 'Must not partially append', status: kind === 'status' ? 'proposed' : 'open' }],
      ...(kind === 'foreign' || kind === 'observation' ? { consideredIds: [badId] } : {}),
      ...(kind === 'pin' ? { intents: [{ text: 'Not approval', sourceId: badId, author: 'user', pinned: true }] } : {}),
    }, { id: 'invalid' })), fauxAssistantMessage('done'),
  ] });
  try {
    await f.session.prompt('Original instruction');
    if (kind === 'observation') badId = records(f).find(r => r.kind === 'observation').id;
    await f.session.prompt('Attempt invalid checkpoint');
    expect(records(f).some(r => r.id.startsWith('checkpoint:invalid:'))).toBe(false);
    if (kind === 'foreign' || kind === 'observation') expect(JSON.stringify(f.captured)).toContain('active user-source record ID or native user entry ID');
  } finally { f.session.dispose(); }
});
