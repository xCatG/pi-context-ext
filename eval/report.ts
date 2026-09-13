import { sumKnown } from '../src/metrics.ts';

export type Arm = 'A' | 'B' | 'C';
export interface Task { id: string; stratum: 'short' | 'long' }
export interface Attempt {
  taskId: string; arm: Arm; repeat: 1 | 2;
  status: 'passed' | 'failed' | 'context-capacity-blocked' | 'not-started';
  logicalTokens: number | null; wallMs: number | null;
  earlyCompactions: number;
  /** Evidence-reviewed treatment-attributed violations of the protocol safety gate. */
  safetyViolations: string[];
}
const success = (row: Attempt) => row.status === 'passed';
function costs(rows: Attempt[]) {
  return { attempts: rows.length, logicalTokens: sumKnown(rows.map(r => r.logicalTokens)), wallMs: sumKnown(rows.map(r => r.wallMs)) };
}
function within(treatment: number | null, baseline: number | null, multiplier: number) {
  return treatment !== null && baseline !== null && treatment <= baseline * multiplier;
}
function compare(tasks: Task[], rows: Attempt[], baseline: Arm, treatment: Arm) {
  const base = rows.filter(r => r.arm === baseline);
  const treated = rows.filter(r => r.arm === treatment);
  const pairs = base.map(a => {
    const b = treated.find(b => b.taskId === a.taskId && b.repeat === a.repeat)!;
    return { taskId: a.taskId, repeat: a.repeat, baseline: a, treatment: b,
      outcome: success(a) ? success(b) ? 'both-pass' : 'baseline-only' : success(b) ? 'treatment-only' : 'neither' };
  });
  const perTask = tasks.map(task => ({ ...task,
    baselineSuccesses: base.filter(r => r.taskId === task.id && success(r)).length,
    treatmentSuccesses: treated.filter(r => r.taskId === task.id && success(r)).length }));
  const common = pairs.filter(p => p.outcome === 'both-pass');
  const baselineCosts = { all: costs(base), commonSuccess: costs(common.map(p => p.baseline)), failed: costs(base.filter(r => !success(r))) };
  const treatmentCosts = { all: costs(treated), commonSuccess: costs(common.map(p => p.treatment)), failed: costs(treated.filter(r => !success(r))) };
  const safe = treated.every(r => r.safetyViolations.length === 0);
  const completed = [...base, ...treated].every(r => r.status !== 'not-started');
  const costKnown = [baselineCosts.all, treatmentCosts.all].every(c => c.logicalTokens !== null && c.wallMs !== null);
  const correctnessGo = safe && completed && perTask.every(t => t.treatmentSuccesses >= t.baselineSuccesses) &&
    perTask.filter(t => t.stratum === 'long' && t.treatmentSuccesses > t.baselineSuccesses).length >= 2 &&
    within(treatmentCosts.all.logicalTokens, baselineCosts.all.logicalTokens, 1.25) && within(treatmentCosts.all.wallMs, baselineCosts.all.wallMs, 1.25);
  const pairedRegressions = pairs.filter(p => p.outcome === 'baseline-only');
  const efficiencyGo = safe && completed && pairedRegressions.length === 0 && common.length >= 4 &&
    new Set(common.map(p => p.taskId)).size >= 3 &&
    // Zero baseline consumption cannot establish a reduction.
    (baselineCosts.all.logicalTokens ?? 0) > 0 && (baselineCosts.commonSuccess.logicalTokens ?? 0) > 0 &&
    within(treatmentCosts.all.logicalTokens, baselineCosts.all.logicalTokens, .85) &&
    within(treatmentCosts.commonSuccess.logicalTokens, baselineCosts.commonSuccess.logicalTokens, .85) &&
    within(treatmentCosts.all.wallMs, baselineCosts.all.wallMs, 1.10) &&
    within(treatmentCosts.commonSuccess.wallMs, baselineCosts.commonSuccess.wallMs, 1.10);
  return { baseline, treatment, correctnessGo, efficiencyGo, go: correctnessGo || efficiencyGo,
    costConclusion: costKnown ? 'available' : 'unavailable', baselineCosts, treatmentCosts, perTask, pairs, pairedRegressions };
}
/** Descriptive synthetic reporting only. Never executes, schedules or authorizes attempts. */
export function report(tasks: Task[], rows: Attempt[]) {
  if (tasks.length !== 6 || new Set(tasks.map(t => t.id)).size !== 6 || tasks.some(t => !t.id) ||
      tasks.filter(t => t.stratum === 'short').length !== 2 || tasks.filter(t => t.stratum === 'long').length !== 4) throw new Error('Require six distinct tasks: two short and four long');
  const expected = new Set(tasks.flatMap(t => (['A', 'B', 'C'] as const).flatMap(a => [1, 2].map(r => JSON.stringify([t.id, a, r])))));
  for (const row of rows) {
    if (!expected.delete(JSON.stringify([row.taskId, row.arm, row.repeat]))) throw new Error('Invalid or duplicate assignment');
    if (!['passed', 'failed', 'context-capacity-blocked', 'not-started'].includes(row.status) ||
        !Number.isSafeInteger(row.earlyCompactions) || row.earlyCompactions < 0 ||
        !Array.isArray(row.safetyViolations) || row.safetyViolations.some(v => typeof v !== 'string')) throw new Error('Invalid attempt evidence');
    if ([row.logicalTokens, row.wallMs].some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error('Invalid attempt cost');
    if (row.status === 'not-started' && (row.logicalTokens !== null || row.wallMs !== null)) throw new Error('Unstarted assignments have unknown costs');
  }
  if (expected.size) throw new Error('Include all 36 assignments, using not-started for incomplete coverage');
  const organization = compare(tasks, rows, 'A', 'B');
  const timing = compare(tasks, rows, 'B', 'C');
  const triggeredLongTasks = tasks.filter(t => t.stratum === 'long' && rows.some(r => r.taskId === t.id && r.arm === 'C' && r.earlyCompactions > 0)).map(t => t.id);
  const timingConclusion = triggeredLongTasks.length < 2 ? 'inconclusive' : organization.go && timing.go ? 'go' : 'do-not-promote';
  return { organization, timing, organizationGo: organization.go, efficiencyGo: organization.efficiencyGo,
    timingConclusion, triggeredLongTasks,
    costConclusion: rows.some(r => r.logicalTokens === null || r.wallMs === null) ? 'unavailable' : 'available',
    assignedAttempts: rows.length, failedAttempts: rows.filter(r => !success(r) && r.status !== 'not-started').length,
    incompleteAttempts: rows.filter(r => r.status === 'not-started').length,
    strata: (['short', 'long'] as const).map(stratum => ({ stratum, arms: (['A', 'B', 'C'] as const).map(arm => {
      const subset = rows.filter(r => r.arm === arm && tasks.some(t => t.id === r.taskId && t.stratum === stratum));
      return { arm, successes: subset.filter(success).length, ...costs(subset), triggeredAttempts: subset.filter(r => r.earlyCompactions > 0).length };
    }) })) };
}
