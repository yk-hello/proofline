// Word round trip: open a .docx with native charts (they become Stetwise charts with
// their data), then export Word (charts become pictures with the data table below).
// Usage: npm run build && node scripts/word-smoke.mjs   (LibreOffice optional, for a render check)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { chromium } from '@playwright/test';

const output = process.env.WORD_TEST_OUTPUT || 'test-fixtures/results/word-' + Date.now();
await mkdir(output, { recursive: true });
const fixture = 'test-fixtures/word-charts.docx';
const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const executablePath = [process.env.CHROME_PATH, process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((item) => item && existsSync(item));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (let attempt = 0; ; attempt++) { try { await page.goto(`http://127.0.0.1:${port}/?lang=zh`); break; } catch (error) { if (attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve, 250)); } }
  await page.waitForFunction(() => window.stetwiseReader?.getState().document.ready);
  const bytes = [...await readFile(fixture)];
  await page.evaluate(async (data) => { await window.stetwiseReader.openFile({ file: new File([new Uint8Array(data)], 'word-charts.docx') }); }, bytes);
  await page.waitForFunction(() => window.stetwiseReader.getState().document.name.startsWith('word-charts'));
  const content = await page.evaluate(() => window.stetwiseReader.getContent().content);
  await writeFile(path.join(output, 'imported.md'), content);
  const directives = [...content.matchAll(/<!-- stetwise:chart (type=[^ ]+(?: horizontal)?)/g)].map((match) => match[1]);
  assert.deepEqual(directives, ['type=bar', 'type=stacked horizontal', 'type=line', 'type=pie', 'type=doughnut']);
  assert.match(content, /\| Q3 \| 120 \| 60 \|/);
  assert.match(content, /\| 研发 \| 30 \| 12 \|/);
  assert.match(content, /title="季度销售额"/);
  assert.ok(content.indexOf('下面是本季度') < content.indexOf('季度销售额') && content.indexOf('季度销售额') < content.indexOf('各部门人数如下'), 'charts stay where they were');
  assert.ok(!/STETWISECHART/.test(content));
  await page.waitForFunction(() => document.querySelectorAll('.pl-chart-block').length === 5 && [...document.querySelectorAll('.pl-chart-block')].every((block) => block.shadowRoot?.querySelector('svg')), null, { timeout: 15000 });
  await page.screenshot({ path: path.join(output, 'imported.png'), fullPage: false });
  checks.push('open-docx-native-charts');

  // Export Word: add a Mermaid diagram and an image first so every path is exercised.
  const icon = 'data:image/png;base64,' + (await readFile('build/icon.png')).toString('base64');
  await page.evaluate(async (icon) => {
    // A large photo-like picture (noise compresses badly), like a real screenshot or photo.
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 300;
    const context = canvas.getContext('2d'), pixels = context.createImageData(500, 300);
    for (let index = 0; index < pixels.data.length; index++) pixels.data[index] = index % 4 === 3 ? 255 : Math.random() * 255;
    context.putImageData(pixels, 0, 0); icon = canvas.toDataURL('image/png');
    const extra = '\n\n## 附录\n\n- 第一项 **加粗** 和 `代码`\n- 第二项 [链接](https://example.com)\n\n1. 步骤一\n2. 步骤二\n\n> 引用一段话。\n\n```mermaid\npie title 渠道\n  "线上" : 45\n  "门店" : 30\n```\n\n公式 $E = mc^2$。\n\n![图标](' + icon + ')\n';
    await window.stetwiseReader.setReadingMode(false);
    await window.stetwiseReader.replaceContent(window.stetwiseReader.getContent().content + extra);
    await window.stetwiseReader.setReadingMode(true);
  }, icon);
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.stetwiseReader.exportWord())]);
  const file = path.join(output, 'exported.docx'); await download.saveAs(file);
  const zip = await JSZip.loadAsync(await readFile(file));
  const xml = await zip.file('word/document.xml').async('string');
  const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
  assert.ok(media.length >= 7, `pictures: ${media.length}`); // 5 charts + 1 diagram + 1 image
  assert.match(xml, /季度销售额/); assert.match(xml, /<w:tbl>/); assert.match(xml, /Heading1|Heading 1|w:val="Heading1"/);
  assert.match(xml, /E = mc\^2/); assert.match(xml, /example\.com|w:hyperlink/);
  assert.ok(!/stetwise:chart/.test(xml), 'no directive text in Word');
  assert.ok(!/脚注|Footnotes/.test(xml), 'no empty footnotes heading');
  assert.ok(!/\[图片/.test(xml), 'every image was embedded');
  assert.ok(!/w:line="\d+"(?![^>]*w:lineRule)/.test(xml + await zip.file('word/styles.xml').async('string')), 'line spacing is never exact (it would clip pictures)');
  checks.push('export-word');

  // Reopening the exported file restores the charts and the diagram, and shows plain pictures.
  const exported = [...await readFile(file)];
  await page.evaluate(async (data) => { await window.stetwiseReader.openFile({ file: new File([new Uint8Array(data)], 'exported.docx') }); }, exported);
  await page.waitForFunction(() => window.stetwiseReader.getState().document.name.startsWith('exported'));
  const reopened = await page.evaluate(() => window.stetwiseReader.getContent().content);
  await writeFile(path.join(output, 'reopened.md'), reopened);
  assert.deepEqual([...reopened.matchAll(/<!-- stetwise:chart (type=[^ ]+(?: horizontal)?)/g)].map((match) => match[1]), ['type=bar', 'type=stacked horizontal', 'type=line', 'type=pie', 'type=doughnut']);
  assert.match(reopened, /```mermaid\npie title 渠道/);
  assert.equal((reopened.match(/data:image/g) || []).length, 1, 'only the real picture stays a picture');
  await page.waitForFunction(() => document.querySelectorAll('.pl-chart-block').length === 5 && document.querySelector('.pl-diagram-host')?.shadowRoot?.querySelector('svg') && [...document.querySelectorAll('.document-content img')].some((img) => img.complete && img.naturalWidth > 0), null, { timeout: 20000 });
  assert.equal(await page.locator('.document-content pre:not(.mermaid-block)').count(), 0, 'no picture falls back to plain text');
  await page.screenshot({ path: path.join(output, 'reopened.png') });
  checks.push('reopen-exported-word');
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', output, file], { stdio: 'ignore', timeout: 120000 });
    assert.ok(existsSync(path.join(output, 'exported.pdf')), 'LibreOffice opened the exported file');
    checks.push('export-word-opens-in-libreoffice');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output, checks }));
} finally { await browser.close(); server.kill(); }
