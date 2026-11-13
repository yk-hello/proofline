import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeDocument, searchDocument, sourceForChunk } from '../src/document-model.js';

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
  // The table itself is cut between rows; every piece can be drawn as a table.
  assert.ok(model.chunks.every((chunk) => !chunk.plain), 'a large table no longer falls back to plain text');
  const pieces = model.chunks.filter((chunk) => chunk.table);
  const head = '| 序号 | 数值 |\n| ---: | ---: |\n';
  assert.ok(pieces.length > 4, `expected several table pieces, got ${pieces.length}`);
  assert.equal(pieces[0].table.first, true);
  assert.ok(source.slice(pieces[0].start, pieces[0].end).startsWith(`${head}| 1 | 0 |`));
  for (const piece of pieces.slice(1)) {
    assert.equal(source.slice(piece.table.headStart, piece.table.headEnd), head);
    assert.match(source.slice(piece.start, piece.end), /^\| \d+ \| \d+ \|\n/, 'a piece starts at a row');
    assert.ok(source.slice(piece.start, piece.end).endsWith('|\n'), 'a piece ends at a row');
    assert.ok(sourceForChunk(source, piece, model).startsWith(`${head}| `));
  }
  assert.equal(pieces.map((piece) => source.slice(piece.start, piece.end)).join(''), `${table}\n`, 'the pieces are the table, nothing lost');
  assert.ok(pieces.every((piece) => piece.end - piece.start < 16000));
  assert.ok(!model.chunks[model.outline[2].chunk].table, 'the section after the table is an ordinary chunk');
  // A chart directive above a table this large: the table is shown, and the first piece says so.
  const charted = `# 图\n\n<!-- stetwise:chart type=bar -->\n${table}\n\n完。\n`;
  const chartedModel = analyzeDocument(charted);
  checkCoverage(charted, chartedModel);
  assert.equal(chartedModel.chunks.find((chunk) => chunk.table).table.chart, true);
  // An ordinary table is left whole.
  const small = `# 小表\n\n${table.split('\n').slice(0, 300).join('\n')}\n\n完。\n`;
  assert.ok(analyzeDocument(small).chunks.every((chunk) => !chunk.table && !chunk.plain));
  const code = `# 代码\n\n说明。\n\n\`\`\`js\n${'const value = 1;\n'.repeat(6000)}\`\`\`\n\n## 之后\n\n完。\n`;
  const codeModel = analyzeDocument(code);
  checkCoverage(code, codeModel);
  assert.equal(codeModel.chunks[0].plain, false);
  assert.ok(code.slice(codeModel.chunks[1].start, codeModel.chunks[1].end).trimStart().startsWith('```js'));
  // The code block is cut into pieces that know their language; it ends with its closing fence.
  const codePieces = codeModel.chunks.filter((chunk) => chunk.code !== undefined);
  assert.ok(codePieces.length > 3 && codePieces.every((chunk) => chunk.plain && chunk.code === 'js'));
  assert.ok(codePieces.slice(1).every((chunk) => chunk.end - chunk.start <= 13000), 'later pieces are small enough to highlight quickly');
  assert.ok(code.slice(codePieces.at(-1).start, codePieces.at(-1).end).endsWith('```\n'));
  const afterCode = codeModel.chunks[codeModel.outline.find((heading) => heading.text === '之后').chunk];
  assert.ok(!afterCode.plain && afterCode.code === undefined, 'text after the code block is formatted again');
  // A long line that is not code stays plain, and is not mistaken for code.
  const longLine = analyzeDocument(`# 行\n\n${'字'.repeat(90000)}\n\n完。\n`);
  assert.ok(longLine.chunks.some((chunk) => chunk.plain) && longLine.chunks.every((chunk) => chunk.code === undefined));
  console.log('oversized table is cut between rows, text before a large block stays formatted ok');
}
