// Browser checks for charts, table tools, document statistics and free instructions.
// Usage: npm run build && node scripts/charts-tables-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = process.env.CHARTS_TEST_OUTPUT || 'test-fixtures/results/charts-' + Date.now();
await mkdir(output, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = [process.env.CHROME_PATH, process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((item) => item && existsSync(item));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [], checks = [];
const doc = ['# 季度报告', '', '<!-- stetwise:chart type=bar title="季度销售额" unit="万元" -->', '| 季度 | 线上 | 门店 |', '|---|---:|---:|', '| Q1 | 80 | 40 |', '| Q2 | 95 | 55 |', '| Q3 | 120 | 60 |', '| Q4 | 110 | 72 |', '',
  '| 部门 | 人数 | 预算 |', '|---|---:|---:|', '| 研发 | 42 | 3.5 |', '| 销售 | 30 | 2.25 |', '| 运营 | 18 | 1.5 |', '', '```mermaid', 'pie title 渠道', '  "线上" : 45', '  "门店" : 30', '```', '', '收入总结在这里。', ''].join('\n');
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (let attempt = 0; ; attempt++) { try { await page.goto(`http://127.0.0.1:${port}/?lang=zh`); break; } catch (error) { if (attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve, 250)); } }
  await page.waitForFunction(() => window.stetwiseReader?.getState().document.ready);
  await page.evaluate(async (text) => { await window.stetwiseReader.openFile({ file: new File([text], 'report.md', { type: 'text/markdown' }) }); }, doc);
  await page.waitForFunction(() => window.stetwiseReader.getState().document.name === 'report.md');

  // 1. Charts and diagrams render, without leaking labels into document text.
  await page.waitForFunction(() => document.querySelector('.pl-chart-block')?.shadowRoot?.querySelector('svg path[data-tip]') && document.querySelector('.pl-diagram-host')?.shadowRoot?.querySelector('svg'), null, { timeout: 20000 });
  const text = await page.locator('.document-content').evaluate((node) => node.textContent);
  assert.ok(!text.includes('季度销售额') && !text.includes('源码'), 'chart labels stay out of document text');
  assert.equal(await page.locator('pre.mermaid-block').isVisible(), false, 'diagram replaces its source');
  const bars = await page.locator('.pl-chart-block').evaluate((block) => block.shadowRoot.querySelectorAll('path[data-tip]').length);
  assert.equal(bars, 8, 'four quarters x two series; the totals footer is not chart data');
  await page.locator('.pl-chart-block').screenshot({ path: `${output}/chart.png` });
  checks.push('charts-and-diagrams-render');

  // 2. "Instruct on chart" selects the table data and creates an anchored mark.
  await page.evaluate(() => document.querySelector('.pl-chart-block').shadowRoot.querySelector('.mark').click());
  await page.locator('.selection-tools .sel-type.type-fix').click();
  await page.locator('.mark-popover textarea').fill('Q3 门店改成 66');
  await page.keyboard.press('Escape');
  const chartMark = (await page.evaluate(() => window.stetwiseReader.getAnnotations()))[0];
  assert.match(chartMark.anchor.rawQuote, /Q3 \| 120 \| 60/);
  checks.push('chart-component-mark');

  // 3. Sorting is display-only; totals and averages are shown, then written on request.
  const plain = page.locator('.document-content table').nth(1);
  await plain.locator('th').nth(1).click();
  assert.deepEqual(await plain.locator('tbody tr td:first-child').allInnerTexts(), ['运营', '销售', '研发']);
  await plain.locator('th').nth(1).click(); await plain.locator('th').nth(1).click();
  assert.deepEqual(await plain.locator('tbody tr td:first-child').allInnerTexts(), ['研发', '销售', '运营']);
  const foot = await plain.locator('tfoot td').evaluateAll((cells) => cells.map((cell) => cell.dataset.value || ''));
  assert.deepEqual(foot.slice(0, 6), ['合计', '90', '7.25', '平均', '30', '2.417']);
  assert.equal(await page.evaluate(() => window.stetwiseReader.getContent().content), doc, 'sorting and totals do not change the document');
  await plain.hover(); await plain.locator('.pl-insert-total').click();
  await page.waitForFunction(() => window.stetwiseReader.getContent().content.includes('| 合计 | 90 | 7.25 |'));
  assert.match(await page.evaluate(() => window.stetwiseReader.getContent().content), /\| 运营 \| 18 \| 1\.5 \|\n\| 合计 \| 90 \| 7\.25 \|\n\n```mermaid/);
  checks.push('table-sort-totals-insert');

  // 4. Document statistics.
  await page.locator('button[aria-label="更多文档操作"]').click();
  await page.getByRole('menuitem', { name: '文档统计' }).click();
  const stats = await page.locator('.stats-dialog').innerText();
  assert.match(stats, /2\s*\n?\s*表格/); assert.match(stats, /2\s*\n?\s*图表/); assert.match(stats, /AI 指令 1 条/);
  await page.locator('.stats-dialog').screenshot({ path: `${output}/stats.png` });
  await page.keyboard.press('Escape');
  checks.push('document-statistics');

  // 5. An instruction on a selection (shortcut I) and one for the whole document.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('.document-content'), NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { const at = node.nodeValue.indexOf('收入总结'); if (at >= 0) { const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 4); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return; } }
  });
  await page.keyboard.press('i');
  await page.locator('.mark-popover textarea').fill('改成一张表');
  await page.keyboard.press('Escape');
  await page.locator('.rail-document-instruction').click();
  await page.locator('.mark-popover textarea').fill('全文改成正式语气');
  await page.keyboard.press('Escape');
  const marks = await page.evaluate(() => window.stetwiseReader.getAnnotations());
  // Fix carries any instruction on a selection (I and E are shortcuts to it); only the whole-document one is free-form.
  assert.deepEqual(marks.filter((mark) => mark.note === '改成一张表').map((mark) => mark.type), ['fix']);
  assert.deepEqual(marks.filter((mark) => mark.type === 'free').map((mark) => [Boolean(mark.anchor.document), mark.note]), [[true, '全文改成正式语气']]);
  assert.match(await page.locator('.rail-item.type-free').first().innerText(), /全文/);
  checks.push('free-instructions');

  // 6. Editor slash menu inserts a chart that renders after returning to reading.
  await page.locator('.mode-switch button', { hasText: '编辑' }).click();
  await page.waitForSelector('.markdown-editor .ProseMirror');
  await page.locator('.markdown-editor .ProseMirror p').last().click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/');
  await page.locator('.milkdown-slash-menu li', { hasText: '饼图' }).first().click();
  await page.waitForFunction(() => window.stetwiseReader.getContent().content.includes('stetwise:chart type=pie'), null, { timeout: 5000 });
  await page.locator('.mode-switch button', { hasText: '阅读' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pl-chart-block').length === 2 && [...document.querySelectorAll('.pl-chart-block')].every((block) => block.shadowRoot?.querySelector('svg')), null, { timeout: 10000 });
  const saved = await page.evaluate(() => window.stetwiseReader.getContent().content);
  assert.match(saved, /<!-- stetwise:chart type=pie title="渠道占比" -->\n\| 渠道 \| 占比 \|/);
  assert.ok(saved.startsWith(doc.split('| 运营 | 18 | 1.5 |')[0]), 'untouched blocks, including the existing chart, stay byte-for-byte');
  checks.push('editor-insert-chart');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output, checks }));
} finally { await browser.close(); server.kill(); }
