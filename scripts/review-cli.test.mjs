// stetwise-review: the command (with a stand-in for the app) and the app's side of it (the
// real window, started the way the command starts it). Needs `npm run build` for the second part.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'electron', 'review-cli.cjs');
const work = await mkdtemp(path.join(os.tmpdir(), 'stetwise-review-test-'));
const document = path.join(work, 'plan.md');
await writeFile(document, '# Plan\n\nWe will ship in 2 weeks and expect no issues.\n\nThe rollout runs for 48 hours.\n');
const checks = [];

function run(args, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

try {
  // ---- 1. The command, against a stand-in app that answers through the request folder ----
  const fake = path.join(work, 'fake-app.cjs');
  await writeFile(fake, `const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2);const folder=a[a.indexOf('--review-request')+1];
const request=JSON.parse(fs.readFileSync(path.join(folder,'request.json'),'utf8'));const mode=process.env.FAKE_MODE;
if(a[0]!==request.file) process.exit(9);
if(mode==='silent') setTimeout(()=>{},60000);
else setTimeout(()=>{ if(mode!=='closed') fs.writeFileSync(path.join(folder,'reply.md'),mode==='none'?'No changes.':'#1 Fix line 3: say it plainly'); fs.writeFileSync(path.join(folder,'done.json'),JSON.stringify({status:mode})); },300);`);
  const standIn = (mode) => ({ STETWISE_APP: process.execPath, STETWISE_APP_ARGS: JSON.stringify([fake]), FAKE_MODE: mode, ELECTRON_RUN_AS_NODE: '' });
  const notes = await run([document], standIn('notes'));
  assert.equal(notes.code, 0, notes.err); assert.equal(notes.out, '#1 Fix line 3: say it plainly\n'); assert.match(notes.err, /Waiting for the review/);
  const none = await run([document], standIn('none'));
  assert.equal(none.code, 0); assert.equal(none.out, 'No changes.\n');
  const closed = await run([document], standIn('closed'));
  assert.equal(closed.code, 3); assert.equal(closed.out, ''); assert.match(closed.err, /closed before the review was sent/);
  const late = await run([document, '--timeout', '0.02'], standIn('silent'));
  assert.equal(late.code, 2); assert.match(late.err, /no review after/);
  assert.equal((await run([path.join(work, 'missing.md')], standIn('notes'))).code, 64);
  assert.equal((await run([], standIn('notes'))).code, 64);
  assert.equal((await run([path.join(work, 'fake-app.cjs')], standIn('notes'))).code, 64, 'only Markdown and text files');
  const left = (await import('node:fs')).readdirSync(os.tmpdir()).filter((name) => name.startsWith('stetwise-review-') && !name.startsWith('stetwise-review-test-'));
  checks.push('command-prints-instructions', 'command-exit-codes', `request-folders-left:${left.length}`);

  // ---- 2. The app: started with --review-request, the user answers from the bar ----
  if (!process.env.STETWISE_TEST_EXECUTABLE && !existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Run npm run build first');
  const { _electron } = await import('@playwright/test');
  const environment = { ...process.env, MENGX_DEV_URL: '' }; delete environment.ELECTRON_RUN_AS_NODE;
  async function withApp(answer) {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'stetwise-review-'));
    await writeFile(path.join(folder, 'request.json'), JSON.stringify({ file: document }));
    const profile = path.join(work, 'profile-' + path.basename(folder)); await mkdir(profile, { recursive: true });
    // STETWISE_TEST_EXECUTABLE runs the same checks against a packaged app (release/win-unpacked/Stetwise.exe).
    const packaged = process.env.STETWISE_TEST_EXECUTABLE;
    const app = await _electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--automation', '--user-data', profile, document, '--review-request', folder], cwd: root, env: environment, timeout: 60000 });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => Boolean(window.stetwiseReader), null, { timeout: 30000 });
      await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 }));
      // A fresh profile opens the first-run wizard over the window.
      await page.waitForTimeout(600);
      if (await page.locator('.setup-dialog').count()) await page.locator('.setup-dialog .primary-button').last().click();
      await page.locator('.terminal-review').waitFor({ timeout: 30000 });
      assert.equal(await page.evaluate(() => window.stetwiseReader.getState().document.name), 'plan.md');
      await answer(page, folder, app);
      return folder;
    } finally { await app.close().catch(() => {}); }
  }
  // Mark a passage, then send the instructions back.
  const first = await withApp(async (page, folder) => {
    const box = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector('.document-content'), NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) { const at = node.nodeValue.indexOf('expect no issues'); if (at >= 0) { const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 16); const r = range.getBoundingClientRect(); return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 }; } }
      return null;
    });
    await page.mouse.move(box.x1, box.y); await page.mouse.down(); await page.mouse.move(box.x2, box.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(400); await page.keyboard.press('f'); await page.waitForTimeout(500);
    await page.keyboard.type('Name the risk instead.'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.locator('.terminal-review .primary-button').click();
    await page.locator('.terminal-review').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(JSON.parse(await readFile(path.join(folder, 'done.json'), 'utf8')).status, 'notes');
    const reply = await readFile(path.join(folder, 'reply.md'), 'utf8');
    // By its real path: a temp folder named in its short 8.3 form (as on CI) is written out in full.
    assert.ok(reply.includes(realpathSync.native(document)), 'the task names the real file by its full path');
    assert.match(reply, /expect no issues/); assert.match(reply, /Name the risk instead\./);
    assert.ok(!/\[\[SW-|\.stetwise/.test(reply), 'no anchors and no working copy in a terminal task');
  });
  // "Nothing to change".
  const second = await withApp(async (page, folder) => {
    await page.locator('.terminal-review button').last().click();
    await page.locator('.terminal-review').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(JSON.parse(await readFile(path.join(folder, 'done.json'), 'utf8')).status, 'none');
    assert.match(await readFile(path.join(folder, 'reply.md'), 'utf8'), /no changes|没有要改/);
  });
  // Closing the window without answering tells the command the app has gone.
  const third = await withApp(async () => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(JSON.parse(await readFile(path.join(third, 'done.json'), 'utf8')).status, 'closed');
  for (const folder of [first, second, third]) await rm(folder, { recursive: true, force: true });
  checks.push('app-shows-request', 'instructions-sent-back', 'nothing-to-change', 'closed-without-answer');
  console.log(JSON.stringify({ ok: true, checks }));
} finally { await rm(work, { recursive: true, force: true }).catch(() => {}); }
