// Browser checks for issues reported by testers (0.4.0):
// reading preferences take effect, two-option rows fill the row, the editor heading menu
// is not clipped, and search highlights and jumps to the exact match in the rich editor.
// Usage: npm run build && node scripts/ui-regressions-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = [process.env.CHROME_PATH, process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((item) => item && existsSync(item));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [], checks = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(`http://127.0.0.1:${port}/`); break; } catch (error) { if (attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  await page.waitForFunction(() => window.prooflineReader?.getState().document.ready);

  // 1. Reading preferences change the text.
  const style = () => page.evaluate(() => {
    const p = [...document.querySelectorAll('.document-content > p')].find((node) => node.textContent.trim().length > 10);
    const css = getComputedStyle(p); return { size: parseFloat(css.fontSize), leading: parseFloat(css.lineHeight) / parseFloat(css.fontSize), gap: parseFloat(css.marginBottom) };
  });
  const before = await style();
  await page.locator('button[aria-label="设置"]').click();
  const choose = (group, label) => page.locator(`.preference-segmented[aria-label="${group}"] button`, { hasText: label }).first().click();
  await choose('字号', '大'); await choose('行距', '宽松'); await choose('段落间距', '宽裕');
  const after = await style();
  assert.ok(after.size > before.size, `font size ${before.size} -> ${after.size}`);
  assert.ok(after.leading > before.leading + .1, `line height ${before.leading} -> ${after.leading}`);
  assert.ok(after.gap > before.gap, `paragraph gap ${before.gap} -> ${after.gap}`);
  checks.push('reading-preferences-apply');

  // 2. A two-option row fills the whole width.
  const widths = await page.locator('.preference-segmented[aria-label="正文字体"]').evaluate((row) => ({ row: row.clientWidth, buttons: [...row.children].reduce((sum, b) => sum + b.getBoundingClientRect().width, 0) }));
  assert.ok(widths.buttons >= widths.row - 4, `font row ${JSON.stringify(widths)}`);
  checks.push('two-option-row-fills');
  for (const [group, label] of [['字号', '标准'], ['行距', '舒适'], ['段落间距', '舒适']]) await choose(group, label);
  await page.keyboard.press('Escape');

  // 3. Rich editor: the heading menu shows every option.
  const long = ['# 产品需求文档', ''];
  for (let i = 1; i <= 60; i++) long.push(`## 第 ${i} 节`, '', `本节说明第 ${i} 项内容${i % 9 === 0 ? '，重点关注目标用户的留存' : ''}，以及 **加粗的说明** 和普通文字。`, '');
  await page.evaluate(async (text) => { await window.prooflineReader.openFile({ file: new File([text], 'prd.md', { type: 'text/markdown' }) }); }, long.join('\n'));
  await page.waitForFunction(() => window.prooflineReader.getState().document.name === 'prd.md' && window.prooflineReader.getState().document.ready);
  await page.locator('.mode-switch button', { hasText: '编辑' }).click();
  await page.waitForSelector('.markdown-editor .ProseMirror h2');
  await page.locator('.markdown-editor .ProseMirror p').nth(2).click();
  await page.locator('.top-bar-heading-button').click();
  const menu = await page.locator('.top-bar-heading-dropdown').evaluate((node) => [...node.children].filter((item) => {
    const box = item.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit && item.contains(hit);
  }).length);
  assert.equal(menu, 5, `visible heading options: ${menu}`);
  checks.push('editor-heading-menu-unclipped');
  await page.keyboard.press('Escape');

  // 4. Rich editor search: highlight, count, jump to the exact match, readable snippets.
  await page.locator('.markdown-editor .ProseMirror p').nth(1).click();
  await page.keyboard.press('Control+f');
  await page.locator('.search-strip input').fill('');
  await page.locator('.search-strip input').pressSequentially('目标用户');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /\/ 6/.test(document.querySelector('.search-result-count')?.textContent || ''));
  const painted = await page.evaluate(() => (CSS.highlights.get('pl-search')?.size || 0));
  assert.equal(painted, 6, 'six highlighted matches');
  const visible = () => page.evaluate(() => {
    const range = [...CSS.highlights.get('pl-search-active')][0]; const box = range.getBoundingClientRect();
    const frame = document.querySelector('.reading-scroll-region').getBoundingClientRect();
    return { text: range.toString(), inView: box.top >= frame.top && box.bottom <= frame.bottom, paragraph: range.startContainer.parentElement.closest('p').textContent.match(/第 (\d+) 项/)[1] };
  });
  let hit = await visible();
  assert.deepEqual([hit.text, hit.inView, hit.paragraph], ['目标用户', true, '9']);
  await page.locator('.search-result-item').nth(4).click();
  hit = await visible();
  assert.deepEqual([hit.text, hit.inView, hit.paragraph], ['目标用户', true, '45']);
  const snippet = await page.locator('.search-result-item').first().innerText();
  assert.ok(!snippet.includes('**'), `snippet shows Markdown syntax: ${snippet}`);
  checks.push('rich-editor-search-highlight-jump');
  // Typing into the search box keeps working after editing the document.
  await page.locator('.markdown-editor .ProseMirror p').nth(3).click();
  await page.keyboard.type('目标用户');
  await page.waitForFunction(() => (CSS.highlights.get('pl-search')?.size || 0) === 7);
  await page.locator('.search-strip input').click();
  await page.locator('.search-strip input').fill('');
  await page.locator('.search-strip input').pressSequentially('加粗');
  assert.equal(await page.locator('.search-strip input').inputValue(), '加粗');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /\/ 60/.test(document.querySelector('.search-result-count')?.textContent || ''));
  checks.push('rich-editor-search-follows-edits');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks }));
} finally { await browser.close(); server.kill(); }
