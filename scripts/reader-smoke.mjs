import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.READER_URL || 'http://localhost:5173/';
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const output = `${root}test-fixtures/results`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const report = { formats: [], errors: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('morrow-language', 'zh'));
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) report.errors.push(message.text());
  });
  await page.goto(baseUrl);
  await page.evaluate(() => document.fonts.ready);
  const input = page.locator('input[type=file]').first();
  async function open(name) {
    await input.setInputFiles(`${root}test-fixtures/${name}`);
    await page.waitForFunction((expected) => document.querySelector('.breadcrumb strong')?.textContent === expected, name);
    if (name === 'large.md') await page.locator('.large-document-chunk').first().waitFor();
    else await page.locator('.reading-column .document-content').waitFor();
  }
  for (const name of ['中文技术长文.md', 'ai-report.md', 'sample.txt', 'sample.html', 'sample.docx', 'nested/nested.md']) {
    await input.setInputFiles(`${root}test-fixtures/${name}`);
    await page.waitForFunction((expected) => document.querySelector('.breadcrumb strong')?.textContent === expected, name.split('/').at(-1));
    assert.ok((await page.locator('.reading-column .document-content').textContent()).trim());
    report.formats.push(name);
  }
  await page.evaluate(() => {
    window.readerLongTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.readerLongTasks.push(Math.round(entry.duration))))
      .observe({ type: 'longtask', buffered: false });
  });
  let started = Date.now();
  await open('large.md');
  report.largeOpenMs = Date.now() - started;
  assert.ok(await page.locator('.large-document-chunk').count() < 12);
  assert.ok(await page.locator('.outline-item').count() < 50);
  const fixedPositions = await page.evaluate(() => ['.topbar', '.document-toolbar', '.sidebar']
    .map((selector) => document.querySelector(selector).getBoundingClientRect().top));
  await page.evaluate(() => { document.querySelector('.reading-scroll-region').scrollTop = 1000000; });
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => ['.topbar', '.document-toolbar', '.sidebar']
    .map((selector) => document.querySelector(selector).getBoundingClientRect().top)), fixedPositions);
  assert.ok(await page.locator('.large-document-chunk').count() < 12);
  await page.getByRole('button', { name: '查找文档内容', exact: true }).click();
  await page.locator('.search-strip input').fill('MENGX-LARGE');
  assert.equal(await page.locator('.search-results-sidebar').count(), 0);
  await page.locator('.search-strip input').press('Enter');
  await page.waitForFunction(() => document.querySelector('.search-results-heading strong')?.textContent === '90000');
  assert.ok(await page.locator('.search-result-item').count() < 30);
  await page.evaluate(() => {
    const list = document.querySelector('.search-results-list'); list.scrollTop = list.scrollHeight;
  });
  await page.waitForTimeout(120);
  await page.locator('.search-result-item').last().click();
  await page.waitForFunction(() => {
    const hit = document.querySelector('[data-search-index="89999"].active-search-hit');
    if (!hit) return false;
    const box = hit.getBoundingClientRect(), region = document.querySelector('.reading-scroll-region').getBoundingClientRect();
    return box.top >= region.top && box.bottom <= region.bottom;
  });
  report.searchMatches = 90000;
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  await page.evaluate(() => { const list = document.querySelector('.outline-list'); list.scrollTop = list.scrollHeight; });
  await page.waitForTimeout(120);
  assert.match(await page.locator('.outline-item').last().textContent(), /第\s*90000\s*节/);
  await page.locator('.outline-item').last().click();
  await page.waitForFunction(() => {
    const heading = document.querySelector('[data-heading="第-90000-节-90000"]');
    if (!heading) return false;
    const box = heading.getBoundingClientRect(), region = document.querySelector('.reading-scroll-region').getBoundingClientRect();
    return box.top >= region.top && box.top < region.bottom;
  });
  report.lastHeadingReached = true;
  await open('ai-report.md');
  started = Date.now();
  await page.locator('.recent-item').filter({ hasText: 'large.md' }).click();
  await page.locator('.large-document-chunk').first().waitFor();
  report.cachedSwitchMs = Date.now() - started;
  await page.getByRole('button', { name: '保存 PDF', exact: true }).click();
  await page.locator('.progress-toast').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.topbar-popover').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.progress-toast').waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: '保存 PDF', exact: true }).isEnabled());
  report.pdfCancellation = true;
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  report.mainThreadLongTasks = await page.evaluate(() => window.readerLongTasks);
  await open('中文技术长文.md');
  const sizes = await page.evaluate(() => ['.nav-row', '.recent-copy strong', '.toolbar-button', '.outline-item']
    .map((selector) => getComputedStyle(document.querySelector(selector)).fontSize));
  assert.ok(sizes.every((size) => size === '13px'));
  assert.equal(await page.locator('.document-content').evaluate((node) => getComputedStyle(node).fontSize), '17px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '字号', exact: true }).getByRole('button', { name: '大字', exact: true }).click();
  assert.equal(await page.locator('.document-content').evaluate((node) => getComputedStyle(node).fontSize), '19px');
  await page.getByRole('button', { name: '衬线', exact: true }).click();
  assert.match(await page.locator('.document-content').evaluate((node) => getComputedStyle(node).fontFamily), /Noto Serif SC|Georgia|serif/);
  await page.locator('.focus-toggle').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.sidebar');
    return node && getComputedStyle(node).width === '0px';
  });
  assert.equal(await page.locator('.sidebar').evaluate((node) => getComputedStyle(node).width), '0px');
  await page.locator('.focus-toggle').click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.ok(await page.evaluate(() => document.fonts.check('400 13px "Noto Sans SC Variable"', '中文文档字体')));
  const addressInput = page.locator('.address-bar input');
  assert.ok(await addressInput.isEditable());
  const currentAddress = await addressInput.inputValue();
  await addressInput.fill(currentAddress);
  await addressInput.press('Enter');
  await page.waitForFunction((name) => document.querySelector('.breadcrumb strong')?.textContent === name, '中文技术长文.md');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  const collapsedUi = await page.evaluate(() => {
    const reopen = document.querySelector('.reopen-sidebar');
    const address = document.querySelector('.address-bar');
    const buttonBox = reopen?.getBoundingClientRect();
    const addressBox = address?.getBoundingClientRect();
    return {
      opacity: reopen ? getComputedStyle(reopen).opacity : '',
      background: reopen ? getComputedStyle(reopen).backgroundColor : '',
      separated: Boolean(buttonBox && addressBox && buttonBox.right < addressBox.left),
    };
  });
  assert.equal(collapsedUi.opacity, '1');
  assert.equal(collapsedUi.background, 'rgb(255, 255, 255)');
  assert.equal(collapsedUi.separated, true);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Open document', exact: true }).waitFor();
  await page.getByRole('button', { name: '中', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ...report, failure: error.message, state: await page.evaluate(() => window.mengxReader.getState()).catch(() => null),
    diagnostics: await page.evaluate(() => window.mengxReader.getPerformanceReport()).catch(() => null) }, null, 2));
  await page.screenshot({ path: `${output}/reader-failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
