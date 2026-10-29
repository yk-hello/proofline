import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchDesktop, invokeDesktop } from './desktop-session.mjs';

const output = path.resolve('test-fixtures/results/windows');
await mkdir(output, { recursive: true });
const { app, page } = await launchDesktop({ output, userData: path.join(output, `profile-${Date.now()}`),
  executablePath: process.env.REDLINE_TEST_EXECUTABLE || process.env.MENGX_TEST_EXECUTABLE });
const invoke = (method, args = []) => invokeDesktop(app, page, method, args);
const errors = [], samples = [];
page.on('pageerror', (error) => errors.push(error.message));
const content = '# 中文窗口测试\n\nEnglish navigation, reading and annotations.\n\n'
  + Array.from({ length: 100 }, (_, i) => `## 章节 ${i}\n\n大小窗口中的工具栏和导航应保持独立滚动。\n\n${'阅读正文与搜索位置。'.repeat(20)}\n\n`).join('');
const measure = () => page.evaluate(() => {
  const box = (selector) => {
    const node = document.querySelector(selector), rect = node?.getBoundingClientRect();
    return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const controls = [...document.querySelectorAll('.document-actions > button, .document-actions > span, .search-strip > button')]
    .map((node) => ({ name: node.getAttribute('aria-label') || node.textContent, rect: boxFor(node) }));
  function boxFor(node) { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
  return { width: innerWidth, height: innerHeight, toolbar: box('.document-toolbar'), sidebar: box('.sidebar'),
    paper: box('.reading-column'), reference: box('.reference-column'), outline: box('.outline-rail'),
    results: box('.search-results-sidebar'), main: box('.main-area'), controls,
    overflow: document.documentElement.scrollWidth > innerWidth,
    bodyScroll: document.scrollingElement.scrollTop,
    topbar: box('.topbar'), paperScroll: document.querySelector('.reading-column').scrollTop };
});
try {
  await invoke('openText', [{ name: '中文窗口测试.md', path: 'window-test', content }]);
  assert.equal(await page.locator('.brand-name').textContent(), 'PROOFLINE');
  assert.equal(await page.evaluate(() => window.prooflineReader === window.mengxReader), true);
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'Proofline');
  assert.equal(await page.title(), 'Proofline');
  for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [860, 600], [720, 520]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.waitForTimeout(150);
    for (const language of ['zh', 'en']) {
      await invoke('setLanguage', [language]);
      await invoke('setPanels', [{ sidebar: true, outline: true }]);
      await page.waitForTimeout(50);
      const layout = await measure();
      assert.equal(layout.overflow, false, JSON.stringify(layout));
      assert.ok(layout.paper.height > 130, JSON.stringify(layout));
      assert.ok(layout.outline.width > 0 && layout.outline.right <= layout.width + 1, JSON.stringify(layout));
      for (const control of layout.controls) assert.ok(control.rect.width > 0 && control.rect.x >= layout.main.x - 1 && control.rect.right <= layout.width + 1 && control.rect.bottom <= layout.paper.y + 1, JSON.stringify({ width, language, control }));
      await invoke('setPanels', [{ outline: false }]);
      const before = await measure();
      await invoke('scrollTo', [2400]);
      await page.waitForTimeout(70);
      const after = await measure();
      assert.equal(after.bodyScroll, 0);
      assert.deepEqual(after.toolbar, before.toolbar);
      assert.deepEqual(after.topbar, before.topbar);
      assert.deepEqual(after.sidebar, before.sidebar);
      assert.ok(after.paperScroll > 1000);
      if (language === 'zh') await page.screenshot({ path: path.join(output, `window-${width}x${height}.png`) });
      const searchResult = await invoke('search', ['阅读正文']);
      assert.equal(searchResult.total ?? searchResult.count, 2000, 'Search API must retain every exact match');
      assert.ok(await page.locator('mark.search-hit').count() > 0, 'Visible virtualized region must render search matches');
      assert.equal(await page.locator('.source-search-hit').count(), 0, 'Visible matches must not become source-only placeholders');
      await page.waitForTimeout(80);
      const searched = await measure();
      assert.ok(searched.results.height > 80 && searched.paper.height > 80 && searched.paper.width > 140, JSON.stringify(searched));
      assert.ok(searched.paper.y < searched.height && searched.results.y < searched.height, JSON.stringify(searched));
      for (const control of searched.controls) assert.ok(control.rect.x >= searched.main.x - 1 && control.rect.right <= searched.width + 1, JSON.stringify({ width, language, control }));
      await invoke('goToMatch', [30]);
      await invoke('closeSearch');
      await invoke('openReference', [{ name: '独立对照.md', path: 'window-reference', content: '# 独立对照\n\n' + '右侧文档也能阅读。\n\n'.repeat(300) }]);
      await page.waitForTimeout(80);
      const split = await measure();
      assert.ok(split.paper.height > 65 && split.reference.height > 65 && split.reference.width > 140, JSON.stringify(split));
      assert.ok(split.reference.bottom <= split.height + 1 && split.reference.right <= split.width + 1, JSON.stringify(split));
      if ([720, 1366].includes(width) && language === 'zh') await page.screenshot({ path: path.join(output, `split-${width}x${height}.png`) });
      await invoke('closeSplitTab');
      samples.push({ width, height, language, contentWidth: before.paper.width, contentHeight: before.paper.height, searchWidth: searched.paper.width,
        splitWidth: split.reference.width, splitHeight: split.reference.height, toolbarHeight: before.toolbar.height });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'window-report.json'), JSON.stringify({ samples, errors }, null, 2));
  console.log(JSON.stringify({ checked: samples.length, errors, samples }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, layout: await measure(), samples, errors }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
