import assert from 'node:assert/strict';
import { marked, markdownTokens } from '../src/markdown-parser.js';
import { analyzeDocument, sourceForChunk, searchDocument } from '../src/document-model.js';

const cases = [
  ['table-task', '# GFM\n\n| a | b |\n| --- | --- |\n| 中文 | 1 |\n\n- [x] 完成\n- [ ] 待办', /<table>[\s\S]*checkbox/],
  ['definitions', '术语 :: 解释\nstd::cout << value;\n\n第二个术语\n: 标准定义\n: 另一个解释\n', /<dt>第二个术语<\/dt>[\s\S]*标准定义/],
  ['footnotes', '中文引用[^a]。\n\n[^a]: 脚注正文。', /data-footnote-ref[\s\S]*脚注正文/],
  ['quote-html', '> 外层\n> > 内层\n\n<details><summary>摘要</summary>正文</details>', /<blockquote>[\s\S]*<blockquote>[\s\S]*<details>/],
  ['malformed', '# 标题\n\n[未关闭链接\n\n```js\nunterminated\n', /未关闭链接[\s\S]*unterminated/],
];
for (const [name, source, expected] of cases) assert.match(marked.parse(source), expected, name);
const cpp = marked.parse(cases[1][1]);
assert.match(cpp, /<p>std::cout &lt;&lt; value;<\/p>/);
assert.doesNotMatch(cpp, /<dt>std/);
assert.equal(markdownTokens('词\n: 解释\n\n普通正文\n').find((token) => token.type === 'definitionListsMultiLine').raw, '词\n: 解释');

const source = '一级标题\n========\n\n引用 [跨区块][doc] 和脚注[^note]。\n\n' + '中间段落。\n\n'.repeat(1200) +
  '二级标题\n--------\n\n[doc]: https://example.test/document\n[^note]: 完整脚注正文。\n    续行说明。\n';
const model = analyzeDocument(source);
assert.deepEqual(model.outline.map((item) => [item.level, item.text]), [[1, '一级标题'], [2, '二级标题']]);
const chunk = model.chunks[0];
const contextual = sourceForChunk(source, chunk, model);
assert.match(marked.parse(contextual), /href="https:\/\/example.test\/document"/);
assert.match(marked.parse(contextual), /完整脚注正文/);
assert.equal(source.slice(model.referenceDefinitions.doc.start, model.referenceDefinitions.doc.end).trim(), '[doc]: https://example.test/document');
assert.equal(searchDocument(source, 'document', model)[0].offset, source.indexOf('document'));
console.log(JSON.stringify({ passed: cases.map(([name]) => name), crossChunkReferences: true, setextOutline: true }));
