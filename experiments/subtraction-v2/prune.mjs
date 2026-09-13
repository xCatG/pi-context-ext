import { createHash } from 'node:crypto';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

// Frozen experimental policy. o200k_base of this JSON proxy is not provider billing.
export const defaults = Object.freeze({ chunkTokens: 8000, keepTokens: 4000 });
export function visible(message) {
  if (message.role === 'compactionSummary' || message.role === 'branchSummary')
    return { role: message.role, summary: message.summary };
  if (message.role === 'bashExecution') return { role: message.role, command: message.command,
    output: message.output, exitCode: message.exitCode, cancelled: message.cancelled,
    truncated: message.truncated, fullOutputPath: message.fullOutputPath, excludeFromContext: message.excludeFromContext };
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
  return { role: message.role, toolCallId: message.toolCallId, toolName: message.toolName,
    content: blocks.map(block => block.type === 'text' ? { type: block.type, text: block.text }
      : block.type === 'thinking' ? { type: block.type, thinking: block.thinking }
        : block.type === 'toolCall' ? { type: block.type, id: block.id, name: block.name, arguments: block.arguments }
          : { type: block.type }) };
}
export const count = messages => encode(JSON.stringify(messages.map(visible))).length;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function ancestry(entries, leafId) {
  if (leafId === null) return [];
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) return null;
    byId.set(entry.id, entry);
  }
  const result = [], seen = new Set();
  let id = leafId;
  while (id !== null) {
    const entry = byId.get(id);
    if (!entry || seen.has(id)) return null;
    seen.add(id); result.push(entry); id = entry.parentId;
  }
  return result.reverse();
}

function fullRead(message, calls) {
  if (message.role !== 'toolResult' || message.toolName !== 'read' || message.isError !== false) return null;
  const call = calls.get(message.toolCallId), args = call?.arguments;
  if (call?.name !== 'read' || typeof args?.path !== 'string' || !args.path ||
      Object.keys(args).some(key => key !== 'path')) return null;
  if (message.details?.truncation?.truncated || message.details?.truncation?.firstLineExceedsLimit) return null;
  if (!Array.isArray(message.content) || message.content.length !== 1 || message.content[0].type !== 'text') return null;
  const text = message.content[0].text;
  if (typeof text !== 'string' || /^Read image file|\[Showing lines |\[\d+ more lines in file|exceeds .* limit\. Use bash:/m.test(text)) return null;
  return { path: args.path, text, id: message.toolCallId };
}

/**
 * event.messages is the sole source of currently visible text and witnesses.
 * Branch ancestry supplies native call arguments, never resurrected result text.
 * No session writes, filesystem reads, summary overrides or persistent state.
 */
export function prune({ branchEntries, messages, leafId }, policy = defaults) {
  if (!Number.isInteger(policy.chunkTokens) || policy.chunkTokens <= 0 ||
      !Number.isInteger(policy.keepTokens) || policy.keepTokens < 0) throw Error('Invalid pruning policy');
  const unchanged = { original: messages, messages, replacements: [], boundaryId: null };
  const branch = ancestry(branchEntries, leafId);
  if (!branch?.length) return unchanged;
  const calls = new Map(), ambiguous = new Set();
  for (const entry of branch) {
    const message = entry.message;
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) if (block.type === 'toolCall') {
      if (calls.has(block.id)) ambiguous.add(block.id);
      else calls.set(block.id, block);
    }
  }
  for (const id of ambiguous) calls.delete(id);

  // Recompute boundaries from CURRENT native context, not historical entries.
  // A compaction starts a new visible-context epoch. Appends below the next
  // threshold cannot become witnesses or move the protected suffix cutoff.
  let sum = 0, boundary = -1, boundarySize = 0, chunk = 0;
  const ends = messages.map((message, i) => {
    sum += count([message]);
    const next = Math.floor(sum / policy.chunkTokens);
    if (next > chunk) { boundary = i; boundarySize = sum; chunk = next; }
    return sum;
  });
  if (boundary < 0) return unchanged;
  const boundaryId = digest(messages.slice(0, boundary + 1).map(visible));
  const resultIds = new Set(), repeatedIds = new Set();
  for (const message of messages) if (message.role === 'toolResult') {
    if (resultIds.has(message.toolCallId)) repeatedIds.add(message.toolCallId);
    resultIds.add(message.toolCallId);
  }
  const reads = [];
  for (let i = 0; i <= boundary; i++) {
    const read = fullRead(messages[i], calls);
    if (read && !repeatedIds.has(read.id)) reads.push({ ...read, i });
  }
  // Reverse traversal keeps the last exact matching full read. Every omitted
  // predecessor points directly to that retained witness, never a stub chain.
  const retained = new Map(), changed = new Map(), replacements = [];
  for (let j = reads.length - 1; j >= 0; j--) {
    const read = reads[j];
    let versions = retained.get(read.path);
    if (!versions) { versions = new Map(); retained.set(read.path, versions); }
    const witness = versions.get(read.text);
    if (!witness) { versions.set(read.text, read); continue; }
    if (ends[read.i] > boundarySize - policy.keepTokens) continue;
    const content = [{ type: 'text', text: `[Duplicate full read omitted; identical full text retained in read result ${witness.id}.]` }];
    if (count([{ ...messages[read.i], content }]) >= count([messages[read.i]])) continue;
    changed.set(read.i, content);
    replacements.push({ toolCallId: read.id, witness: witness.id });
  }
  replacements.reverse();
  const transformed = messages.map((message, i) => changed.has(i) ? { ...message, content: changed.get(i) } : message);
  // Per-message proxy costs are not additive; also enforce whole-input savings.
  if (!changed.size || count(transformed) > count(messages)) return { ...unchanged, boundaryId };
  return { original: messages, messages: transformed, replacements, boundaryId };
}
