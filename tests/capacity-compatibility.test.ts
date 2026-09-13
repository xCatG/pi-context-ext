import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

async function runMode(mode: 'text' | 'json' | 'rpc' | 'tui', product = false) {
  mkdirSync(resolve('.qualification'), { recursive: true });
  const report = join(mkdtempSync(resolve('.qualification/capacity-')), 'report.json');
  const child = spawn(process.execPath, ['tests/fixtures/capacity-cli.ts', mode, report, ...(product ? ['product'] : [])], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  if (mode === 'rpc') {
    child.stdin.write(`${JSON.stringify({ type: 'prompt', id: 'qualification-request', message: product ? 'preserve capacity request '.repeat(500) : 'preserve capacity request' })}\n`);
    child.stdout.on('data', () => {
      if (stdout.includes('agent_end')) child.stdin.end();
    });
  } else child.stdin.end();
  const code = await new Promise<number | null>((resolveCode, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Native ${mode} adapter timed out`)); }, 15000);
    child.on('close', () => clearTimeout(timeout));
    child.on('error', reject); child.on('close', resolveCode);
  });
  writeFileSync(`${report}.stdout`, stdout); writeFileSync(`${report}.stderr`, stderr);
  return { code, stdout, stderr, report: JSON.parse(readFileSync(report, 'utf8')) };
}

test.each(['text', 'json', 'rpc', 'tui'] as const)('native %s adapter characterizes capacity abort', async (mode) => {
  const result = await runMode(mode);
  expect(result.report.calls).toBe(0);
  expect(JSON.stringify(result.report.branch)).toContain('preserve capacity request');
  expect(result.stdout + result.stderr).toContain('context-capacity-blocked');
  const original = result.report.branch.find((entry: any) => entry.message?.role === 'user');
  const diagnostic = result.report.branch.find((entry: any) =>
    entry.customType === 'capacity-qualification-diagnostic')?.data;
  expect(diagnostic).toEqual({ type: 'context-capacity-blocked', requestId: original.id,
    mandatoryIds: ['user-source-1'], budget: { requiredTokens: 1200, availableTokens: 1000 } });
  const terminal = result.report.messages.at(-1);
  expect(terminal).toMatchObject({ role: 'assistant', stopReason: 'error',
    errorMessage: 'This operation was aborted' });
  if (mode === 'text') {
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  }
  if (mode === 'text' || mode === 'json') {
    // Native JSON mode has two channels: terminal failure stdout, typed error stderr.
    const line = result.stderr.split('\n').find((line) => line.startsWith('Extension error '));
    expect(JSON.parse(line!.slice(line!.indexOf('{')))).toEqual(diagnostic);
  }
  if (mode === 'json' || mode === 'rpc') {
    const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    const end = events.find((event) => event.type === 'agent_end');
    expect(end).toMatchObject({ willRetry: false });
    expect(end.messages.at(-1)).toMatchObject({ stopReason: 'error' });
    if (mode === 'rpc') {
      expect(JSON.parse(events.find((event) => event.type === 'extension_error').error)).toEqual(diagnostic);
      // RPC prompt success acknowledges receipt; the terminal event reports execution failure.
      expect(events.find((event) => event.type === 'response')).toMatchObject({ success: true });
    }
  }
}, 20000);

test.each(['text', 'json', 'rpc', 'tui'] as const)('product capacity blocks dispatch in native %s adapter', async mode => {
  const result = await runMode(mode, true);
  expect(result.report.calls).toBe(0);
  expect(JSON.stringify(result.report.branch)).toContain('preserve capacity request '.repeat(500));
  expect(result.stdout + result.stderr).toContain('context-capacity-blocked');
  expect(result.report.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error' });
  if (mode === 'text') expect(result.code).toBe(1);
}, 20000);
