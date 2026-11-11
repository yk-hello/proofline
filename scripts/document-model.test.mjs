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

// A large pasted picture (one long data: line) is rendered, not shown as plain text,
// and its base64 is not counted as words.
{
  const { analyzeDocument: analyze } = await import('../src/document-model.js');
  const picture = '![图](data:image/png;base64,' + 'A'.repeat(300000) + ')';
  const model = analyze(`# 标题\n\n开头文字。\n\n${picture}\n\n结尾文字。\n`);
  if (model.chunks.some((chunk) => chunk.plain)) throw new Error('picture line fell back to plain text');
  if (model.wordCount > 20) throw new Error(`base64 counted as words: ${model.wordCount}`);
  console.log('large picture line ok');
}
{
  // Only the oversized block falls back to plain text; the heading and paragraph before it stay formatted.
  const table = ['| 序号 | 数值 |', '| ---: | ---: |', ...Array.from({ length: 4000 }, (_, row) => `| ${row + 1} | ${row * 97} |`)].join('\n');
  const source = `# 报告\n\n开头的说明文字。\n\n## 明细\n\n${table}\n\n## 结论\n\n结尾。\n`;
  const model = analyzeDocument(source);
  checkCoverage(source, model);
  assert.deepEqual(model.outline.map((heading) => heading.text), ['报告', '明细', '结论']);
  assert.equal(model.chunks[0].plain, false, 'text before the oversized table keeps its formatting');
  assert.ok(source.slice(model.chunks[0].start, model.chunks[0].end).includes('## 明细'));
  assert.ok(!source.slice(model.chunks[0].start, model.chunks[0].end).includes('| 序号 |'));
  assert.equal(model.chunks[1].plain, true);
  assert.ok(source.slice(model.chunks[1].start, model.chunks[1].end).trimStart().startsWith('| 序号 |'));
  assert.equal(model.chunks[model.outline[2].chunk].plain, false, 'the section after the table is formatted again');
  const code = `# 代码\n\n说明。\n\n\`\`\`js\n${'const value = 1;\n'.repeat(6000)}\`\`\`\n\n## 之后\n\n完。\n`;
  const codeModel = analyzeDocument(code);
  checkCoverage(code, codeModel);
  assert.equal(codeModel.chunks[0].plain, false);
  assert.ok(code.slice(codeModel.chunks[1].start, codeModel.chunks[1].end).trimStart().startsWith('```js'));
  console.log('oversized block keeps preceding text formatted ok');
}
