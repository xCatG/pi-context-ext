import { convertToLlm, estimateTokens, type ContextEvent } from '@earendil-works/pi-coding-agent';
import { PROJECTION_TYPE, sizeEstimate } from './projection.ts';

export const ADMISSION_ADAPTER = 'pi-content-heuristic-with-extension-byte-bounds-v2';

/** Planning estimate, not a provider tokenizer or a capacity guarantee.
 * Convert native summaries/bash/custom messages first so their visible wrappers
 * count. Opaque signatures, usage and timestamps stay in the outgoing messages
 * but are not mistaken for ordinary text tokens. Never reuse prior usage.
 */
export function estimateRequestMessages(messages: ContextEvent['messages']): number {
  let total = 0;
  for (const original of messages) {
    for (const message of convertToLlm([original])) {
      const blocks = typeof message.content === 'string' ? 1 : message.content.length;
      const extensionOwned = (original.role === 'custom' && original.customType === PROJECTION_TYPE) ||
        (original.role === 'toolResult' && original.toolName === 'context_recall');
      const content = estimateTokens(message);
      // Extension-owned content includes its JSON/string escaping on later turns.
      total += (extensionOwned ? Math.max(content, sizeEstimate(message.content)) : content) + 32 + 8 * blocks;
    }
  }
  return total;
}
