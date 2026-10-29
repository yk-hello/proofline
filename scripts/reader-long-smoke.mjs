import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { analyzeDocument } from '../src/document-model.js';

const baseUrl = process.env.READER_URL || 'http://127.0.0.1:5173/';
const file = process.env.READER_TEST_FILE || 'test-fixtures/ai-report.md';
const output = new URL('../test-fixtures/results/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const report = { file, errors: [] };
const originalFile = await readFile(file);
try {
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('morrow-language', 'zh'));
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) report.errors.push(message.text()); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => Boolean(window.mengxReader));
  report.apiContract = await page.evaluate(async () => {
    const reader = window.mengxReader;
    reader.setLanguage('en');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const replies = [];
    const listener = ({ detail }) => replies.push(detail);
    window.addEventListener('mengx-reader:result', listener);
    try {
      for (const command of [
        { id: 'state', method: 'getState', args: [] },
        { id: 'unknown', method: 'unknownCommand', args: [] },
        { id: 'invalid', method: 'getState', args: 'invalid' },
      ]) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { window.removeEventListener('mengx-reader:result', onResult); reject(new Error('Event result timed out')); }, 3000);
          const onResult = ({ detail }) => {
            if (detail.id !== command.id) return;
            clearTimeout(timer);
            window.removeEventListener('mengx-reader:result', onResult);
            resolve();
          };
          window.addEventListener('mengx-reader:result', onResult);
          window.dispatchEvent(new CustomEvent('mengx-reader:command', { detail: command }));
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { stable: reader === window.mengxReader, replies };
    } finally {
      window.removeEventListener('mengx-reader:result', listener);
      reader.setLanguage('zh');
    }
  });
  assert.equal(report.apiContract.stable, true);
  assert.deepEqual(report.apiContract.replies.map(({ id, ok }) => ({ id, ok })), [
    { id: 'state', ok: true }, { id: 'unknown', ok: false }, { id: 'invalid', ok: false },
  ]);
  const input = page.locator('input[type=file]').first();
  const started = Date.now();
  await input.setInputFiles(file);
  await page.waitForFunction((name) => document.querySelector('.breadcrumb strong')?.textContent === name, file.split(/[\\/]/).pop());
  await page.locator('.large-document-chunk').first().waitFor({ timeout: 30000 });
  report.openMs = Date.now() - started;
  report.state = await page.evaluate(() => window.mengxReader.getState());
  assert.equal(report.state.document.name, path.basename(file));
  assert.ok(report.state.document.progressive);
  const fixedBefore = await page.evaluate(() => ['.topbar', '.document-toolbar', '.sidebar'].map((s) => document.querySelector(s).getBoundingClientRect().top));
  await page.evaluate(() => { const region = document.querySelector('.reading-scroll-region'); region.scrollTop = region.scrollHeight; });
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(() => ['.topbar', '.document-toolbar', '.sidebar'].map((s) => document.querySelector(s).getBoundingClientRect().top)), fixedBefore);
  report.scrollHeight = await page.locator('.reading-scroll-region').evaluate((node) => node.scrollHeight);

  await page.evaluate(() => window.mengxReader.search('视觉终端'));
  await page.waitForFunction(() => document.querySelector('.search-results-heading strong')?.textContent !== '0');
  report.search = await page.evaluate(() => ({ state: window.mengxReader.getState(), results: document.querySelectorAll('.search-result-item').length }));
  assert.ok(report.search.state.document.searchMatches > 0);
  await page.evaluate(() => window.mengxReader.goToMatch(0));
  await page.waitForTimeout(120);
  const firstHeading = await page.evaluate(() => window.mengxReader.getState().document.outlineCount);
  assert.ok(firstHeading > 10);
  report.outlineCount = firstHeading;
  await page.evaluate(() => window.mengxReader.closeSearch());
  await page.evaluate(() => window.mengxReader.goToHeading(0));
  await page.evaluate((count) => window.mengxReader.goToHeading(count - 1), firstHeading);
  await page.waitForTimeout(120);
  report.afterHeading = await page.evaluate(() => window.mengxReader.getState().document.name);

  await page.evaluate(() => { window.pdfTestJob = window.mengxReader.exportPdf(); });
  await page.locator('.progress-toast').waitFor({ timeout: 10000 });
  report.pdfProgressSeen = true;
  await page.evaluate(() => window.mengxReader.cancelPdf());
  await page.locator('.progress-toast').waitFor({ state: 'hidden', timeout: 15000 });
  const cancellation = await page.evaluate(() => window.pdfTestJob);
  assert.equal(cancellation.ok, false); assert.equal(cancellation.cancelled, true); assert.equal(cancellation.code, 'cancelled');
  report.pdfCancelled = true;
  report.performance = await page.evaluate(() => window.mengxReader.getPerformanceReport());
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => { window.pdfTestJob = window.mengxReader.exportPdf(); });
  await page.locator('.progress-toast').waitFor();
  await page.evaluate(() => window.mengxReader.setPanels({ preferences: true }));
  await page.locator('.preferences-popover').waitFor();
  const download = await downloadPromise;
  await download.saveAs(`${output}${path.basename(file, '.md')}.pdf`);
  report.pdfResult = await page.evaluate(() => window.pdfTestJob);
  assert.equal(report.pdfResult.ok, true);
  await page.evaluate(() => window.mengxReader.setPanels({ preferences: false }));
  report.performance = await page.evaluate(() => window.mengxReader.getPerformanceReport());
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: `${output}percevax-long.png`, fullPage: false });

  const editableSource = '# 长文修改测试\n\n修改前中文段落。\n\n公式 $x^2+1$。\n\n#### 四级标题\n\n- 外层\n  - 内层\n\n```js\nconst value = 1;\n```\n\n| 表头 | 数值 |\n| --- | --- |\n| 中文 | 2 |\n\n' +
    Array.from({ length: 1000 }, (_, index) => `## 第 ${index} 节\n\n其他内容完整保留。${'长文段落。'.repeat(20)}\n\n`).join('');
  await page.evaluate((content) => window.mengxReader.openText({ name: 'edit-long.md', content }), editableSource);
  const firstChunk = analyzeDocument(editableSource).chunks[0];
  await page.locator('.large-document-chunk[data-chunk="0"] [contenteditable=true] p').first().evaluate((paragraph) => {
    paragraph.textContent = '修改后中文段落。';
    paragraph.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  const edited = (await page.evaluate(() => window.mengxReader.getContent())).content;
  assert.match(edited, /修改后中文段落。/);
  assert.ok(edited.endsWith(editableSource.slice(firstChunk.end)), 'Untouched source chunks must remain byte-for-byte intact');
  const structured = edited.slice(0, 1000);
  assert.match(structured, /\$x\^2\+1\$/);
  assert.match(structured, /#### 四级标题/);
  assert.match(structured, /```js/);
  assert.match(structured, /\n\s+-\s+内层/);
  await page.evaluate(() => window.mengxReader.scrollTo('end'));
  await page.waitForFunction(() => !document.querySelector('.large-document-chunk[data-chunk="0"]'));
  await page.evaluate(() => window.mengxReader.goToHeading(0));
  assert.match(await page.locator('.large-document-chunk[data-chunk="0"]').textContent(), /修改后中文段落。/);
  const markdownDownload = page.waitForEvent('download');
  await page.evaluate(() => window.mengxReader.exportMarkdown());
  const exportedMarkdown = await markdownDownload;
  await exportedMarkdown.saveAs(`${output}edit-long-export.md`);
  assert.equal(await readFile(`${output}edit-long-export.md`, 'utf8'), edited);
  report.longEditPreserved = true;

  const plainSource = '# 超长单行\n\nPLAIN-LOCATE ' + '连续中文'.repeat(15000) + ' PLAIN-LOCATE ' + '连续中文'.repeat(15000) + ' PLAIN-LOCATE\n\n## 末尾\n';
  await page.evaluate((content) => window.mengxReader.openText({ name: 'plain-long.md', content }), plainSource);
  assert.equal((await page.evaluate(() => window.mengxReader.search('PLAIN-LOCATE'))).count, 3);
  for (const index of [2, 0]) await page.evaluate((index) => window.mengxReader.goToMatch(index), index);
  report.plainFallbackSearch = true;
  assert.deepEqual(await readFile(file), originalFile, 'The designated source file must remain unchanged');
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}percevax-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
