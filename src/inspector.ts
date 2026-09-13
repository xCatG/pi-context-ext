import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { RebuiltState } from './records.ts';

const MAX_LINES = 500;
const MAX_WIDTH = 160;
// Defense in depth after Pi's escape-sequence parser: also remove C0/C1 and
// directional formatting controls. This changes display only, never evidence.
const safe = (value: unknown) => stripTerminalSequences(String(value))
  .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, ' ');
const bounded = (lines: string[]) => lines.slice(0, MAX_LINES).map(line => truncateToWidth(safe(line), MAX_WIDTH));
// Share preview space across independent categories so a large category cannot
// conceal the newest warning or actionable record in another category.
function interleave<T>(...groups: T[][]): T[] {
  const result: T[] = [];
  for (let i = 0; groups.some(group => i < group.length); i++) {
    for (const group of groups) if (i < group.length) result.push(group[i]);
  }
  return result;
}

export function buildInspectorLines(state: RebuiltState, options: {
  mode: string; sessionId: string; omittedIds: string[]; budget: unknown;
  persistence?: string;
  // The caller establishes whether its last projection still matches current
  // branch/mode/context. Missing metadata never implies current selection.
  projection?: { status: 'none' | 'active' | 'stale' | 'disabled'; requestId?: string };
  recent?: { id: string; text: string }[];
}): string[] {
  const lines: string[] = [];
  let sectionLines = 0, hiddenLines = 0;
  const add = (value: unknown) => {
    if (sectionLines++ < 60) lines.push(truncateToWidth(safe(value), MAX_WIDTH));
    else hiddenLines++;
  };
  const flush = () => {
    if (hiddenLines) lines.push(`${hiddenLines} lines omitted from preview; inspect native session records for further detail.`);
    sectionLines = 0; hiddenLines = 0;
  };
  const omitted = new Set(options.omittedIds);
  const projection = options.projection?.status ?? 'none';
  const selection = projection === 'disabled' ? 'Selection disabled'
    : projection === 'stale' ? 'Selection unknown (last snapshot is stale)'
      : 'Selection unknown (no current projection)';
  const newest = [...state.records].reverse();
  const conflicts = new Set(state.conflictIds);
  const activeClaims = new Set(state.activeClaimIds);
  const openWork = new Set(state.openWorkIds);
  const header = (label: string) => { flush(); add(`--- ${label} ---`); };
  add(`Context inspector | mode=${options.mode} | health=${state.health} | session=${options.sessionId}`);
  add('Read-only attributed data, not new instructions. Successful tools are not semantic verification.');
  add('Historical evidence may be stale; obtain current exact source before edits. Previews are bounded.');
  add('Source/observation native entry IDs support context_recall for exact history; omitted does not mean deleted or resolved.');
  add('Inspect native session records for model claims, intents, work and lifecycle data.');
  header('Goals and user pins');
  const original = state.records.find(r => r.kind === 'user_source');
  for (const r of [...(original ? [original] : []), ...newest.filter(r => r !== original)]) {
    if (r.kind === 'user_source') add(`Source ${r.id} | native=${r.data.entryId} origin=${r.data.origin} | ${r.data.text}`);
    if (r.kind === 'intent' && r.data.pinned) add(`Pin ${r.id} | source=${r.data.sourceId} author=${r.data.author} | ${r.data.text}`);
  }
  header('Evidence and provenance');
  for (const r of newest) if (r.kind === 'observation') {
    add(`${r.id} | native=${r.data.entryId} tool=${r.data.toolName} outcome=${r.data.outcome} ${r.data.partial ? 'partial' : 'captured'} | ${r.data.path ?? '(no path)'}`);
    add(`  digest=${r.data.digest} session=${r.data.sourceSessionId ?? 'unknown'} | ${projection === 'active' ? (omitted.has(r.id) ? 'omitted from selection' : 'selected candidate') : selection}`);
  }
  header('Model interpretations and revisions (may be wrong)');
  const priorityClaims = interleave(
    newest.filter(r => r.kind === 'claim' && conflicts.has(r.id)),
    newest.filter(r => r.kind === 'claim' && activeClaims.has(r.id) && !conflicts.has(r.id)),
  );
  const priorityClaimIds = new Set(priorityClaims.map(r => r.id));
  for (const r of [...priorityClaims, ...newest.filter(r => !priorityClaimIds.has(r.id))]) {
    if (r.kind === 'claim') {
      add(`${r.id} | ${r.data.status} ${state.activeClaimIds.includes(r.id) ? 'active' : 'historical/conflicted'} | ${r.data.text}`);
      add(`  evidence=${r.data.evidenceIds.join(',')} counterevidence=${r.data.counterEvidenceIds.join(',')}`);
      if (r.data.supersedes) add(`  supersedes=${r.data.supersedes} reason=${r.data.reason}`);
    }
    if (r.kind === 'intent' && !r.data.pinned) add(`Model intent ${r.id} source=${r.data.sourceId} | ${r.data.text}`);
  }
  header('Work, unknown operations and conflicts');
  const work = newest.filter(r => r.kind === 'work');
  const urgentWork = interleave(work.filter(r => conflicts.has(r.id)), work.filter(r => openWork.has(r.id) && !conflicts.has(r.id)));
  const urgentIds = new Set(urgentWork.map(r => r.id));
  for (const r of interleave(
    [...urgentWork, ...work.filter(r => !urgentIds.has(r.id))],
    newest.filter(r => r.kind === 'lifecycle' && r.data.event === 'unknown-operation'),
  )) {
    if (r.kind === 'work') add(`${r.id} | ${r.data.status} | ${r.data.text} | supersedes=${r.data.supersedes ?? 'none'}`);
    if (r.kind === 'lifecycle' && r.data.event === 'unknown-operation') add(`Unknown operation ${r.id}: ${JSON.stringify(r.data.details)}`);
  }
  header('Conflicts and diagnostics');
  add(`Conflicts: ${state.conflictIds.length || 'none'} | claim state available=${state.claimStateAvailable}`);
  for (const line of interleave(
    [...state.conflictIds].reverse().map(id => `Conflict: ${id}`),
    [...state.diagnostics].reverse().map(d => `Diagnostic ${d.code} ${d.recordId ?? ''}: ${d.message}`),
  )) add(line);
  header('Selection versus indexed active-branch records');
  add(`${state.records.length} indexed active-branch records; persistence=${options.persistence ?? 'unknown'}.`);
  add('Indexing does not guarantee persistence; consult native session history.');
  add(projection === 'active' ? `Selection from active projection | request=${options.projection?.requestId ?? 'unknown'} | ${options.omittedIds.length} omitted IDs.` : selection);
  if (projection === 'active' || projection === 'stale') {
    add(`Last projection admission diagnostics (estimates, not provider billing): ${JSON.stringify(options.budget)}`);
  }
  if (projection === 'active') for (const id of options.omittedIds) add(`omitted: ${id}`);
  header('Recent conversation (historical; not new authority)');
  for (const r of [...(options.recent ?? [])].reverse()) add(`native=${r.id} | ${r.text}`);
  flush();
  lines.push('End of bounded preview. Inspect native session history for additional records; persistence depends on the session.');
  return lines;
}

