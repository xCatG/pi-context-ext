import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager,
  SettingsManager, type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import {
  fauxProvider, fauxAssistantMessage, InMemoryCredentialStore,
  type Context, type FauxResponseStep,
} from '@earendil-works/pi-ai';

/** Real Pi lifecycle; the only fake is the model boundary. No credentials/network. */
export async function createFixture(
  extension: ExtensionFactory,
  options: { persistent?: boolean; responses?: FauxResponseStep[]; tools?: string[]; sessionFile?: string; contextWindow?: number; extensionPath?: string } = {},
) {
  const root = resolve('.qualification');
  mkdirSync(root, { recursive: true });
  const restoredManager = options.sessionFile ? SessionManager.open(options.sessionFile) : undefined;
  const cwd = restoredManager?.getCwd() ?? mkdtempSync(join(root, 'session-'));
  const agentDir = join(cwd, 'agent');
  mkdirSync(agentDir, { recursive: true });
  const captured: Context[] = [];
  const faux = fauxProvider({
    provider: 'qualification', api: 'qualification',
    models: [{ id: 'scripted', contextWindow: options.contextWindow ?? 65536, maxTokens: 4096 }],
  });
  const scripted = options.responses ?? [fauxAssistantMessage('fixture reply')];
  faux.setResponses(scripted.map((step) => async (context, request, state, model) => {
    // Tool definitions carry execute functions; only clone model-visible data.
    captured.push({ systemPrompt: context.systemPrompt,
      messages: structuredClone(context.messages) });
    return typeof step === 'function' ? step(context, request, state, model) : step;
  }));
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false, keepRecentTokens: 64, reserveTokens: 512 },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true,
    noPromptTemplates: true, noContextFiles: true,
    systemPrompt: 'Provider-free lifecycle qualification. Use the scripted response.',
    extensionFactories: options.extensionPath ? [] : [extension],
    additionalExtensionPaths: options.extensionPath ? [options.extensionPath] : [],
  });
  await loader.reload();
  const sessionManager = restoredManager ?? (options.persistent
    ? SessionManager.create(cwd, join(cwd, 'sessions'))
    : SessionManager.inMemory(cwd));
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, settingsManager, sessionManager,
    resourceLoader: loader, model: faux.getModel(), thinkingLevel: 'off',
    tools: options.tools ?? ['read'],
  });
  const errors: string[] = [];
  await session.bindExtensions({ mode: 'print', onError: (error) => errors.push(error.error) });
  return { session, sessionManager, settingsManager, modelRuntime, cwd, agentDir,
    captured, faux, errors, loader };
}
