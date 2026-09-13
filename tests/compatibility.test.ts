import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  SessionManager, SettingsManager, VERSION, type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createFixture } from './fixtures/native-session.ts';

describe('Pi 0.85.1 public-API qualification (no model inference)', () => {
  test('custom records persist while projections affect requests only', async () => {
    const fixture = await createFixture((pi) => {
      pi.on('session_start', () => pi.appendEntry('qualification', { text: 'record-only-sentinel' }));
      pi.on('context', (event) => ({ messages: [...event.messages, {
        role: 'custom', customType: 'qualification-projection',
        content: 'projection-only-sentinel', display: false, timestamp: Date.now(),
      }] }));
    }, { persistent: true });
    try {
      expect(VERSION).toBe('0.85.1');
      await fixture.session.prompt('original request');
      expect(fixture.captured).toHaveLength(1);
      expect(JSON.stringify(fixture.captured[0])).toContain('projection-only-sentinel');
      expect(JSON.stringify(fixture.captured[0])).not.toContain('record-only-sentinel');
      const file = fixture.sessionManager.getSessionFile();
      expect(file).toBeDefined();
      const stored = readFileSync(file!, 'utf8');
      expect(stored).toContain('record-only-sentinel');
      expect(stored).not.toContain('projection-only-sentinel');
      expect(SessionManager.open(file!).getBranch().some((e) => e.type === 'custom')).toBe(true);
    } finally { fixture.session.dispose(); }
  });

  test('native read results precede settled boundary without checkpoint bookkeeping', async () => {
    const order: string[] = [];
    const fixture = await createFixture((pi) => {
      pi.on('tool_result', () => { order.push('tool_result'); });
      pi.on('agent_settled', (_event, ctx) => {
        order.push('settled');
        expect(ctx.isIdle()).toBe(true);
      });
    }, { responses: [
      fauxAssistantMessage(fauxToolCall('read', { path: 'source.txt' }, { id: 'read-1' })),
      fauxAssistantMessage('read completed'),
    ] });
    writeFileSync(join(fixture.cwd, 'source.txt'), 'exact original evidence\r\n');
    try {
      await fixture.session.prompt('read the source');
      expect(order).toEqual(['tool_result', 'settled']);
      expect(JSON.stringify(fixture.captured[1])).toContain('exact original evidence');
    } finally { fixture.session.dispose(); }
  });

  test('native compaction excludes transient projection and exposes its actual settings', async () => {
    let observedSettings: unknown;
    const fixture = await createFixture((pi) => {
      pi.on('context', (event) => ({ messages: [...event.messages, {
        role: 'custom', customType: 'qualification-projection',
        content: 'projection-not-summary-sentinel', display: false, timestamp: Date.now(),
      }] }));
      pi.on('session_before_compact', (event) => { observedSettings = event.preparation.settings; });
    }, { persistent: true, responses: [
      fauxAssistantMessage('first response ' + 'detail '.repeat(300)),
      fauxAssistantMessage('second response ' + 'detail '.repeat(300)),
      fauxAssistantMessage('native summary'),
      fauxAssistantMessage('native turn-prefix summary'),
    ] });
    try {
      await fixture.session.prompt('first task ' + 'source '.repeat(300));
      await fixture.session.prompt('second task ' + 'source '.repeat(300));
      expect(observedSettings).toBeUndefined();
      const result = await fixture.session.compact();
      expect(result.summary).toContain('native summary');
      expect(observedSettings).toEqual({ enabled: false, reserveTokens: 512, keepRecentTokens: 64 });
      expect(JSON.stringify(fixture.captured.at(-1))).not.toContain('projection-not-summary-sentinel');
      expect(fixture.sessionManager.getBranch().filter((e) => e.type === 'compaction')).toHaveLength(1);
    } finally { fixture.session.dispose(); }
  });

  test('a disk SettingsManager snapshot does not expose host in-memory retention overrides', async () => {
    let diskKeep: number | undefined;
    const fixture = await createFixture((pi) => {
      pi.on('session_start', (_event, ctx) => {
        diskKeep = SettingsManager.create(ctx.cwd, join(ctx.cwd, 'agent'), {
          projectTrusted: ctx.isProjectTrusted(),
        }).getCompactionSettings().keepRecentTokens;
      });
    });
    try {
      expect(fixture.settingsManager.getCompactionSettings().keepRecentTokens).toBe(64);
      expect(diskKeep).toBe(20000);
    } finally { fixture.session.dispose(); }
  });

  test('context exceptions are reported but do not veto provider dispatch', async () => {
    const fixture = await createFixture((pi) => {
      pi.on('context', () => { throw new Error('context-capacity-blocked'); });
    });
    try {
      await fixture.session.prompt('preserve this request');
      expect(fixture.errors).toContain('context-capacity-blocked');
      expect(fixture.captured).toHaveLength(1);
      expect(JSON.stringify(fixture.captured[0])).toContain('preserve this request');
    } finally { fixture.session.dispose(); }
  });

  test('handled input skips dispatch but does not retain the native user entry', async () => {
    const fixture = await createFixture((pi) => {
      pi.on('input', () => ({ action: 'handled' }));
    }, { persistent: true });
    try {
      await fixture.session.prompt('preserve this request');
      expect(fixture.captured).toHaveLength(0);
      expect(JSON.stringify(fixture.sessionManager.getBranch())).not.toContain('preserve this request');
    } finally { fixture.session.dispose(); }
  });

  test('abort from context distinguishes cancellation from exception handling', async () => {
    let signalAfterAbort: AbortSignal | undefined;
    const fixture = await createFixture((pi) => {
      pi.on('context', (_event, ctx: ExtensionContext) => {
        ctx.abort();
        signalAfterAbort = ctx.signal;
      });
    }, { persistent: true });
    try {
      await fixture.session.prompt('preserve this abort request');
      expect(signalAfterAbort?.aborted).toBe(true);
      expect(JSON.stringify(fixture.sessionManager.getBranch())).toContain('preserve this abort request');
      expect(fixture.captured).toHaveLength(0);
    } finally { fixture.session.dispose(); }
  });
});
