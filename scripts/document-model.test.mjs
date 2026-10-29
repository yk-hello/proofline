import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeDocument, searchDocument } from '../src/document-model.js';

function checkCoverage(source, model) {
  let end = 0;
  for (const chunk of model.chunks) {
    assert.equal(chunk.start, end);
    assert.ok(chunk.end > chunk.start);
    assert.ok(chunk.end - chunk.start <= 80000, 'A single chunk must stay bounded');
    end = chunk.end;
  }
  assert.equal(end, source.length);
  for (const heading of model.outline) {
    const chunk = model.chunks[heading.chunk];
    assert.ok(heading.offset >= chunk.start && heading.offset < chunk.end);
  }
}

const fenced = '# 标题\n\n```md\n' + '## 代码中的标题\n'.repeat(12000) + '```\n\n## 真正的章节\n\n末尾。';
const fencedModel = analyzeDocument(fenced);
checkCoverage(fenced, fencedModel);
assert.deepEqual(fencedModel.outline.map((h) => h.text), ['标题', '真正的章节']);
assert.ok(fencedModel.chunks.some((chunk) => chunk.plain));

const singleLine = '# 超长单行\n\n' + '连续中文内容'.repeat(200000) + '\n\n## 末尾章节\n';
const singleLineModel = analyzeDocument(singleLine);
checkCoverage(singleLine, singleLineModel);
assert.equal(singleLineModel.outline.at(-1).text, '末尾章节');

const large = await readFile(new URL('../test-fixtures/large.md', import.meta.url), 'utf8');
const started = performance.now();
const model = analyzeDocument(large);
checkCoverage(large, model);
const matches = searchDocument(large, 'MENGX-LARGE', model);
assert.equal(matches.length, 90000);
assert.equal(model.outline.length, 90001);
for (const index of [0, 45, 45000, 89999]) {
  const hit = matches[index], chunk = model.chunks[hit.chunk];
  assert.equal(large.slice(hit.offset, hit.offset + 11), 'MENGX-LARGE');
  assert.ok(hit.offset >= chunk.start && hit.offset < chunk.end);
}
console.log(JSON.stringify({ bytes: Buffer.byteLength(large), chunks: model.chunks.length,
  headings: model.outline.length, matches: matches.length, analysisAndSearchMs: Math.round(performance.now() - started) }));
