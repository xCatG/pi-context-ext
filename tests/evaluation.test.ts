import { describe, expect, it } from 'vitest';
import { report, type Attempt, type Task } from '../eval/report.ts';
import { validateManifest } from '../eval/prepare.ts';

const tasks: Task[] = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, stratum: i < 2 ? 'short' : 'long' }));
function syntheticManifest() {
  const artifact = { location: 'synthetic-fixture-only', sha256: '0'.repeat(64) };
  const inventory = { prompts: artifact, tools: artifact, noOtherPlugins: true };
  return {
    protocol: '2026-09-11', frozen: true,
    identity: { packageVersion: '0.85.1', packageIntegrity: `sha512-${'A'.repeat(86)}==`, extensionCommit: 'a'.repeat(40), dependencyLockDigest: 'b'.repeat(64), osImage: 'synthetic-os' },
    model: { provider: 'synthetic', name: 'none', version: 'fixture', sampling: 'fixed', reasoning: 'none', outputLimit: 100, contextLimit: 1000, summaryUsesAttemptModel: true },
    inventories: { A: inventory, B: inventory, C: inventory }, retryPolicy: artifact,
    aggregateBudget: { costCeiling: 0, currency: 'USD', wallMs: 1000000 },
    calibration: { authorization: 'synthetic-only', calls: 1, slowestCallMs: 100000, longInputCovered: true, requestDeadlineMs: 300000, compactionDeadlineMs: 300000, evidence: artifact },
    tasks: tasks.map((t, i) => ({ ...t, slot: i + 1, origin: 'synthetic-user-request', repository: 'synthetic-only', baseCommit: 'c'.repeat(40), snapshot: artifact,
      issueText: artifact, acceptance: [{ command: 'synthetic-no-execution', fixture: artifact, baseResult: artifact, knownGoodResult: artifact }],
      knownGoodEvidence: artifact, scriptedMessages: artifact,
      transitions: i < 2 ? [] : [{ ordinal: 2, kind: ['tree-fork', 'external-patch', 'factual-correction', 'persisted-restart'][i - 2], instructions: artifact }],
      expectedOpportunity: 'structural-fixture', budget: { tokens: 1000, calls: 10, wallMs: 10000 }, constraints: artifact, forbiddenScope: artifact,
      authentic: true, noFiller: true, noRahArtifacts: true, goldInaccessible: true })),
    assignments: [1, 2].flatMap(repeat => tasks.flatMap((task, i) => {
      const order = ['ABC', 'BCA', 'CAB'][i % 3].split('');
      return (repeat === 1 ? order : order.reverse()).map(arm => ({ taskId: task.id, arm, repeat }));
    })),
    failureRules: { oneAttemptPerCell: true, retriesConsumeBudget: true, retainAllFailures: true, capacityBlockedTerminal: true, noUnscriptedIntervention: true,
      stopOnOutageOrAggregateCap: true, resumeRequiresAuthorization: true, changedInputsRequireNewProtocol: true, serial: true },
    qualification: { A: artifact, B: artifact, C: artifact }, gradingIsolation: artifact, machineLoad: 'synthetic-only',
  };
}
function attempts(): Attempt[] {
  return tasks.flatMap(task => (['A', 'B', 'C'] as const).flatMap(arm => ([1, 2] as const).map(repeat => ({ taskId: task.id, arm, repeat, status: 'passed' as const, logicalTokens: 100, wallMs: 100, earlyCompactions: 0, safetyViolations: [] }))));
}
describe('frozen finite reporting', () => {
  it('requires two distinct long task wins for correctness', () => {
    const rows = attempts();
    rows.filter(r => r.arm === 'A' && r.taskId === 't2').forEach(r => { r.status = 'failed'; });
    expect(report(tasks, rows).organizationGo).toBe(false);
    rows.find(r => r.arm === 'A' && r.taskId === 't3')!.status = 'failed';
    expect(report(tasks, rows).organizationGo).toBe(true);
  });
  it('rejects paired regressions and early failure savings even with equal task success counts', () => {
    const rows = attempts();
    rows.filter(r => r.arm === 'B').forEach(r => { r.logicalTokens = 1; r.wallMs = 1; });
    rows.find(r => r.arm === 'A' && r.taskId === 't2' && r.repeat === 1)!.status = 'failed';
    rows.find(r => r.arm === 'B' && r.taskId === 't2' && r.repeat === 2)!.status = 'failed';
    const result = report(tasks, rows);
    expect(result.efficiencyGo).toBe(false);
    expect(result.organization.pairedRegressions).toHaveLength(1);
    expect(result.organization.treatmentCosts.failed.logicalTokens).toBe(1);
    expect(result.organization.treatmentCosts.all.logicalTokens).toBe(12);
  });
  it('requires savings in both cost views and common success across three tasks', () => {
    const rows = attempts();
    rows.filter(r => r.arm === 'B').forEach(r => { r.logicalTokens = 85; r.wallMs = 110; });
    expect(report(tasks, rows).efficiencyGo).toBe(true);
    rows.filter(r => r.arm === 'A' && !['t0', 't1'].includes(r.taskId)).forEach(r => { r.status = 'failed'; });
    expect(report(tasks, rows).efficiencyGo).toBe(false);
  });
  it('keeps missing failure costs unknown and capacity failures in denominators', () => {
    const rows = attempts();
    rows[0] = { ...rows[0], status: 'context-capacity-blocked', logicalTokens: null };
    const result = report(tasks, rows);
    expect(result.costConclusion).toBe('unavailable');
    expect(result.failedAttempts).toBe(1);
    expect(result.organizationGo).toBe(false);
    expect(result.assignedAttempts).toBe(36);
  });
  it('never promotes timing without triggers on two long tasks, or when organization fails', () => {
    const rows = attempts();
    rows.filter(r => r.arm !== 'A').forEach(r => { r.logicalTokens = r.arm === 'B' ? 85 : 70; });
    expect(report(tasks, rows).timingConclusion).toBe('inconclusive');
    rows.filter(r => r.arm === 'C' && ['t2', 't3'].includes(r.taskId)).forEach(r => { r.earlyCompactions = 1; });
    expect(report(tasks, rows).timingConclusion).toBe('go');
    rows.filter(r => r.arm === 'B').forEach(r => { r.logicalTokens = 100; });
    expect(report(tasks, rows).timingConclusion).toBe('do-not-promote');
  });
  it('rejects duplicate/missing assignments and safety violations block gates', () => {
    const rows = attempts();
    expect(() => report(tasks, rows.slice(1))).toThrow();
    expect(() => report(tasks, [...rows.slice(1), rows[1]])).toThrow();
    rows.filter(r => r.arm === 'B').forEach(r => { r.logicalTokens = 70; });
    rows[2].safetyViolations = ['durable-history-loss'];
    expect(report(tasks, rows).organizationGo).toBe(false);
  });
});
describe('preparation admission', () => {
  it('checks complete structural fixtures but still rejects execution', () => {
    expect(validateManifest(syntheticManifest())).toMatchObject({ inputsComplete: true, runnable: false });
  });
  it('requires every identity, model and budget input', () => {
    for (const group of ['identity', 'model', 'aggregateBudget'] as const) {
      for (const key of Object.keys(syntheticManifest()[group])) {
        const fixture = syntheticManifest();
        delete (fixture[group] as Record<string, unknown>)[key];
        expect(validateManifest(fixture).inputsComplete, `${group}.${key}`).toBe(false);
      }
    }
  });
  it('rejects changed task slots, transition types, assignment coverage and deadlines', () => {
    const changes = [
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].id = m.tasks[1].id; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[2].transitions = []; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].stratum = 'long'; },
      (m: ReturnType<typeof syntheticManifest>) => { m.assignments[1] = m.assignments[0]; },
      (m: ReturnType<typeof syntheticManifest>) => { m.calibration.slowestCallMs = 100001; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].budget.tokens = 0; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].authentic = false; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].noRahArtifacts = false; },
      (m: ReturnType<typeof syntheticManifest>) => { m.identity.extensionCommit = 'HEAD'; },
      (m: ReturnType<typeof syntheticManifest>) => { m.identity.dependencyLockDigest = 'pending'; },
      (m: ReturnType<typeof syntheticManifest>) => { m.tasks[0].baseCommit = 'main'; },
    ];
    changes.forEach(change => { const fixture = syntheticManifest(); change(fixture); expect(validateManifest(fixture).inputsComplete).toBe(false); });
  });
  it('rejects unfrozen inputs and cannot authorize C while its qualification is unavailable', () => {
    const result = validateManifest({});
    expect(result.runnable).toBe(false);
    expect(result.errors).toContain('C unavailable: settled-boundary native compaction race is unresolved');
    expect(result.errors.some(e => e.includes('identity'))).toBe(true);
    expect(result.errors.some(e => e.includes('tasks'))).toBe(true);
    expect(result.errors.some(e => e.includes('assignments'))).toBe(true);
  });
});
