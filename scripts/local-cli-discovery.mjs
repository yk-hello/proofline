// Observational check against this computer, using a fresh Electron profile.
// No executable paths, argument overrides, custom tools or credentials are supplied.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { _electron } from '@playwright/test';
import { invokeDesktop } from './desktop-session.mjs';

const output = path.resolve('test-fixtures/results/local-cli-' + Date.now());
await mkdir(output, { recursive: true });
const environment = { ...process.env, MENGX_DEV_URL: '' };
delete environment.ELECTRON_RUN_AS_NODE;
const mode = process.argv.includes('--registered-path') && process.platform === 'win32' ? 'windows-registered-path' : 'inherited-path';
if (mode === 'windows-registered-path') {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = '[Console]::Out.Write([Environment]::ExpandEnvironmentVariables(([Environment]::GetEnvironmentVariable("Path","Machine")+";"+[Environment]::GetEnvironmentVariable("Path","User"))))';
  const { stdout } = await promisify(execFile)(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
  for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PATH') delete environment[key];
  environment.Path = stdout.trim();
}
const report = { host: process.platform, arch: process.arch, mode, otherEnvironment: 'inherited; only PATH normalized in registered-path mode', output, manualOverrides: {}, probes: [], edits: [], errors: [] };
let app, page;
try {
  const startedAt = Date.now();
  app = await _electron.launch({ args: ['.', '--automation', '--hidden', '--user-data', path.join(output, 'profile'), '--export-directory', output], cwd: process.cwd(), env: environment, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.mengxDesktop && window.prooflineReader), null, { timeout: 30000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => {
    const section = document.querySelector('.setup-step.ai');
    return section && (section.querySelector('.setup-chips') || [...section.querySelectorAll('.setup-muted')].some(item => !/正在检测|Checking/.test(item.textContent)));
  }, null, { timeout: 90000 });
  report.discoveryMs = Date.now() - startedAt;
  report.firstRunText = await page.locator('.setup-step.ai').innerText();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('redline-agent-settings-v1') || '{}'));
  assert.deepEqual(settings.overrides || {}, {});
  assert.deepEqual(settings.customs || [], []);
  report.tools = await page.evaluate(() => window.mengxDesktop.agents.detect({}, false));
  report.discovered = report.tools.filter(item => item.available).map(item => item.id);
  await page.screenshot({ path: path.join(output, 'first-run.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: 'automatic-first-run', mode, discoveryMs: report.discoveryMs, tools: report.tools.map(({ id, available, path, version, auth, compatibility }) => ({ id, available, path, version, auth, compatibility })), output }));
  if (process.argv.includes('--probe-others') || process.argv.includes('--edit-others')) {
    for (const item of report.tools.filter(item => item.available && item.id !== 'gemini')) {
      const begin = Date.now();
      const result = await page.evaluate(id => window.mengxDesktop.agents.probe({ id, overrides: {} }), item.id);
      report.probes.push({ id: item.id, elapsedMs: Date.now() - begin, result });
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ phase: 'probe', ...report.probes.at(-1) }));
      if (process.argv.includes('--edit-others') && result.ok) {
        if (await page.locator('.setup-dialog').count()) await page.locator('.setup-dialog .dialog-actions .primary-button').click();
        const file = path.join(output, item.id + ' automatic 中文.md');
        const original = '# Automatic CLI verification\n\nThe cost is 10.\n\nKeep this paragraph unchanged.\n';
        await writeFile(file, original);
        const invoke = (method, args = []) => invokeDesktop(app, page, method, args);
        await invoke('openPath', [file]);
        const mark = await invoke('addNote', [{text:'The cost is 10.',note:'Change exactly 10 to 20. Keep all other text unchanged.'}]);
        await invoke('updateAnnotation', [mark.id, {type:'fix',status:'open'}]);
        await page.locator('.rail-tabs button').first().click();
        await page.locator('.rail-item-send').first().click();
        await page.locator('.send-dialog').waitFor();
        await page.locator('.agent-option').filter({hasText:item.name}).click({timeout:40000});
        await page.locator('.send-dialog .dialog-actions .primary-button').click();
        await page.waitForFunction(() => document.querySelector('.review-view') || document.querySelector('.run-panel.failed'), null, {timeout:180000});
        if (await page.locator('.run-panel.failed').count()) throw new Error(item.name + ': ' + await page.locator('.run-panel.failed').innerText());
        assert.equal(await readFile(file,'utf8'), original, 'Source must stay unchanged before acceptance');
        const reviewHunks = await page.locator('.review-hunk').count();
        assert.ok(reviewHunks, 'The CLI must actually edit the disposable document');
        await page.screenshot({path:path.join(output,item.id+'-review.png')});
        await page.locator('.review-bar').getByRole('button',{name:'全部接受',exact:true}).click();
        await page.locator('.review-bar .primary-button').click();
        await page.locator('.review-view').waitFor({state:'detached'});
        await page.waitForFunction(() => !window.prooflineReader.getState().document.dirty && window.prooflineReader.getState().document.saveState.status==='saved');
        assert.equal(await readFile(file,'utf8'),original.replace('10','20'));
        const history = await page.evaluate(() => window.mengxDesktop.agents.history());
        const run = history.find(run => run.documentPath===file);
        assert.ok(run);
        const snapshot = JSON.parse(await readFile(path.join(output,'profile','ProoflineData','runs',run.id+'.json'),'utf8'));
        assert.equal(snapshot.executable,item.path);
        report.edits.push({id:item.id,executable:snapshot.executable,code:snapshot.code,reviewHunks,sourceUnchangedBeforeAcceptance:true,acceptedFileEqualsExpected:true,durationMs:snapshot.finishedAt-snapshot.startedAt});
        await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify({phase:'disposable-document',...report.edits.at(-1)}));
      }
    }
  }
  report.status = 'completed';
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  if (app) {
    if (page) await page.evaluate(async () => { for (const run of await window.mengxDesktop.agents.history()) if (run.status==='running') await window.mengxDesktop.agents.cancel(run.id); }).catch(() => {});
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, discovered: report.discovered, probes: report.probes, edits:report.edits, output }));
}
