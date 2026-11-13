// Continuity: what the reader keeps for you across undo, tabs, reopening and outside changes.
// Marks and their undo history, the reading position, document edits, following a change made
// by another program (and undoing it), a conflict when both sides changed, and saved versions.
// Runs the built desktop app (npm run build first); nothing here calls an AI.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchDesktop, invokeDesktop } from './desktop-session.mjs';

const output = path.resolve('test-fixtures/results/continuity');
const userData = path.join(output, `profile-${Date.now()}`);
await mkdir(output, { recursive: true });
const filename = path.join(output, '阅读与标注.md');
const original = '# 阅读与标注\n\n第一段需要高亮，第二句用于批注。\n\n## 子章节\n\nAlpha alpha alphabet。\n\n';
await writeFile(filename, original);
// Long enough to be drawn in parts, with a distinct line in every paragraph to find a position by.
const long = path.join(output, '长文档.md');
const longSource = ['# 长文档', '', ...Array.from({ length: 900 }, (_, i) => `${i % 30 === 0 ? `## 第 ${i / 30 + 1} 节\n\n` : ''}第 ${i + 1} 段：这一段用来检查阅读位置，编号 P${String(i + 1).padStart(4, '0')}，内容足够长以便占满一行并换行。\n`)].join('\n');
await writeFile(long, longSource);

let { app, page } = await launchDesktop({ output, userData });
const invoke = (method, args = []) => invokeDesktop(app, page, method, args);
const report = { checks: [], errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
const done = (name) => report.checks.push(name);
const marks = () => invoke('getAnnotations');
const state = () => invoke('getState');
const saved = () => page.waitForFunction(() => { const d = window.stetwiseReader.getState().document; return d.saveState.status === 'saved' && !d.dirty; }, null, { timeout: 20000 });
// The file on disk, once the reader has written it: autosave runs a moment after a change.
const disk = async (test, message) => { for (let i = 0; i < 80; i++) { if (test(await readFile(filename, 'utf8'))) return; await new Promise((resolve) => setTimeout(resolve, 150)); } assert.fail(`${message}: ${JSON.stringify(await readFile(filename, 'utf8'))}`); };
const painted = (name, count) => page.waitForFunction(([name, count]) => (CSS.highlights.get(name)?.size || 0) === count, [name, count], { timeout: 10000 });
// The paragraph number at the top of the page: what the reader is looking at.
const topParagraph = () => page.evaluate(() => {
  const region = document.querySelector('.reading-column'), top = region.getBoundingClientRect().top;
  for (const node of document.querySelectorAll('.document-content p')) { const box = node.getBoundingClientRect(); if (box.bottom > top + 4) return /P\d{4}/.exec(node.textContent)?.[0] || null; }
  return null;
});

try {
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 }));
  if (await page.locator('.setup-dialog').count()) await page.locator('.setup-dialog .dialog-actions .primary-button').click();

  // ---- Marks and their own undo history ----
  await invoke('openPath', [filename]);
  await invoke('setReadingMode', [true]);
  const highlight = await invoke('addHighlight', [{ text: '第一段需要高亮', label: '第一段高亮' }]);
  await painted('rl-highlight', 1);
  await invoke('undoAnnotation'); assert.equal((await marks()).length, 0); await painted('rl-highlight', 0);
  await invoke('redoAnnotation'); assert.equal((await marks()).length, 1); await painted('rl-highlight', 1);
  const note = await invoke('addNote', [{ text: '第二句用于批注', note: '原始批注' }]);
  await invoke('updateAnnotation', [note.id, { note: '新批注', label: '我的批注' }]);
  assert.equal((await marks()).find((item) => item.id === note.id).note, '新批注');
  await invoke('undoAnnotation');
  assert.equal((await marks()).find((item) => item.id === note.id).note, '原始批注', 'undo restores the note as it was');
  await invoke('redoAnnotation');
  assert.equal((await marks()).find((item) => item.id === note.id).label, '我的批注');
  await invoke('addUnderline', [{ text: 'Alpha alpha alphabet', label: '独立划线' }]);
  await painted('rl-underline', 1);
  await invoke('removeAnnotation', [highlight.id]); assert.equal((await marks()).length, 2);
  await invoke('undoAnnotation'); assert.equal((await marks()).length, 3, 'a removed mark comes back');
  assert.equal(await readFile(filename, 'utf8'), original, 'marks never touch the document');
  done('marks-undo-redo');

  // ---- Document edits: undo, redo, and the file on disk ----
  const before = await invoke('getContent');
  await invoke('setReadingMode', [false]);
  await invoke('replaceContent', [before.content.replace('Alpha alpha alphabet。', 'Alpha beta gamma。'), { expectedRevision: before.revision }]);
  await disk((text) => text.includes('Alpha beta gamma。'), 'the edit is saved');
  await invoke('undo');
  await disk((text) => text === original, 'undo is written back');
  await invoke('redo');
  await disk((text) => text.includes('Alpha beta gamma。'), 'redo is written back');
  await invoke('undo');
  await disk((text) => text === original, 'the second undo is written back'); await saved();
  await invoke('setReadingMode', [true]);
  assert.equal((await marks()).length, 3, 'marks survive edits to other text');
  done('edit-undo-redo-saved');

  // ---- Another program changes the file while nothing here is unsaved: follow, then undo ----
  const outside = original.replace('第二句用于批注。', '第二句被外部程序改过。');
  await writeFile(filename, outside);
  await invoke('checkExternalChanges');
  await page.waitForFunction((text) => window.stetwiseReader.getContent().content.includes(text), '第二句被外部程序改过', { timeout: 15000 });
  await page.locator('.round-bar').waitFor({ timeout: 10000 });
  assert.equal((await state()).document.dirty, false);
  await page.locator('.round-bar .round-actions button').nth(1).click();            // Undo
  await page.waitForFunction((text) => window.stetwiseReader.getContent().content.includes(text), '第二句用于批注', { timeout: 15000 });
  await disk((text) => text === original, 'undoing an outside change puts the file back'); await saved();
  done('outside-change-followed-and-undone');

  // ---- Both sides changed: nothing is overwritten until the user chooses ----
  const mine = await invoke('getContent');
  await invoke('setReadingMode', [false]);
  await page.evaluate(([content, revision]) => { void window.stetwiseReader.replaceContent(content, { expectedRevision: revision }); }, [mine.content.replace('第一段需要高亮', '第一段我改过'), mine.revision]);
  await writeFile(filename, original.replace('## 子章节', '## 外部改的标题'));
  await invoke('checkExternalChanges');
  await page.waitForFunction(() => window.stetwiseReader.getState().document.saveState.status === 'conflict', null, { timeout: 15000 });
  assert.match(await readFile(filename, 'utf8'), /外部改的标题/, 'the outside version is still on disk');
  assert.ok((await invoke('getContent')).content.includes('第一段我改过'), 'and the local edit is still in the window');
  await invoke('resolveConflict', ['reload']);
  await page.waitForFunction(() => window.stetwiseReader.getContent().content.includes('外部改的标题'), null, { timeout: 15000 });
  const versions = await invoke('getVersions');
  assert.ok((versions.versions || versions.items || versions).length >= 2, 'versions were kept along the way');
  await invoke('setReadingMode', [true]);
  done('conflict-kept-both', 'versions-kept');

  // ---- Reading position: across tabs, and after closing and reopening ----
  await invoke('openPath', [long]);
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 }));
  const target = (await invoke('getOutline', [{ offset: 0, limit: 100 }])).items.find((item) => /第 17 节/.test(item.text || item.title));
  await invoke('goToHeading', [target.slug]);
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 900); await page.waitForTimeout(900);
  const reading = await topParagraph();
  assert.match(reading, /^P0\d{3}$/);
  const tabs = await invoke('getTabs');
  await invoke('switchTab', [tabs.find((tab) => !tab.active).id]); await page.waitForTimeout(500);
  await invoke('switchTab', [tabs.find((tab) => tab.active).id]);
  await page.waitForFunction(() => window.stetwiseReader.getState().document.ready, null, { timeout: 15000 }); await page.waitForTimeout(1500);
  assert.equal(await topParagraph(), reading, 'the position is kept across tabs');
  await invoke('closeTab', [undefined, { discard: true }]); await page.waitForTimeout(500);
  await invoke('openPath', [long]);
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 })); await page.waitForTimeout(2500);
  assert.equal(await topParagraph(), reading, 'and after closing and reopening the document');
  done('position-across-tabs', 'position-after-reopen');

  // ---- After a restart: the same documents, marks and position ----
  await app.close();
  ({ app, page } = await launchDesktop({ output, userData }));
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.stetwiseReader), null, { timeout: 30000 });
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 }));
  await invoke('openPath', [long]);
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 })); await page.waitForTimeout(2500);
  assert.equal(await topParagraph(), reading, 'the position survives a restart');
  await invoke('openPath', [filename]);
  await page.evaluate(() => window.stetwiseReader.waitForReady({ timeoutMs: 30000 }));
  const kept = await marks();
  assert.equal(kept.length, 3, 'marks survive a restart');
  assert.equal(kept.find((item) => item.type === 'note').note, '新批注');
  done('restart-keeps-position-and-marks');

  assert.deepEqual(report.errors, []);
  report.ok = true;
  await writeFile(path.join(output, 'continuity-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ checks: report.checks, errors: report.errors }));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
