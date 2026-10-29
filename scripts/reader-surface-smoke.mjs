import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchDesktop, invokeDesktop } from './desktop-session.mjs';

const output = path.resolve('test-fixtures/results/surface');
const userData = path.join(output, `profile-${Date.now()}`);
await mkdir(output, { recursive: true });
const filename = path.join(output, '源文与布局.md');
const linked = path.join(output, '关联文档 中文.md');
const source = '# 源文与布局\n\n[网页](https://example.test/reader) [关联文档](关联文档%20中文.md#第二章)\n\n'
  + Array.from({ length: 140 }, (_, i) => `## 章节 ${i}\n\n` + Array.from({ length: 12 }, (_, n) => `正文定位段落 ${i}。段落 ${n}，${'连续阅读需要保留准确的段落位置。'.repeat(8)}\n\n`).join('')).join('');
await writeFile(filename, source);
await writeFile(linked, '# 关联文档\n\n独立的中文文件。\n\n## 第二章\n\n链接定位终点。\n' + '第二章的正文。\n\n'.repeat(80));
let { app, page } = await launchDesktop({ output, userData, executablePath: process.env.MENGX_TEST_EXECUTABLE });
const invoke = (method, args = []) => invokeDesktop(app, page, method, args);
const report = { errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
const saved = () => page.waitForFunction(() => window.mengxReader.getState().document.saveState.status === 'saved' && !window.mengxReader.getState().document.dirty);
try {
  await app.evaluate(({ dialog, shell }) => {
    globalThis.surfaceDialogCalls = []; globalThis.surfaceExternalCalls = [];
    dialog.showOpenDialog = async (_window, options) => { globalThis.surfaceDialogCalls.push(options); return { canceled: true, filePaths: [] }; };
    shell.openExternal = async (url) => { globalThis.surfaceExternalCalls.push(url); };
  });
  await page.locator('.open-button').click();
  await page.waitForTimeout(100);
  assert.equal(await app.evaluate(() => globalThis.surfaceDialogCalls.at(-1).defaultPath), await app.evaluate(({ app }) => app.getPath('documents')));
  await invoke('openPath', [filename]);
  await page.locator('.open-button').click();
  await page.getByRole('button', { name: '并排阅读', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok((await app.evaluate(() => globalThis.surfaceDialogCalls.slice(-2))).every((call) => call.defaultPath === path.dirname(filename)));
  report.nativePickerDirectory = true;

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await invoke('setPanels', [{ sidebar: false, outline: true }]);
  const center = () => page.evaluate(() => {
    const layout = document.querySelector('.reading-layout').getBoundingClientRect();
    const paper = document.querySelector('.reading-column').getBoundingClientRect();
    const outline = document.querySelector('.outline-rail').getBoundingClientRect();
    return { delta: Math.abs(paper.left + paper.width / 2 - layout.left - layout.width / 2), paper: { left: paper.left, width: paper.width }, outline: { left: outline.left, right: outline.right }, layout: { right: layout.right } };
  });
  await page.waitForFunction(() => document.querySelector('.reading-layout').clientWidth > 1800);
  const opened = await center(); assert.ok(opened.delta < 2, JSON.stringify(opened));
  assert.ok(opened.outline.left > opened.paper.left + opened.paper.width);
  await invoke('setPanels', [{ outline: false }]);
  const closed = await center(); assert.deepEqual(closed.paper, opened.paper);
  await invoke('setPanels', [{ outline: true }]);
  await invoke('setFocusMode', [true]);
  assert.equal((await invoke('getState')).ui.outlineOpen, false);
  assert.equal(await page.locator('.outline-rail').isVisible(), false);
  await page.getByRole('button', { name: '显示目录', exact: true }).click();
  assert.equal(await page.locator('.outline-rail').isVisible(), true);
  assert.equal((await invoke('getState')).ui.focusMode, true);
  await invoke('setFocusMode', [false]);
  await page.waitForFunction(() => [...document.querySelectorAll('.outline-item')].some((node) => node.textContent.trim()));
  report.centeredOutlineAndFocus = true;
  await page.screenshot({ path: path.join(output, 'centered-reader.png') });

  await invoke('goToHeading', [81]);
  report.beforeSourceFocus = await invoke('getReadingPosition');
  report.sourceHeading = await invoke('getReadingPosition');
  const position = await invoke('getReadingPosition');
  await invoke('setSourceView', [true]);
  await page.waitForFunction((offset) => Math.abs((window.mengxReader.getReadingPosition().sourceOffset ?? 0) - offset) < 500, position.anchor?.sourceOffset ?? position.sourceStart);
  assert.equal(await page.locator('.source-plain-block').first().getAttribute('spellcheck'), 'false');
  await invoke('goToHeading', [81]);
  const raw = page.locator('.source-plain-block').filter({ hasText: '正文定位段落 80。' }).first();
  await raw.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      const at = text.textContent.indexOf('正文定位段落 80。'); if (at < 0) continue;
      node.focus({ preventScroll: true }); const range = document.createRange(); range.setStart(text, at + '正文定位段落 80。'.length); range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range); return;
    }
    throw new Error('Source passage missing');
  });
  report.beforeSourceInput = await invoke('getReadingPosition');
  await page.keyboard.type(' SOURCE-EDIT'); await saved();
  report.afterSourceEdit = await invoke('getReadingPosition');
  assert.ok(Math.abs(report.afterSourceEdit.sourceOffset - report.beforeSourceInput.sourceOffset) < 100, 'Source input must not move the reading viewport');
  assert.match(await readFile(filename, 'utf8'), /正文定位段落 80。 SOURCE-EDIT/);
  await page.keyboard.press('Control+z'); await saved();
  report.afterSourceUndo = await invoke('getReadingPosition');
  assert.ok(Math.abs(report.afterSourceUndo.sourceOffset - report.beforeSourceInput.sourceOffset) < 100, 'Source Undo must preserve the viewport');
  assert.equal(await readFile(filename, 'utf8'), source);
  await page.keyboard.press('Control+Shift+z'); await saved();
  const sourcePosition = await invoke('getReadingPosition');
  report.sourcePositionBeforeReturn = sourcePosition;
  assert.match(await readFile(filename, 'utf8'), /SOURCE-EDIT/);
  await invoke('setSourceView', [false]);
  await page.waitForFunction(() => !window.mengxReader.getState().ui.sourceView);
  const rendered = await invoke('getReadingPosition');
  assert.ok(Math.abs((rendered.anchor?.sourceOffset ?? rendered.sourceStart) - (sourcePosition.anchor?.sourceOffset ?? sourcePosition.sourceOffset)) < 300, JSON.stringify({ position, sourcePosition, rendered }));
  report.sourcePositionEditUndo = true;

  await invoke('scrollTo', [0]);
  await page.locator('.document-content a').filter({ hasText: '网页' }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.surfaceExternalCalls), ['https://example.test/reader']);
  await page.locator('.document-content a').filter({ hasText: '关联文档' }).click();
  await page.waitForFunction(() => window.mengxReader.getState().document.name === '关联文档 中文.md' && window.mengxReader.getState().document.activeHeading.startsWith('第二章'));
  report.externalAndRelativeLinks = true;
  await invoke('openPath', [filename]);
  await invoke('search', ['正文定位段落 80', { caseSensitive: true }]);
  await invoke('goToMatch', [5]);
  await invoke('setSourceView', [true]);
  await invoke('goToMatch', [7]);
  assert.equal(await page.locator('.active-search-hit').textContent(), '正文定位段落 80');
  await invoke('setSourceView', [false]);
  await invoke('closeSearch');
  report.sourceSearch = true;
  assert.deepEqual(report.errors, []);
  await writeFile(path.join(output, 'surface-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, state: await invoke('getState').catch(() => null), report }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
}
