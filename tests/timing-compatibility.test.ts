import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { estimateTokens, type ExtensionContext, type ExtensionFactory,
  type SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createFixture } from './fixtures/native-session.ts';

/** Qualification probe, not the product timing policy. Eligibility is supplied by tests. */
function probe(options: { minimum?: number; replaceGenerationInHook?: boolean;
  onPreparation?: () => Promise<void> } = {}) {
  let context: ExtensionContext;
  let generation = 0;
  let candidate: { generation: number; marker: string } | undefined;
  const consumed = new Set<string>();
  const observations: SessionBeforeCompactEvent[] = [];
  const outcomes: string[] = [];
  const extension: ExtensionFactory = (pi) => {
    pi.on('session_start', (_event, ctx) => { context = ctx; generation++; candidate = undefined; });
    pi.on('session_before_compact', async (event) => {
      if (!candidate || candidate.generation !== generation ||
          event.customInstructions !== candidate.marker) return;
      observations.push(event);
      await options.onPreparation?.();
      const removable = [...event.preparation.messagesToSummarize,
        ...event.preparation.turnPrefixMessages].reduce((sum, message) => sum + estimateTokens(message), 0);
      if (options.replaceGenerationInHook) { generation++; candidate = undefined; }
      if (removable < (options.minimum ?? 4000) || options.replaceGenerationInHook) return { cancel: true };
    });
  };
  return {
    extension, observations, outcomes, consumed,
    request(boundary: string) {
      if (!context.isIdle() || context.hasPendingMessages() || candidate || consumed.has(boundary)) return undefined;
      consumed.add(boundary);
      const armed = { generation, marker: `Context compaction correlation ID: ${randomUUID()}.` };
      candidate = armed; // Must precede the non-awaitable public call.
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      const settle = (outcome: string) => {
        if (candidate === armed && generation === armed.generation) {
          outcomes.push(outcome);
          candidate = undefined;
        }
        finish();
      };
      context.compact({ customInstructions: armed.marker,
        onComplete: () => settle('complete'), onError: (error) => settle(error.message) });
      return done;
    },
  };
}

const longResponses = [
  fauxAssistantMessage('first answer ' + 'evidence '.repeat(300)),
  fauxAssistantMessage('second answer ' + 'evidence '.repeat(300)),
  fauxAssistantMessage('native summary'),
  fauxAssistantMessage('native prefix summary'),
];
async function fill(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await fixture.session.prompt('first unit ' + 'source '.repeat(300));
  await fixture.session.prompt('second unit ' + 'source '.repeat(300));
}

describe('two-stage native compaction qualification', () => {
  test('cancelled candidate sees live native cut and consumes boundary before any summary call', async () => {
    const p = probe({ minimum: 1_000_000 });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    try {
      await fill(fixture);
      await p.request('unit-2');
      expect(p.observations).toHaveLength(1);
      const preparation = p.observations[0].preparation;
      expect(preparation.settings.keepRecentTokens).toBe(64);
      expect(preparation.messagesToSummarize.length + preparation.turnPrefixMessages.length).toBeGreaterThan(0);
      expect(fixture.sessionManager.getBranch().some((entry) => entry.id === preparation.firstKeptEntryId)).toBe(true);
      expect(p.outcomes).toEqual(['Compaction cancelled']);
      expect(fixture.captured).toHaveLength(2);
      expect(p.request('unit-2')).toBeUndefined();
      expect(fixture.sessionManager.getBranch().filter((entry) => entry.type === 'compaction')).toHaveLength(0);
    } finally { fixture.session.dispose(); }
  });

  test('eligible candidate uses native summary and completion callback', async () => {
    const p = probe({ minimum: 1 });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    try {
      await fill(fixture);
      await p.request('unit-2');
      expect(p.outcomes).toEqual(['complete']);
      expect(fixture.captured.length).toBeGreaterThan(2);
      expect(fixture.sessionManager.getBranch().filter((entry) => entry.type === 'compaction')).toHaveLength(1);
      expect(p.request('unit-2')).toBeUndefined();
    } finally { fixture.session.dispose(); }
  });

  test('unarmed manual compaction is not cancelled by an insufficient-reclamation policy', async () => {
    const p = probe({ minimum: 1_000_000 });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    try {
      await fill(fixture);
      expect((await fixture.session.compact('Ordinary manual compaction.')).summary).toContain('native summary');
      expect(p.observations).toHaveLength(0);
      expect(p.outcomes).toHaveLength(0);
    } finally { fixture.session.dispose(); }
  });

  test('preparation failure invokes error callback without hook and consumes attempt', async () => {
    const p = probe();
    const fixture = await createFixture(p.extension);
    try {
      await p.request('empty');
      expect(p.observations).toHaveLength(0);
      expect(p.outcomes).toEqual(['Nothing to compact (session too small)']);
      expect(p.request('empty')).toBeUndefined();
      expect(fixture.captured).toHaveLength(0);
    } finally { fixture.session.dispose(); }
  });

  // Characterization of a native defect, NOT qualification of concurrency safety.
  test('overlap correlates correctly but native manual compaction fails on its shared controller', async () => {
    const p = probe({ minimum: 1_000_000 });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    try {
      await fill(fixture);
      const candidateDone = p.request('unit-2');
      const manual = fixture.session.compact('Independent manual request.');
      const results = await Promise.allSettled([candidateDone, manual]);
      expect(p.observations).toHaveLength(1);
      expect(p.observations[0].customInstructions).toContain('Context compaction correlation ID:');
      expect(p.outcomes).toEqual(['Compaction cancelled']);
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(TypeError);
        expect(results[1].reason.message).toBe("Cannot read properties of undefined (reading 'signal')");
      }
    } finally { fixture.session.dispose(); }
  });

  test('generation invalidation suppresses stale callback state writes', async () => {
    const p = probe({ replaceGenerationInHook: true });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    try {
      await fill(fixture);
      await p.request('unit-2');
      expect(p.observations).toHaveLength(1);
      expect(p.outcomes).toHaveLength(0);
      expect(fixture.captured).toHaveLength(2);
      expect(p.consumed.has('unit-2')).toBe(true);
    } finally { fixture.session.dispose(); }
  });

  test('a follow-up queued during cancelled preparation remains pending without fabricated continuation', async () => {
    let queue!: () => Promise<void>;
    const p = probe({ minimum: 1_000_000, onPreparation: () => queue() });
    const fixture = await createFixture(p.extension, { responses: longResponses });
    queue = () => fixture.session.followUp('preserve queued follow-up');
    try {
      await fill(fixture);
      await p.request('unit-2');
      expect(p.outcomes).toEqual(['Compaction cancelled']);
      expect(fixture.session.pendingMessageCount).toBe(1);
      expect(fixture.session.getFollowUpMessages()).toEqual(['preserve queued follow-up']);
      expect(fixture.captured).toHaveLength(2);
      expect(p.request('unit-3')).toBeUndefined();
    } finally { fixture.session.dispose(); }
  });
});
