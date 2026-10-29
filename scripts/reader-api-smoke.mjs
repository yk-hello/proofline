import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeDocument, searchDocument } from '../src/document-model.js';

const output = path.resolve('test-fixtures/results/api');
await mkdir(output, { recursive: true });
const copyPath = path.join(output, 'writeback.md');
await writeFile(copyPath, '# 写回测试\n\n原内容。\n');
const child = spawn(process.execPath, ['scripts/reader-cli.mjs', 'session', '--output', path.join(output, 'downloads')], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
const startupTimer = setTimeout(() => rejectReady(new Error('CLI startup timed out')), 30000);
startupTimer.unref();
createInterface({ input: child.stdout }).on('line', (line) => {
  const result = JSON.parse(line);
  if (result.event === 'ready') { clearTimeout(startupTimer); resolveReady(result); }
  else if (pending.has(result.id)) { pending.get(result.id).resolve(result); pending.delete(result.id); }
});
child.once('error', (error) => rejectReady(error));
child.once('exit', (code) => {
  clearTimeout(startupTimer);
  rejectReady(new Error(`CLI exited before ready: ${code}`));
  for (const request of pending.values()) request.reject(new Error(`CLI exited: ${code}`));
  pending.clear();
});
const exited = new Promise((resolve) => child.once('exit', resolve));
let nextId = 0;
async function request(method, args = [], expectOk = true) {
  const id = String(++nextId);
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
  const result = await Promise.race([response, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 120000); timer.unref(); })]);
  assert.equal(result.ok, expectOk, JSON.stringify(result));
  return result;
}

const report = {};
try {
  await ready;
  report.methods = (await request('describe')).result.methods;
  assert.ok(report.methods.includes('replaceContent'));
  const designatedFile = process.env.READER_TEST_FILE || 'test-fixtures/ai-report.md';
  const designatedSource = await readFile(designatedFile, 'utf8');
  const designatedModel = analyzeDocument(designatedSource);
  report.designatedFile = (await request('openPath', [designatedFile])).result;
  report.search = (await request('search', ['视觉终端'])).result.count;
  assert.equal(report.search, searchDocument(designatedSource, '视觉终端', designatedModel).length);
  for (const index of [0, report.search - 1]) await request('goToMatch', [index]);
  assert.equal((await request('goToMatch', [report.search], false)).code, 'out-of-range');
  const outline = (await request('getOutline', [{ offset: 80 }])).result;
  assert.equal(outline.total, designatedModel.outline.length);
  await request('goToHeading', [outline.total - 1]);
  await request('setLanguage', ['en']);
  await request('setReadingWidth', ['wide']);
  await request('setPanels', [{ sidebar: false, preferences: true }]);
  await request('openReferencePath', ['test-fixtures/sample.docx']);
  assert.equal((await request('getState')).result.reference.name, 'sample.docx');
  await request('toggleSplit', [false]);
  await request('setLanguage', ['zh']);
  await request('setPanels', [{ sidebar: true, preferences: false }]);
  report.workspace = (await request('openFolderPath', ['test-fixtures/nested'])).result;
  await request('openWorkspaceFile', ['nested.md']);
  report.workspaceSearch = (await request('searchWorkspace', ['中文'])).result.total;
  await request('openPath', [copyPath]);
  const revision = (await request('getContent')).result.revision;
  await request('replaceContent', ['# 写回测试\n\nAI 接口已经修改。\n', { expectedRevision: revision }]);
  assert.equal((await request('getState')).result.document.dirty, true);
  assert.equal((await request('replaceContent', ['stale', { expectedRevision: revision }], false)).code, 'revision-conflict');
  await request('save');
  assert.equal(await readFile(copyPath, 'utf8'), '# 写回测试\n\nAI 接口已经修改。\n');
  await request('openText', [{ name: 'other.md', content: '# 切换文档' }]);
  await request('openRecent', [copyPath]);
  assert.equal((await request('getContent')).result.content, '# 写回测试\n\nAI 接口已经修改。\n');
  await writeFile(copyPath, '# 写回测试\n\n外部修改后重新读取。\n');
  await request('openRecent', [copyPath]);
  assert.equal((await request('getContent')).result.content, '# 写回测试\n\n外部修改后重新读取。\n');
  await request('openFolderPath', [output]);
  await request('openWorkspaceFile', ['writeback.md']);
  await request('replaceContent', ['# 目录句柄写回\n\n新的内容。\n']);
  await request('save');
  await request('openWorkspaceFile', ['writeback.md']);
  assert.equal((await request('getContent')).result.content, '# 目录句柄写回\n\n新的内容。\n');
  assert.equal(await readFile(copyPath, 'utf8'), '# 目录句柄写回\n\n新的内容。\n');
  report.writeback = true;
  report.reopenReadsDisk = true;
  const markdownExport = await request('exportMarkdown');
  const markdownPath = markdownExport.downloads.find((filename) => filename.endsWith('writeback.md'));
  assert.ok(markdownPath, 'CLI must report the completed download path');
  assert.equal(await readFile(markdownPath, 'utf8'), '# 目录句柄写回\n\n新的内容。\n');
  const pdfExport = await request('exportPdf');
  const pdfPath = pdfExport.downloads.find((filename) => filename.endsWith('writeback.pdf'));
  assert.ok(pdfPath, 'CLI must report the PDF download path');
  assert.equal((await readFile(pdfPath)).subarray(0, 5).toString(), '%PDF-');
  report.downloads = { markdownPath, pdfPath };
  assert.equal((await request('unknownCommand', [], false)).code, 'unknown-command');
  await request('setReadingMode', [true]);
  assert.equal((await request('replaceContent', ['locked'], false)).code, 'reading-locked');
  await request('setReadingMode', [false]);
  await request('openText', [{ name: 'empty.md', path: 'one', content: '' }]);
  await request('openText', [{ name: 'empty.md', path: 'two', content: '# 第二篇' }]);
  await request('openRecent', ['one']);
  assert.equal((await request('getContent')).result.content, '');
  report.emptyAndSameName = true;
  await request('capture', ['api-desktop.png']);
  report.performance = (await request('getPerformanceReport')).result;
  assert.deepEqual(report.performance.errors, []);
  await writeFile(path.join(output, 'api-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.stdin.end();
  assert.equal(await exited, 0);
}
