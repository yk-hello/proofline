import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';

const output = path.resolve('test-fixtures/results/native/portable-qa');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const designated = process.env.READER_TEST_FILE || 'test-fixtures/ai-report.md';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const executable = path.resolve(process.env.MENGX_PORTABLE_EXECUTABLE || `release/WHITE-FOX-${version}-Windows-x64.exe`);
const hash = async () => createHash('sha256').update(await readFile(designated)).digest('hex');
const originalHash = await hash();
const visible = process.argv.includes('--visible');
const server = createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const environment = { ...process.env, MENGX_DEV_URL: '' };
delete environment.ELECTRON_RUN_AS_NODE;
// The portable launcher does not forward Electron's debugger messages to stdout.
const child = spawn(executable, ['--automation', ...(visible ? [] : ['--hidden']), '--user-data', userData,
  `--remote-debugging-port=${port}`, designated], { env: environment, stdio: 'ignore', windowsHide: true });
let launchError;
child.once('error', (error) => { launchError = error; });
let browser;
const report = { executable, errors: [] };
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, 'Portable launcher exited before the reader was ready');
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000, noDefaults: true }); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, 'Portable reader did not expose its test connection');
  const page = browser.contexts()[0].pages()[0];
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction((name) => window.mengxReader?.getState().document.name === name
    && window.mengxReader.getState().document.ready, path.basename(designated), { timeout: 30000 });
  const invoke = (method, args = []) => page.evaluate(({ method, args }) => window.mengxReader.invoke(method, args), { method, args });
  assert.equal((await invoke('getState')).language, 'zh');
  assert.equal(await page.evaluate(() => Boolean(window.mengxDesktop)), true);
  await invoke('setReadingMode', [true]);
  const search = await invoke('search', ['视觉终端']);
  assert.equal(search.count, 8);
  await invoke('goToMatch', [7]);
  await invoke('closeSearch');
  await invoke('goToHeading', [83]);
  await invoke('scrollTo', ['end']);
  await page.waitForFunction(() => {
    const region = document.querySelector('.reading-scroll-region');
    return region.scrollTop > 1000 && region.scrollHeight - region.clientHeight - region.scrollTop < 30;
  });
  if (visible) await page.screenshot({ path: path.join(output, 'portable.png') });
  report.ok = true;
  report.searchMatches = search.count;
  report.state = await invoke('getState');
  report.performance = await invoke('getPerformanceReport');
  assert.deepEqual(report.errors, []);
  await page.close();
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.pid && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  }
  report.sourceUnchanged = await hash() === originalHash;
  await writeFile(path.join(output, 'portable-report.json'), JSON.stringify(report, null, 2));
  assert.equal(report.sourceUnchanged, true, 'Designated source file must remain unchanged');
}
console.log(JSON.stringify({ ok: report.ok, executable, searchMatches: report.searchMatches,
  sourceUnchanged: report.sourceUnchanged, errors: report.errors }, null, 2));