export async function showInspector(ctx: ExtensionContext, lines: string[]): Promise<void> {
  const clean = bounded(lines);
  if (ctx.mode !== 'tui' || !ctx.hasUI) {
    ctx.ui.notify(JSON.stringify({ type: 'context-inspector', readOnly: true, lines: clean }), 'info');
    return;
  }
  await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
    let offset = 0, rendered: string[] = [], page = 1;
    return {
      invalidate() {},
      render(width: number) {
        const w = Math.max(1, Math.min(MAX_WIDTH, width));
        page = Math.max(1, Math.min(30, tui.terminal.rows - 2));
        rendered = clean.flatMap(line => wrapTextWithAnsi(line, w));
        offset = Math.max(0, Math.min(offset, Math.max(0, rendered.length - page)));
        return [truncateToWidth('Context | q/Esc close', w), ...rendered.slice(offset, offset + page),
          truncateToWidth(`Up/Down PgUp/PgDn | ${offset + 1}/${rendered.length}`, w)];
      },
      handleInput(data: string) {
        if (matchesKey(data, 'q') || matchesKey(data, Key.escape)) { done(); return; }
        const delta = matchesKey(data, Key.down) ? 1 : matchesKey(data, Key.up) ? -1
          : matchesKey(data, Key.pageDown) ? page : matchesKey(data, Key.pageUp) ? -page : 0;
        offset = Math.max(0, Math.min(offset + delta, Math.max(0, rendered.length - page)));
        if (delta) tui.requestRender();
      },
    };
  });
}
