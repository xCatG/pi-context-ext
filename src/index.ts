import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { prune } from './prune.mjs';

export default function subtractionExperiment(pi: ExtensionAPI) {
  pi.on('context', (event, ctx) => {
    const result = prune({ messages: event.messages, branchEntries: ctx.sessionManager.getBranch(),
      leafId: ctx.sessionManager.getLeafId() });
    return { messages: result.messages };
  });
}
