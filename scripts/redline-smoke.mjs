// End-to-end check of the Proofline loop in a browser build:
// mark -> popover -> remove/undo -> agent prompt with line numbers -> review -> apply,
// plus rich editing that keeps untouched Markdown byte-for-byte.
// Usage: npm run build && node scripts/redline-smoke.mjs   (EDGE_PATH / CHROME_PATH optional)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = [process.env.CHROME_PATH, process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((item) => item && existsSync(item));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(`http://127.0.0.1:${port}/`); break; } catch (error) { if (attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  await page.waitForFunction(() => window.prooflineReader?.getState().document.ready);

  const select = (needle) => page.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector('.document-content'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.nodeValue.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return;
    }
    throw new Error(`Text not found: ${text}`);
  }, needle);
  const pointOf = (needle) => page.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector('.document-content'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.nodeValue.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + Math.min(3, text.length));
      const box = range.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  }, needle);

  // 1. Create a fix redline from the selection toolbar and type its instruction.
  await select('选中任意一段');
  await page.locator('.selection-tools .sel-type.type-fix').click();
  await page.locator('.mark-popover textarea').fill('说得更具体');
  await page.keyboard.press('Escape');
  // 2. Keyboard shortcut for an ask redline, and a personal highlight.
  await select('接受或驳回之后才写回文件');
  await page.keyboard.press('q');
  await page.locator('.mark-popover textarea').fill('为什么要先审阅？');
  await page.keyboard.press('Escape');
  await select('标题、列表、表格、公式');
  await page.keyboard.press('h');
  const marks = await page.evaluate(() => window.prooflineReader.getAnnotations());
  assert.deepEqual(marks.map((item) => item.type).sort(), ['ask', 'fix', 'highlight']);
  assert.equal(marks.find((item) => item.type === 'fix').note, '说得更具体');

  // 3. Any painted mark can be clicked, removed and restored.
  const point = await pointOf('选中任意一段');
  await page.mouse.click(point.x, point.y);
  await page.locator('.mark-popover').waitFor();
  await page.locator('.mark-popover-head').click();
  await page.keyboard.press('Delete');
  assert.equal((await page.evaluate(() => window.prooflineReader.getAnnotations())).length, 2);
  await page.locator('.undo-toast button').click();
  assert.equal((await page.evaluate(() => window.prooflineReader.getAnnotations())).length, 3);

  // 4. The command-line agent prompt names each instruction with its line number.
  const prompt = await page.evaluate(() => window.prooflineReader.getAgentPrompt());
  assert.match(prompt, /### #1 修改 · 第 \d+(–\d+)? 行/);
  assert.match(prompt, /通读全文/);
  assert.match(prompt, /### #2 提问 · 第 \d+(–\d+)? 行/);

  // 5. An agent reply is reviewed block by block and applied.
  await page.evaluate(() => window.prooflineReader.reviewReply('<<<REDLINE #1\n1. **选中文字，下达指令。** 选中一句话或一段话，在弹出的工具条里选择指令类型。\n>>>\n<<<ANSWER #2\n先审阅才能避免 AI 误改。\n>>>', 'Claude Code'));
  await page.locator('.review-view').waitFor();
  assert.equal(await page.locator('.review-hunk').count(), 1);
  await page.locator('.review-bar .primary-button').click();
  await page.locator('.review-view').waitFor({ state: 'detached' });
  const content = (await page.evaluate(() => window.prooflineReader.getContent())).content;
  assert.match(content, /在弹出的工具条里选择指令类型/);
  assert.match(content, /2\. \*\*交给 AI。\*\*/, 'sibling list items survive a single-item revision');
  const after = await page.evaluate(() => window.prooflineReader.getAnnotations());
  assert.equal(after.find((item) => item.type === 'fix').status, 'resolved');
  assert.equal(after.find((item) => item.type === 'ask').status, 'answered');

  // 5b. A question from the AI is kept on the mark and goes back with the next task.
  await select('逐处审阅');
  await page.keyboard.press('f');
  await page.locator('.mark-popover textarea').fill('改得更好');
  await page.keyboard.press('Escape');
  const fresh = await page.evaluate(() => window.prooflineReader.getAgentPrompt());
  const n = Number(/### #(\d+) 修改/.exec(fresh)[1]);
  await page.evaluate((n) => window.prooflineReader.reviewReply(`<<<QUESTION #${n}\n“更好”是指更短还是更正式？\n>>>`, 'Claude Code'), n);
  await page.locator('.review-view').waitFor();
  assert.equal(await page.locator('.review-question').count(), 1);
  await page.locator('.review-bar .primary-button').click();
  await page.locator('.review-view').waitFor({ state: 'detached' });
  const asked = (await page.evaluate(() => window.prooflineReader.getAnnotations())).find((item) => item.note === '改得更好');
  assert.equal(asked.status, 'question');
  assert.match(await page.locator('.rail-item-question').first().innerText(), /更短还是更正式/);
  assert.match(await page.evaluate(() => window.prooflineReader.getAgentPrompt()), /你上次的疑问：“更好”是指更短还是更正式？/);

  // 6. Rich editing changes only the edited block.
  const before = content;
  await page.locator('.mode-switch button').last().click();
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('（编辑测试）');
  await page.waitForTimeout(600);
  await page.locator('.mode-switch button').first().click();
  const edited = (await page.evaluate(() => window.prooflineReader.getContent())).content;
  const changed = edited.split('\n').filter((line, index) => line !== before.split('\n')[index]);
  assert.equal(changed.length, 1, `only one line should change, got ${JSON.stringify(changed)}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: 7 }));
} finally {
  await browser.close();
  server.kill();
}
