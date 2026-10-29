import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { launchDesktop, invokeDesktop } from './desktop-session.mjs';

// Exercise the real bundled Worker, font, local resources and export bridge.
const output = path.resolve('test-fixtures/results/native/pdf-qa');
await mkdir(output, { recursive: true });
const stressFile = path.join(output, '跨页表格与长代码.md');
const mathFile = path.join(output, '公式与金额边界.md');
await writeFile(mathFile, '# 公式与金额边界\n\n预算 $350k-$550k，规模 $3.613B。\n\n行内代码 `$x^2$` 应原样保留。真正公式 $E=mc^2$ 应渲染。\n\n'
  + '| 类型 | 内容 |\n| --- | --- |\n| 公式 | $\\frac{a+b}{c}=1$ |\n| 代码 | `$literal$` |\n| 金额 | $210M |\n\n'
  + '$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$\n\n边界验证终点。\n');
await writeFile(stressFile, '# 跨页表格与长代码\n\n中文段落和 English text，导出应保持可复制。\n\n'
  + '| 编号 | 说明 |\n| --- | --- |\n'
  + Array.from({ length: 100 }, (_, index) => `| ${index + 1} | 第 ${index + 1} 行，中文表格在分页后重复表头，文字必须完整。 |\n`).join('')
  + '\n## 长代码块\n\n```js\n'
  + Array.from({ length: 45 }, (_, index) => `const item${index} = "${'很长的中文内容与LongEnglishIdentifier'.repeat(5)}";`).join('\n')
  + '\n```\n\n最后一段：完整导出终点。\n');
const { app, page } = await launchDesktop({ output, userData: path.join(output, `profile-${Date.now()}`), executablePath: process.env.MENGX_TEST_EXECUTABLE });
const report = { exports: [], errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
const invoke = (method, args = []) => invokeDesktop(app, page, method, args);
try {
  for (const file of ['中文技术长文.md', 'ai-report.md', 'sample.txt', 'sample.html', 'sample.docx', stressFile, mathFile]) {
    await invoke('openPath', [path.isAbsolute(file) ? file : path.resolve('test-fixtures', file)]);
    const started = Date.now();
    const result = await invoke('exportPdf');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await readFile(result.path)).subarray(0, 5).toString(), '%PDF-');
    assert.ok(result.pages > 0);
    // Keep distinct artifacts when imports share a basename across formats.
    const artifact = path.join(output, `${path.basename(file)}.pdf`);
    await copyFile(result.path, artifact);
    report.exports.push({ file, ...result, artifact, durationMs: Date.now() - started });
    await writeFile(path.join(output, 'pdf-report.json'), JSON.stringify(report, null, 2));
    if (file === '中文技术长文.md') {
      assert.equal(result.stats.formulas, 2, 'Both paragraph and table formulas must render');
      assert.equal(result.stats.diagrams, 1, JSON.stringify(result.stats));
      assert.equal(result.stats.images, 1);
      assert.equal(result.stats.fallbacks, 0);
    }
    if (file === mathFile) { assert.equal(result.stats.formulas, 3); assert.equal(result.stats.fallbacks, 0); }
    if (file === stressFile) assert.ok(result.stats.repeatedTableHeaders > 0);
  }
  // A long export must stay cancellable while the surrounding UI responds.
  await invoke('openPath', [process.env.READER_TEST_FILE || 'test-fixtures/ai-report.md']);
  await page.evaluate(() => { window.pdfTestJob = window.mengxReader.exportPdf(); });
  await page.locator('.progress-toast').waitFor();
  await invoke('setPanels', [{ preferences: true }]);
  await page.locator('.preferences-popover').waitFor();
  await invoke('cancelPdf');
  const cancellation = await page.evaluate(() => window.pdfTestJob);
  assert.equal(cancellation.ok, false); assert.equal(cancellation.cancelled, true); assert.equal(cancellation.code, 'cancelled');
  await page.locator('.progress-toast').waitFor({ state: 'hidden' });
  report.cancelAndUiResponsive = true;
  assert.deepEqual(report.errors, []);
  await writeFile(path.join(output, 'pdf-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
