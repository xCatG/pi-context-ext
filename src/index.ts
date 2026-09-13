import { createHash, randomUUID } from 'node:crypto';
import { convertToLlm, type ExtensionAPI, type ExtensionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { canonical, rebuild, validateRecord, type Mode, type RecordEnvelope } from './records.ts';
import { captureEntries, deriveObservationKey, nativeEntryText } from './capture.ts';
import { NativeRecall } from './recall.ts';
import { compareSpan } from './freshness.ts';
import { normalizePiUsage } from './metrics.ts';
import { GUIDANCE, project, sizeEstimate, transformMessages, PROJECTION_TYPE } from './projection.ts';

export const RECORD_TYPE = 'pi-context-ext/records/v1';
const TOOL_NAMES = ['context_checkpoint', 'context_recall'];
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function result(details: unknown, isError = false) {
  // Pi's public tool result type has no isError flag; throwing produces a native
  // failed tool result. A returned ad-hoc flag would be ignored by the host.
  if (isError) throw new Error(JSON.stringify(details));
  return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
}
const revisionFields = { supersedes: Type.Optional(Type.String({ description: 'Active record ID being replaced' })),
  reason: Type.Optional(Type.String({ description: 'Reason for the correction; required with supersedes' })) };
const claimSchema = Type.Object({ text: Type.String(), status: Type.Union([
  Type.Literal('hypothesis'), Type.Literal('conclusion'), Type.Literal('uncertain')]),
  evidenceIds: Type.Array(Type.String({ description: 'Active observation/user-source record ID or native entry ID' })),
  counterEvidenceIds: Type.Array(Type.String()), ...revisionFields }, { additionalProperties: false });
const workSchema = Type.Object({ text: Type.String(), status: Type.Union([
  Type.Literal('open'), Type.Literal('done'), Type.Literal('withdrawn')]), ...revisionFields }, { additionalProperties: false });
const intentSchema = Type.Object({ text: Type.String({ description: 'Proposed interpretation, not an exact quote or approval' }),
  sourceId: Type.String(), author: Type.Literal('model'), pinned: Type.Literal(false) }, { additionalProperties: false });

/** Standalone public Pi extension. Native tools and compaction policy are untouched. */
export default function contextExtension(pi: ExtensionAPI) {
  let mode: Mode = 'organized';
  let generation = 0;
  let omitted: string[] = [];
  let lastBudget: unknown;
  const recalled = new Set<string>();
  const recall = new NativeRecall();
  const toolStarts = new Map<string, number>();
  let turnStarted: number | undefined;
  let compactionStarted: number | undefined;
  const completedTiming = new Map<string, Array<number | null>>();

  const branch = (ctx: ExtensionContext) => ctx.sessionManager.getBranch();
  const anchor = (entries: SessionEntry[]) => entries.findLast(e => e.type === 'message')?.id ?? entries.at(-1)?.id;
  function rawRecords(entries: SessionEntry[]): unknown[] {
    const activeIds = new Set(entries.map(e => e.id));
    return entries.flatMap(e => {
      if (e.type !== 'custom' || e.customType !== RECORD_TYPE) return [];
      const values = object(e.data) && Array.isArray(e.data.records) ? e.data.records : [e.data];
      return values.map((r: unknown) => object(r) && (typeof r.anchor !== 'string' || !activeIds.has(r.anchor))
        ? { ...r, schemaVersion: -1, anchor: e.id } : r);
    });
  }
  function append(records: unknown[]) { if (records.length) pi.appendEntry(RECORD_TYPE, { records }); }
  function record(id: string, at: string, kind: string, data: unknown): RecordEnvelope {
    const checked = validateRecord({ schemaVersion: 1, id, anchor: at, kind, data });
    if (!checked.ok) throw new Error(`Invalid ${kind} context record`);
    return checked.record;
  }
  function lifecycle(ctx: ExtensionContext, event: string, details: Record<string, unknown>) {
    const at = anchor(branch(ctx));
    if (at) append([record(randomUUID(), at, 'lifecycle', { event, details })]);
  }
  function sync(ctx: ExtensionContext) {
    let entries = branch(ctx);
    const raw = rawRecords(entries);
    const captured = captureEntries(ctx.sessionManager.getSessionId(), entries);
    const rawByAnchor = new Map<string, unknown[]>();
    for (const r of raw) if (object(r) && typeof r.anchor === 'string') {
      const group = rawByAnchor.get(r.anchor) ?? []; group.push(r); rawByAnchor.set(r.anchor, group);
    }
    const capturedById = new Map(captured.map(r => [r.id, r]));
    const capturedByAnchor = new Map(captured.map(r => [r.anchor, r]));
    const authentic = (old: unknown, derived: (typeof captured)[number]) => {
      const parsed = validateRecord(old);
      if (!parsed.ok) return false;
      const r = parsed.record;
      if (r.kind !== derived.kind || r.anchor !== derived.anchor) return false;
      if ((r.kind !== 'user_source' && r.kind !== 'observation') || !r.data.sourceSessionId ||
          r.id !== deriveObservationKey(r.data.sourceSessionId, r.data.entryId, r.kind)) return false;
      if (r.kind === 'user_source' && derived.kind === 'user_source')
        return r.data.entryId === derived.data.entryId && r.data.text === derived.data.text;
      return r.kind === 'observation' && derived.kind === 'observation' &&
        hash({ ...r.data, sourceSessionId: '' }) === hash({ ...derived.data, sourceSessionId: '' });
    };
    append(captured.filter(r => !(rawByAnchor.get(r.anchor) ?? []).some(old => authentic(old, r))));
    entries = branch(ctx);
    const nativeById = new Map(entries.map(e => [e.id, e]));
    const all = rawRecords(entries);
    const usageEntries = entries.filter(e => e.type === 'compaction' || (e.type === 'message' && e.message.role === 'assistant'));
    const makeUsageIdentity = (entry: SessionEntry) => {
      if (entry.type === 'message' && entry.message.role === 'assistant') {
        const outcome = ['error', 'aborted'].includes(entry.message.stopReason) ? 'failed' : 'succeeded';
        return { operationId: entry.id, category: 'assistant', status: outcome, usage: normalizePiUsage(entry.message.usage, outcome) };
      }
      return entry.type === 'compaction' ? { operationId: entry.id, category: 'native-compaction', status: 'succeeded',
        usage: normalizePiUsage(entry.usage ?? null, 'succeeded') } : undefined;
    };
    const identities = new Map(usageEntries.map(e => [e.id, makeUsageIdentity(e)]));
    const usageIdentity = (entry: SessionEntry) => identities.get(entry.id);
    const allById = new Map<string, unknown[]>();
    for (const r of all) if (object(r) && typeof r.id === 'string') {
      const group = allById.get(r.id) ?? []; group.push(r); allById.set(r.id, group);
    }
    const authenticUsage = (raw: unknown, entry: SessionEntry) => {
      const parsed = validateRecord(raw); const expected = usageIdentity(entry);
      if (!parsed.ok || !expected || parsed.record.id !== `usage:${entry.id}` || parsed.record.anchor !== entry.id ||
          parsed.record.kind !== 'lifecycle' || parsed.record.data.event !== 'usage') return false;
      const details = parsed.record.data.details;
      return details?.operationId === expected.operationId && details?.category === expected.category &&
        details?.status === expected.status && canonical(details?.usage) === canonical(expected.usage);
    };
    const accounting: RecordEnvelope[] = [];
    for (const entry of usageEntries) if (!(allById.get(`usage:${entry.id}`) ?? []).some(r => authenticUsage(r, entry))) {
      const message = entry.type === 'message' && entry.message.role === 'assistant' ? entry.message : undefined;
      const times = message ? completedTiming.get(hash(message)) : undefined;
      accounting.push(record(`usage:${entry.id}`, entry.id, 'lifecycle', { event: 'usage', details: {
        ...usageIdentity(entry), ...(message ? { model: message.model, provider: message.provider } : {}),
        wallMs: times?.shift() ?? null, billedCost: null,
      } }));
      if (message && !times?.length) completedTiming.delete(hash(message));
    }
    append(accounting);
    all.push(...accounting);
    // Raw native text, not a persisted model-authored record, authenticates user indexes.
    const checked = all.map(r => {
      const usageId = object(r) && typeof r.id === 'string' && r.id.startsWith('usage:') ? r.id.slice(6) :
        object(r) && object(r.data) && r.data.event === 'usage' && object(r.data.details) && typeof r.data.details.operationId === 'string'
          ? r.data.details.operationId : undefined;
      const usageEntry = usageId && identities.has(usageId) ? nativeById.get(usageId) : undefined;
      if (usageEntry && !authenticUsage(r, usageEntry) && object(r)) return { ...r, schemaVersion: -1 };
      // An invalid/wrong-kind collision must not reserve the canonical source ID.
      const canonical = object(r) && typeof r.id === 'string' ? capturedById.get(r.id) : undefined;
      if (canonical && !authentic(r, canonical) && object(r)) return { ...r, schemaVersion: -1 };
      if (object(r) && r.kind === 'user_source' && object(r.data)) {
        const data = r.data;
        const entry = typeof data.entryId === 'string' ? nativeById.get(data.entryId) : undefined;
        const derived = typeof r.anchor === 'string' ? capturedByAnchor.get(r.anchor) : undefined;
        if (!entry || entry.type !== 'message' || entry.message.role !== 'user' ||
            nativeEntryText(entry) !== r.data.text || !derived || !authentic(r, derived)) return { ...r, schemaVersion: -1 };
      }
      if (object(r) && r.kind === 'observation' && object(r.data)) {
        const derived = typeof r.anchor === 'string' ? capturedByAnchor.get(r.anchor) : undefined;
        if (!derived || !authentic(r, derived)) return { ...r, schemaVersion: -1 };
      }
      if (object(r) && r.kind === 'lifecycle' && object(r.data) && r.data.event === 'checkpoint') {
        const details = r.data.details;
        if (!object(details) || typeof details.requestId !== 'string' ||
            r.id !== `checkpoint:${details.requestId}:receipt` || !Array.isArray(details.recordIds))
          return { ...r, schemaVersion: -1 };
        const entry = entries.find(e => e.id === r.anchor);
        const call = entry?.type === 'message' && entry.message.role === 'assistant' ? entry.message.content.find(c =>
          c.type === 'toolCall' && c.name === 'context_checkpoint' && c.arguments.requestId === details.requestId &&
          hash(c.arguments) === details.digest && hash(c.arguments.consideredIds ?? []) === hash(details.consideredIds)) : undefined;
        const success = call?.type === 'toolCall' && entries.some(e => e.type === 'message' &&
          e.message.role === 'toolResult' && e.message.toolCallId === call.id && !e.message.isError);
        if (!success) return { ...r, schemaVersion: -1 };
      }
      return r;
    });
    const state = rebuild(checked, new Set(entries.map(e => e.id)));
    const stateIds = new Set(state.records.map(r => r.id));
    const previousReads = new Map<string, RecordEnvelope & { kind: 'observation' }>();
    for (const r of state.records) if (r.kind === 'observation' && r.data.toolName === 'read' && r.data.path) {
      const previous = previousReads.get(r.data.path);
      const entry = nativeById.get(r.data.entryId);
      const id = `read-comparison:${r.id}`;
      if (previous && entry && !r.data.partial && r.data.outcome === 'success' && !stateIds.has(id)) {
        append([record(id, r.anchor, 'lifecycle', { event: 'freshness-comparison', details: {
          previousId: previous.id, currentId: r.id, freshness: compareSpan(previous.data, nativeEntryText(entry)),
          note: 'Comparison at this native read only; later filesystem currency remains unknown',
        } })]);
      }
      previousReads.set(r.data.path, r);
    }
    const complete = new Set(entries.flatMap(e => e.type === 'message' && e.message.role === 'toolResult' ? [e.message.toolCallId] : []));
    for (const e of entries) if (e.type === 'message' && e.message.role === 'assistant') {
      for (const c of e.message.content) if (c.type === 'toolCall' && !complete.has(c.id)) {
        state.records.push(record(`unknown:${c.id}`, e.id, 'lifecycle', { event: 'unknown-operation',
          details: { toolCallId: c.id, toolName: c.name, outcome: 'unknown', instruction: 'Do not automatically replay' } }));
      }
    }
    return state;
  }
  function activate() {
    const current = pi.getActiveTools().filter(name => !TOOL_NAMES.includes(name));
    pi.setActiveTools(mode === 'organized' ? [...current, ...TOOL_NAMES] : current);
  }
  function restore(ctx: ExtensionContext) {
    generation++;
    recalled.clear(); toolStarts.clear(); completedTiming.clear(); turnStarted = undefined; compactionStarted = undefined; omitted = [];
    const records = rawRecords(branch(ctx));
    const saved = records.filter(object).findLast(r => r.kind === 'lifecycle' && object(r.data) && r.data.event === 'mode');
    const parsedMode = validateRecord(saved);
    const savedMode = parsedMode.ok && parsedMode.record.kind === 'lifecycle' &&
      Object.keys(parsedMode.record.data.details ?? {}).length === 1 ? parsedMode.record.data.details?.mode : undefined;
    mode = savedMode === 'off' ? 'off' : 'organized';
    activate();
    if (mode === 'organized') sync(ctx);
  }
  pi.on('session_start', (_e, ctx) => restore(ctx));
  pi.on('session_tree', (_e, ctx) => restore(ctx));
  pi.on('session_shutdown', () => { generation++; recalled.clear(); });
  pi.on('turn_start', () => { turnStarted = performance.now(); });
  pi.on('session_before_compact', () => { compactionStarted = performance.now(); });
  pi.on('session_compact', (event, ctx) => {
    recalled.clear();
    if (mode === 'organized') {
      append([record(`usage:${event.compactionEntry.id}`, event.compactionEntry.id, 'lifecycle', { event: 'usage', details: {
        operationId: event.compactionEntry.id, category: 'native-compaction', status: 'succeeded',
        usage: normalizePiUsage(event.compactionEntry.usage ?? null, 'succeeded'),
        wallMs: compactionStarted === undefined ? null : performance.now() - compactionStarted, billedCost: null,
      } })]);
    }
    compactionStarted = undefined;
  });
  pi.on('session_compact_failed', (event, ctx) => {
    if (mode === 'organized') lifecycle(ctx, 'usage', { operationId: randomUUID(), category: 'native-compaction',
      status: 'failed', usage: normalizePiUsage(null, 'failed'), error: event.errorMessage ?? 'cancelled',
      wallMs: compactionStarted === undefined ? null : performance.now() - compactionStarted, billedCost: null });
    compactionStarted = undefined;
  });
  pi.on('tool_execution_start', (event, ctx) => {
    if (mode === 'off') return;
    toolStarts.set(event.toolCallId, performance.now());
    lifecycle(ctx, 'tool-start', { toolCallId: event.toolCallId, toolName: event.toolName, outcome: 'unknown' });
  });
  pi.on('tool_execution_end', (event, ctx) => {
    if (mode === 'off') return;
    const start = toolStarts.get(event.toolCallId);
    lifecycle(ctx, 'tool-outcome', { toolCallId: event.toolCallId, toolName: event.toolName,
      status: event.isError ? 'failed' : 'succeeded', wallMs: start === undefined ? null : performance.now() - start });
    toolStarts.delete(event.toolCallId);
  });
  pi.on('message_end', (event, ctx) => {
    if (mode === 'off') return;
    if (event.message.role === 'assistant') {
      const key = hash(event.message);
      const times = completedTiming.get(key) ?? [];
      times.push(turnStarted === undefined ? null : performance.now() - turnStarted);
      completedTiming.set(key, times);
      turnStarted = undefined;
    }
    sync(ctx);
  });
  pi.on('agent_settled', (_event, ctx) => { if (mode === 'organized') sync(ctx); });
  pi.on('before_agent_start', (event) => mode === 'organized'
    ? { systemPrompt: `${event.systemPrompt}\n\n${GUIDANCE}` } : undefined);
  pi.on('context', (event, ctx) => {
    if (mode === 'off') return;
    const selectionStart = performance.now();
    const state = sync(ctx);
    const native = event.messages.filter(m => !(m.role === 'custom' && m.customType === PROJECTION_TYPE));
    const tools = pi.getAllTools().filter(t => pi.getActiveTools().includes(t.name));
    const budget = { window: ctx.model?.contextWindow ?? 0,
      // Include summary wrapping and the projection message envelope before selection.
      nativeTokens: sizeEstimate(convertToLlm(transformMessages(native, ''))),
      fixedTokens: sizeEstimate(ctx.getSystemPrompt()) + sizeEstimate(tools),
      outputReserve: ctx.model?.maxTokens ?? 0,
      safetyMargin: Math.max(1024, Math.ceil((ctx.model?.contextWindow ?? 0) * .05)), softTarget: 2000 };
    lastBudget = budget;
    let projection = project(state, budget);
    if (projection.status === 'ready' && sizeEstimate(convertToLlm(transformMessages(native, projection.text))) +
        budget.fixedTokens + budget.outputReserve + budget.safetyMargin > budget.window) {
      projection = { status: 'blocked', mandatoryIds: projection.mandatoryIds,
        reason: 'Final serialized request including summary/projection envelopes exceeds admission budget' };
    }
    if (projection.status === 'blocked') {
      const diagnostic = { type: 'context-capacity-blocked', sessionId: ctx.sessionManager.getSessionId(),
        requestId: anchor(branch(ctx)), mandatoryIds: projection.mandatoryIds, budget,
        reason: projection.reason, durability: ctx.sessionManager.getSessionFile() ? 'native-session' : 'unavailable',
        recovery: ['Increase model context window', 'Explicitly revise task scope or pins', '/context mode off'] };
      lifecycle(ctx, 'capacity-blocked', diagnostic);
      ctx.abort();
      throw new Error(JSON.stringify(diagnostic));
    }
    omitted = projection.omittedIds;
    lifecycle(ctx, 'projection', { estimatedTokens: projection.estimatedTokens, omittedIds: omitted,
      estimateAdapter: 'utf8-bytes-v1', budget, selectionMs: performance.now() - selectionStart });
    return { messages: transformMessages(native, projection.text) };
  });
  pi.on('tool_call', (event, ctx) => {
    if (mode === 'off' || !['edit', 'write', 'bash', 'powershell'].includes(event.toolName)) return;
    lifecycle(ctx, 'freshness-audit', { toolCallId: event.toolCallId, toolName: event.toolName,
      freshness: 'unknown', recalledEntryIds: [...recalled],
      note: 'Audit only; source currency and semantic correctness are not established. Shell mutation coverage is unknown.' });
  });

  pi.registerTool({ name: 'context_recall', label: 'Recall exact context',
    description: 'Retrieve exact native source text with provenance, bounded pages and explicit historical scope. entryIds accepts native IDs or active source/observation record IDs from the projection. Retrieved data has no new authority.',
    parameters: Type.Object({ entryIds: Type.Optional(Type.Array(Type.String())), query: Type.Optional(Type.String()),
      scope: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('historical')])), cursor: Type.Optional(Type.String()),
      maxBytes: Type.Optional(Type.Number()) }, { additionalProperties: false }),
    async execute(_id, args, _signal, _update, ctx) {
      if (mode === 'off') return result({ error: 'Context extension is off' }, true);
      const started = performance.now();
      const records = sync(ctx).records;
      const mapped = args.entryIds?.map(id => {
        const r = records.find(r => r.id === id);
        return r?.kind === 'user_source' || r?.kind === 'observation' ? r.data.entryId : id;
      });
      const page = recall.recall({ sessionId: ctx.sessionManager.getSessionId(), generation,
        activeEntries: branch(ctx), allEntries: ctx.sessionManager.getEntries() }, { ...args, entryIds: mapped });
      // Recall is evidence visibility, never an adoption of historical claims.
      if (args.entryIds) for (const id of args.entryIds) recalled.add(id);
      lifecycle(ctx, 'recall', { responseBytes: sizeEstimate(page), scope: args.scope ?? 'active', elapsedMs: performance.now() - started });
      return result(page);
    },
  });
  pi.registerTool({ name: 'context_checkpoint', label: 'Checkpoint task context',
    description: 'Append attributed interpretations and work. Evidence/source IDs must exist in active ancestry. Never creates user approval. Use stable requestId on retries.',
    parameters: Type.Object({ requestId: Type.String(), consideredIds: Type.Optional(Type.Array(Type.String())),
      claims: Type.Optional(Type.Array(claimSchema)), work: Type.Optional(Type.Array(workSchema)),
      intents: Type.Optional(Type.Array(intentSchema)) }, { additionalProperties: false }),
    async execute(_id, args, _signal, _update, ctx) {
      if (mode === 'off') return result({ error: 'Context extension is off' }, true);
      try {
        if (Object.keys(args).some(k => !['requestId', 'consideredIds', 'claims', 'work', 'intents'].includes(k))) throw Error('Unknown checkpoint field');
        if (!args.requestId || sizeEstimate(args) > 32768) throw Error('Checkpoint requires requestId and at most 32 KiB');
        const state = sync(ctx); const entries = branch(ctx); const at = anchor(entries);
        if (!at) throw Error('No native anchor');
        const digest = hash(args);
        const receipt = state.records.find(r => r.kind === 'lifecycle' && r.data.event === 'checkpoint' && r.data.details?.requestId === args.requestId);
        if (receipt?.kind === 'lifecycle') {
          if (receipt.data.details?.digest !== digest) throw Error('requestId already used for different content');
          return result({ status: 'already-recorded', recordIds: receipt.data.details?.recordIds });
        }
        const known = new Set(state.records.map(r => r.id));
        const sourceRecordId = (id: string) => state.records.find(r =>
          (r.kind === 'user_source' || r.kind === 'observation') && r.data.entryId === id)?.id ?? id;
        const consideredIds = args.consideredIds ?? [];
        for (const id of consideredIds) if (!entries.some(e => e.id === id && e.type === 'message' && e.message.role === 'user')) throw Error(`Unknown user anchor: ${id}`);
        const additions: RecordEnvelope[] = [];
        const add = (kind: 'claim' | 'work' | 'intent', payload: unknown, ordinal: number) => {
          if (!object(payload)) throw Error(`Invalid ${kind}`);
          const id = `checkpoint:${args.requestId}:${kind}:${ordinal}`;
          const normalized = kind === 'claim' ? { ...payload,
            evidenceIds: Array.isArray(payload.evidenceIds) ? payload.evidenceIds.map(v => typeof v === 'string' ? sourceRecordId(v) : v) : payload.evidenceIds,
            counterEvidenceIds: Array.isArray(payload.counterEvidenceIds) ? payload.counterEvidenceIds.map(v => typeof v === 'string' ? sourceRecordId(v) : v) : payload.counterEvidenceIds,
          } : kind === 'intent' && typeof payload.sourceId === 'string' ? { ...payload, sourceId: sourceRecordId(payload.sourceId) } : payload;
          const candidate = record(id, at, kind, normalized);
          if (candidate.kind === 'intent') {
            if (candidate.data.author !== 'model' || candidate.data.pinned) throw Error('Model cannot create user pins or approval');
            const source = state.records.find(r => r.id === candidate.data.sourceId && r.kind === 'user_source');
            if (!source) throw Error('Unknown intent source');
          }
          if (candidate.kind === 'claim') for (const id of [...candidate.data.evidenceIds, ...candidate.data.counterEvidenceIds]) {
            if (!known.has(id)) throw Error(`Unknown active evidence record: ${id}`);
          }
          if ((candidate.kind === 'claim' || candidate.kind === 'work') && candidate.data.supersedes) {
            if (!state.records.some(r => r.id === candidate.data.supersedes && r.kind === candidate.kind)) throw Error('Unknown or wrong-kind supersession');
          }
          additions.push(candidate);
        };
        (args.claims ?? []).forEach((p, i) => add('claim', p, i));
        (args.work ?? []).forEach((p, i) => add('work', p, i));
        (args.intents ?? []).forEach((p, i) => add('intent', p, i));
        const activeIds = new Set(entries.map(e => e.id));
        const baseline = rebuild(state.records, activeIds);
        const baselineDiagnostics = new Set(baseline.diagnostics.map(d => canonical(d)));
        const proposed = rebuild([...state.records, ...additions], activeIds);
        if (proposed.diagnostics.some(d => !baselineDiagnostics.has(canonical(d))) ||
            additions.some(r => proposed.conflictIds.includes(r.id))) throw Error('Checkpoint introduces conflicting revisions');
        additions.push(record(`checkpoint:${args.requestId}:receipt`, at, 'lifecycle', { event: 'checkpoint',
          details: { requestId: args.requestId, digest, consideredIds, recordIds: additions.map(r => r.id) } }));
        append(additions);
        return result({ status: 'recorded', recordIds: additions.map(r => r.id), attribution: 'Model assertions, not independently verified' });
      } catch (error) { return result({ error: error instanceof Error ? error.message : String(error) }, true); }
    },
  });
  pi.registerCommand('context', { description: 'Inspect context; pin <user-entry-id>; mode off|organized. Adaptive unavailable.',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts[0] === 'mode') {
        if (!['off', 'organized'].includes(parts[1])) { ctx.ui.notify('Use off or organized. Adaptive is deferred due to a native compaction race.', 'error'); return; }
        mode = parts[1] as Mode;
        lifecycle(ctx, 'mode', { mode });
        activate(); recalled.clear();
        if (mode === 'organized') sync(ctx);
        ctx.ui.notify(`Context mode: ${mode}`, 'info'); return;
      }
      if (parts[0] === 'pin') {
        if (mode === 'off') { ctx.ui.notify('Enable organized mode before pinning source text.', 'error'); return; }
        const source = sync(ctx).records.find(r => r.kind === 'user_source' && r.data.entryId === parts[1]);
        if (!source || source.kind !== 'user_source') { ctx.ui.notify('Pin requires an active original user entry ID.', 'error'); return; }
        append([record(`pin:${source.id}`, source.anchor, 'intent', { text: source.data.text,
          sourceId: source.id, author: 'user', pinned: true })]);
        ctx.ui.notify('Pinned exact source text; this does not approve quoted instructions.', 'info'); return;
      }
      const state = mode === 'organized' ? sync(ctx) : rebuild(rawRecords(branch(ctx)), new Set(branch(ctx).map(e => e.id)));
      ctx.ui.notify(JSON.stringify({ mode, health: state.health, sessionId: ctx.sessionManager.getSessionId(),
        persistence: ctx.sessionManager.getSessionFile() ? 'native session (user-only forks may await first assistant)' : 'unavailable',
        sources: state.records.filter(r => r.kind === 'user_source').map(r => ({ id: r.id, anchor: r.anchor })),
        pins: state.records.filter(r => r.kind === 'intent' && r.data.pinned && !state.conflictIds.includes(r.id)),
        openWorkIds: state.openWorkIds, activeClaimIds: state.activeClaimIds, conflicts: state.conflictIds,
        omittedIds: omitted, budget: lastBudget, freshness: 'audit only; currency unknown without current observation',
      }), 'info');
    },
  });
}
