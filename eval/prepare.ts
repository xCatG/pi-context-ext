import { readFileSync } from 'node:fs';

type Schema = { $ref?: string; const?: unknown; enum?: unknown[]; type?: string; required?: string[];
  properties?: Record<string, Schema>; additionalProperties?: boolean; items?: Schema; minItems?: number;
  maxItems?: number; minLength?: number; pattern?: string; minimum?: number; maximum?: number; $defs?: Record<string, Schema> };
const schema: Schema = JSON.parse(readFileSync(new URL('./manifest.schema.json', import.meta.url), 'utf8'));

/** Implements only the JSON Schema keywords used in the adjacent, versioned schema. */
function check(value: unknown, rule: Schema, path: string, errors: string[]): void {
  if (rule.$ref) { check(value, schema.$defs![rule.$ref.replace('#/$defs/', '')], path, errors); return; }
  const invalid = () => { errors.push(`${path}: invalid or missing frozen value`); };
  if ('const' in rule && value !== rule.const) invalid();
  if (rule.enum && !rule.enum.includes(value)) invalid();
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid(); return; }
    const object = value as Record<string, unknown>;
    for (const key of rule.required ?? []) if (!(key in object)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(object)) {
      if (rule.properties?.[key]) check(child, rule.properties[key], `${path}.${key}`, errors);
      else if (rule.additionalProperties === false) errors.push(`${path}.${key}: unexpected field`);
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) { invalid(); return; }
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) invalid();
    value.forEach((child, i) => { if (rule.items) check(child, rule.items, `${path}[${i}]`, errors); });
  } else if (rule.type === 'string') {
    if (typeof value !== 'string' || value.length < (rule.minLength ?? 0) || (rule.pattern && !new RegExp(rule.pattern).test(value))) invalid();
  } else if (rule.type === 'number' || rule.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (rule.type === 'integer' && !Number.isSafeInteger(value)) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)) invalid();
  }
}
interface FrozenInput {
  tasks: { id: string; slot: number; stratum: string; transitions: { ordinal: number; kind: string }[] }[];
  assignments: { taskId: string; arm: string; repeat: number }[];
  calibration: { slowestCallMs: number; requestDeadlineMs: number; compactionDeadlineMs: number };
}
export function validateManifest(value: unknown): { runnable: false; inputsComplete: boolean; errors: string[] } {
  const errors: string[] = [];
  check(value, schema, 'manifest', errors);
  if (errors.length === 0) {
    const manifest = value as FrozenInput;
    const tasks = [...manifest.tasks].sort((a, b) => a.slot - b.slot);
    if (new Set(tasks.map(t => t.id)).size !== 6 || tasks.some((t, i) => t.slot !== i + 1)) errors.push('tasks: six distinct IDs and slots 1 through 6 required');
    for (const task of tasks) {
      if (task.stratum !== (task.slot <= 2 ? 'short' : 'long')) errors.push(`tasks.${task.id}: incorrect stratum`);
      const kind = ['tree-fork', 'external-patch', 'factual-correction', 'persisted-restart'][task.slot - 3];
      if (kind && !task.transitions.some(t => t.kind === kind)) errors.push(`tasks.${task.id}: missing ${kind} transition`);
      if (new Set(task.transitions.map(t => t.ordinal)).size !== task.transitions.length) errors.push(`tasks.${task.id}: duplicate transition ordinal`);
    }
    // Assignment array is the frozen run order: repeat 1 rotations, repeat 2 reversals.
    const expected = [1, 2].flatMap(repeat => tasks.flatMap((task, i) => {
      const order = ['ABC', 'BCA', 'CAB'][i % 3].split('');
      if (repeat === 2) order.reverse();
      return order.map(arm => ({ taskId: task.id, arm, repeat }));
    }));
    if (manifest.assignments.some((cell, i) => cell.taskId !== expected[i].taskId || cell.arm !== expected[i].arm || cell.repeat !== expected[i].repeat)) errors.push('assignments: require all 36 unique cells in counterbalanced frozen order');
    const deadline = Math.max(300000, 3 * manifest.calibration.slowestCallMs);
    if (manifest.calibration.requestDeadlineMs < deadline || manifest.calibration.compactionDeadlineMs < deadline) errors.push('calibration: deadlines below max(300 seconds, 3 x slowest call)');
  }
  const inputsComplete = errors.length === 0;
  errors.push('C unavailable: settled-boundary native compaction race is unresolved');
  return { runnable: false, inputsComplete, errors };
}
