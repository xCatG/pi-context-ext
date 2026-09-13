import { describe, test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { SessionManager, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createFixture } from './fixtures/native-session.ts';

describe('public session ancestry and tool lifecycle', () => {
  test('fork at source excludes its later index without losing exact source', async () => {
    const f = await createFixture(() => {}, { persistent: true, responses: [
      fauxAssistantMessage('first reply'), fauxAssistantMessage('continued reply'),
    ] });
    try {
      await f.session.prompt('exact source before index');
      const source = f.sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'user')!;
      f.sessionManager.appendCustomEntry('qualification-index', { source: source.id });
      const path = f.sessionManager.createBranchedSession(source.id)!;
      // Pi defers writing a branch with no assistant until its first response.
      expect(existsSync(path)).toBe(false);
      expect(f.sessionManager.getBranch().at(-1)?.id).toBe(source.id);
      expect(f.sessionManager.getBranch().some(e => e.type === 'custom')).toBe(false);
      await f.session.prompt('continue branch');
      const reopened = SessionManager.open(path);
      expect(reopened.getBranch().map(e => e.id)).toContain(source.id);
      expect(JSON.stringify(reopened.getBranch())).toContain('exact source before index');
      expect(reopened.getBranch().some(e => e.type === 'custom')).toBe(false);
    } finally { f.session.dispose(); }
  });

  test('native tree navigation excludes abandoned custom claims from active ancestry', async () => {
    const f = await createFixture(() => {}, { persistent: true, responses: [
      fauxAssistantMessage('first reply'), fauxAssistantMessage('second reply'),
    ] });
    try {
      await f.session.prompt('first request');
      const target = f.sessionManager.getLeafId()!;
      const claim = f.sessionManager.appendCustomEntry('qualification-claim', { text: 'abandoned diagnosis' });
      await f.session.prompt('second request');
      const result = await f.session.navigateTree(target, { summarize: false });
      expect(result.cancelled).toBe(false);
      expect(f.sessionManager.getBranch().map(e => e.id)).not.toContain(claim);
      expect(f.sessionManager.getEntries().map(e => e.id)).toContain(claim);
    } finally { f.session.dispose(); }
  });

  test('ephemeral native history explicitly reports unavailable persistence', async () => {
    const f = await createFixture(() => {});
    try {
      await f.session.prompt('ephemeral source');
      expect(f.sessionManager.isPersisted()).toBe(false);
      expect(f.sessionManager.getSessionFile()).toBeUndefined();
      expect(f.sessionManager.createBranchedSession(f.sessionManager.getLeafId()!)).toBeUndefined();
    } finally { f.session.dispose(); }
  });

  test('public active tools remove and reactivate an extension tool preserving native read', async () => {
    let api: ExtensionAPI | undefined;
    const f = await createFixture(pi => {
      api = pi;
      pi.registerTool({ name: 'qualification_tool', label: 'qualification tool',
        description: 'Provider-free qualification', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
      });
    }, { tools: ['read', 'qualification_tool'] });
    try {
      // Explicit SDK tool allowlist must include extension tools too.
      api!.setActiveTools([...api!.getActiveTools(), 'qualification_tool']);
      expect(api!.getActiveTools()).toContain('qualification_tool');
      api!.setActiveTools(api!.getActiveTools().filter(name => name !== 'qualification_tool'));
      expect(api!.getActiveTools()).not.toContain('qualification_tool');
      expect(api!.getActiveTools()).toContain('read');
      api!.setActiveTools([...api!.getActiveTools(), 'qualification_tool']);
      expect(api!.getActiveTools()).toContain('qualification_tool');
    } finally { f.session.dispose(); }
  });
});
