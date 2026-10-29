import { createInterface } from 'node:readline';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { _electron } from '@playwright/test';
import { invokePage } from './page-command.mjs';

export async function launchDesktop({ output, userData, visible = false, executablePath } = {}) {
  const args = ['--automation', '--user-data', userData, '--export-directory', output];
  if (!visible) args.push('--hidden');
  const environment = { ...process.env, MENGX_DEV_URL: '' };
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [...(executablePath ? [] : ['.']), ...args],
    ...(executablePath ? { executablePath } : {}), cwd: process.cwd(),
    env: environment, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.mengxReader && window.mengxDesktop), null, { timeout: 30000 });
  return { app, page };
}

export async function invokeDesktop(app, page, method, args = []) {
  if (['openPath', 'openFolderPath', 'openReferencePath', 'openTab'].includes(method) && typeof args[0] === 'string') {
    const filename = path.resolve(args[0]);
    await app.evaluate(async (_electron, filename) => globalThis.mengxAutomation.grant(filename), filename);
    args = [filename];
  }
  return invokePage(page, method, args);
}

export async function runDesktopSession(options = []) {
  const option = (name, fallback) => { const index = options.indexOf(name); return index >= 0 ? options[index + 1] : fallback; };
  const output = path.resolve(option('--output', 'test-fixtures/results/desktop-automation'));
  await mkdir(output, { recursive: true });
  const userData = path.resolve(option('--profile', await mkdtemp(path.join(os.tmpdir(), 'mengx-session-'))));
  const { app, page } = await launchDesktop({ output, userData, visible: options.includes('--visible'), executablePath: option('--executable') });
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  page.on('pageerror', (error) => send({ event: 'error', error: error.message }));
  send({ event: 'ready', desktop: true, version: await page.evaluate(() => window.mengxReader.version), output, profile: userData });
  const pending = new Set();
  try {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      let command;
      try { command = JSON.parse(line); } catch (error) { send({ ok: false, error: error.message }); continue; }
      const task = (async () => {
        try {
          let result;
          if (command.method === 'capture') {
            const target = path.join(output, path.basename(command.args?.[0] || 'reader.png'));
            await page.screenshot({ path: target });
            result = { ok: true, path: target };
          } else result = await invokeDesktop(app, page, command.method, command.args || []);
          send({ id: command.id, ok: result?.ok !== false, result,
            ...(result?.ok === false ? { error: result.error, code: result.code } : {}),
            ...(command.method?.startsWith('export') && result?.path ? { downloads: [result.path] } : {}) });
        } catch (error) { send({ id: command.id, ok: false, error: error.message, code: error.code || error.name }); }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    await Promise.all(pending);
    const state = await page.evaluate(async () => {
      if (window.mengxReader.getState().document.dirty && window.mengxReader.getState().document.canSave) await window.mengxReader.save();
      return window.mengxReader.getState();
    });
    if (state.document.dirty) send({ event: 'warning', error: 'unsaved-session-content' });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}
