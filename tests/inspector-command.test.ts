import { expect, test } from 'vitest';
import contextExtension from '../src/index.ts';
import { createFixture } from './fixtures/native-session.ts';

test.each(['/context', '/context json'])('%s does not persist a missing derived index', async command => {
  const f = await createFixture(contextExtension, { persistent: true });
  try {
    f.sessionManager.appendMessage({ role: 'user', content: 'A new source that has no derived index yet.', timestamp: 1 });
    const before = JSON.stringify(f.sessionManager.getEntries());
    await f.session.prompt(command);
    expect(JSON.stringify(f.sessionManager.getEntries())).toBe(before);
    expect(f.captured).toHaveLength(0);
  } finally { f.session.dispose(); }
});

test('inspection distinguishes absent, stale and disabled projection state', async () => {
  const f = await createFixture(contextExtension);
  const notifications: string[] = [];
  try {
    await f.session.bindExtensions({ mode: 'print', uiContext: { notify: (text: string) => notifications.push(text) } as any });
    await f.session.prompt('/context json');
    expect(JSON.parse(notifications.at(-1)!).projection.status).toBe('none');
    await f.session.prompt('Keep this task constraint.');
    await f.session.prompt('/context json');
    expect(JSON.parse(notifications.at(-1)!).projection.status).toBe('stale');
    await f.session.prompt('/context mode off');
    await f.session.prompt('/context json');
    const disabled = JSON.parse(notifications.at(-1)!);
    expect(disabled.projection.status).toBe('disabled');
    expect(disabled.budget).toBeUndefined();
    expect(disabled.omittedIds).toEqual([]);
  } finally { f.session.dispose(); }
});
