import { writeFileSync } from 'node:fs';
import { AgentSessionRuntime, InteractiveMode, runPrintMode, runRpcMode } from '@earendil-works/pi-coding-agent';
import { createFixture } from './native-session.ts';
import contextExtension from '../../src/index.ts';

// Separate process exercises Pi's real stdout/stderr and mode exit behavior.
const mode = process.argv[2];
const reportPath = process.argv[3];
const product = process.argv[4] === 'product';
const extension = product ? contextExtension : (pi: Parameters<typeof contextExtension>[0]) => {
  pi.on('context', (_event, ctx) => {
    const diagnostic = { type: 'context-capacity-blocked',
      requestId: ctx.sessionManager.getLeafId(),
      mandatoryIds: ['user-source-1'], budget: { requiredTokens: 1200, availableTokens: 1000 } };
    pi.appendEntry('capacity-qualification-diagnostic', diagnostic);
    ctx.abort();
    throw new Error(JSON.stringify(diagnostic));
  });
  if (mode === 'tui') pi.on('agent_settled', (_event, ctx) => {
    // Allow the native renderer to flush; shutdown is a supported extension action.
    setTimeout(() => ctx.shutdown(), 100);
  });
};
const fixture = await createFixture(extension, { persistent: true, contextWindow: product ? 8192 : 65536 });
const prompt = product ? 'preserve capacity request '.repeat(500) : 'preserve capacity request';
const host = new AgentSessionRuntime(fixture.session, {
  cwd: fixture.cwd, agentDir: fixture.agentDir, modelRuntime: fixture.modelRuntime,
  settingsManager: fixture.settingsManager, resourceLoader: fixture.session.resourceLoader,
  diagnostics: [],
}, async () => { throw new Error('No replacement requested in this qualification fixture'); });
process.on('exit', () => {
  writeFileSync(reportPath, JSON.stringify({ calls: fixture.captured.length,
    branch: fixture.sessionManager.getBranch(), messages: fixture.session.state.messages }));
});
if (mode === 'tui') {
  if (product) fixture.session.subscribe(event => {
    if (event.type === 'agent_end') setTimeout(() => process.exit(0), 100);
  });
  await new InteractiveMode(host, { initialMessage: prompt,
    verbose: false, tuiMode: 'regular' }).run();
} else if (mode === 'rpc') {
  await runRpcMode(host);
} else {
  process.exitCode = await runPrintMode(host, {
    mode: mode === 'json' ? 'json' : 'text', initialMessage: prompt,
  });
}
