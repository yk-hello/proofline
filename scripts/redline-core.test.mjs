import assert from 'node:assert/strict';
import { splitBlocks, buildTasks, buildPrompt, parseReply, applyPatches, diffBlocks, composeReview, extractFullDocument } from '../electron/redline-core.mjs';

const source = `# 标题

第一段文字。包含 300 万人这个数字。

## 二、市场规模
第二段第一行
第二段第二行

\`\`\`js
const a = 1;

const b = 2;
\`\`\`

- 列表一
- 列表二

最后一段`;
const blocks = splitBlocks(source);
assert.equal(blocks.map((b) => b.text).join(''), source, 'blocks reproduce source');
assert.equal(blocks.length, 8, JSON.stringify(blocks.map((b) => b.text)));
assert.ok(blocks[4].text.includes('const b = 2;'), 'fence kept whole');

const marks = [
  { id: 'a', type: 'fix', note: '补充来源', status: 'open', anchor: { text: '300 万人', rawQuote: '300 万人', sourceOffset: source.indexOf('300 万人') } },
  { id: 'b', type: 'ask', note: '为什么？', status: 'open', anchor: { text: '第二段第二行', rawQuote: '第二段第二行', sourceOffset: source.indexOf('第二段第二行') } },
  { id: 'c', type: 'highlight', anchor: { text: '列表一' } },
];
const tasks = buildTasks(source, marks);
assert.deepEqual(tasks.map((t) => t.n), [1, 2]);
assert.equal(tasks[1].heading, '标题 / 二、市场规模');
const prompt = buildPrompt({ mode: 'chat', language: 'zh', name: 'a.md', source, tasks });
assert.ok(prompt.includes('#1 [修改]') && prompt.includes('文档全文'));
const agent = buildPrompt({ mode: 'agent', language: 'en', name: 'a.md', file: 'a.md', source, tasks, scope: 'file' });
assert.ok(!agent.includes('Full document'));
const agentZh = buildPrompt({ mode: 'agent', language: 'zh', name: 'a.md', file: 'a.md', source, tasks, note: '读者是投资人' });
assert.ok(agentZh.includes('通读全文') && agentZh.includes('读者是投资人') && /### #1 修改 · 第 \d+(–\d+)? 行/.test(agentZh) && agentZh.includes('标记内容：「') && agentZh.includes('QUESTION'));
assert.ok(!parseReply(agentZh).questions.size && !parseReply(agentZh).answers.size, 'the format examples in the prompt are not parsed as replies');
const asked = buildTasks(source, marks.map((mark) => mark.id === 'a' ? { ...mark, status: 'question', question: '改成多少？' } : mark));
assert.equal(asked[0].question, '改成多少？');
assert.ok(buildPrompt({ mode: 'agent', language: 'zh', name: 'a.md', file: 'a.md', source, tasks: asked }).includes('你上次的疑问：改成多少？'));
assert.equal(parseReply('完成\n<<<QUESTION #1\n要改成多少？\n>>>').questions.get(1), '要改成多少？');

const reply = `好的：\n<<<REDLINE #1\n第一段文字。据公开数据约 200–350 万人。\n>>>\n<<<ANSWER #2\n因为这样。\n>>>`;
const parsed = parseReply(reply);
assert.equal(parsed.patches.length, 1); assert.equal(parsed.answers.get(2), '因为这样。');
const applied = applyPatches(source, tasks, parsed.patches);
assert.ok(applied.source.includes('200–350 万人') && !applied.source.includes('300 万人'));
assert.ok(applied.source.includes('\n\n## 二、市场规模'), applied.source);

const diff = diffBlocks(source, applied.source);
const changes = diff.hunks.filter((h) => h.type === 'change');
assert.equal(changes.length, 1);
assert.equal(composeReview(diff, {}), applied.source);
assert.equal(composeReview(diff, { [changes[0].id]: 'reject' }), source);

const empty = applyPatches(source, tasks, [{ numbers: [1], text: '' }]);
assert.ok(!empty.source.includes('第一段'));
assert.equal(extractFullDocument('short', source), null);
console.log('redline-core ok');
{
  const list = '# A\n\n1. 第一项\n2. 第二项\n   续行\n3. 第三项\n\n段落';
  const b = splitBlocks(list);
  assert.equal(b.map((x) => x.text).join(''), list);
  assert.equal(b.length, 5, JSON.stringify(b.map((x) => x.text)));
  const marks = [{ id: 'x', type: 'fix', status: 'open', note: '', anchor: { text: '第二项', rawQuote: '第二项', sourceOffset: list.indexOf('第二项') } }];
  const tasks = buildTasks(list, marks);
  const out = applyPatches(list, tasks, parseReply('<<<REDLINE #1\n2. 第二项（改）\n   续行\n>>>').patches).source;
  assert.ok(out.includes('1. 第一项') && out.includes('3. 第三项') && out.includes('第二项（改）'), out);
  assert.equal(parseReply('<<<REDLINE #1\n1. 列表\n>>>').patches[0].text, '1. 列表');
  console.log('list blocks ok');
}

{
  const original = '    console.log(1);\n', proposed = 'console.log(1);\n';
  const diff = diffBlocks(original, proposed);
  assert.equal(diff.hunks.filter((h) => h.type === 'change').length, 1);
  assert.equal(composeReview(diff, {}), proposed);
  const blocks = Array.from({length: 3000}, (_, i) => 'paragraph ' + i + '\n\n');
  const before = blocks.join(''); blocks[100] = 'changed 100\n\n'; blocks[2900] = 'changed 2900\n\n';
  const after = blocks.join(''), sparse = diffBlocks(before, after);
  assert.equal(sparse.hunks.filter((h) => h.type === 'change').length, 2);
  assert.equal(composeReview(sparse, {}), after);
  console.log('indentation and long sparse diffs ok');
}

// Precise targeting: anchors around the selected characters, and changes outside them set aside.
{
  const { anchorDocument, resolveAnchors, stripAnchors, buildTasks: tasksOf, buildPrompt: promptOf } = await import('../electron/redline-core.mjs');
  const doc = '# 价格\n\n编号 36361 是订单号。\n\n另一段也有 6。\n';
  const at = doc.indexOf('36361') + 3;
  const marks = [
    { id: 'a', type: 'fix', status: 'open', note: '改成 gemini', anchor: { text: '6', rawQuote: '6', prefix: '编号 363', suffix: '1 是', sourceOffset: at } },
    { id: 'b', type: 'ask', status: 'open', note: '这是什么编号？', anchor: { text: '订单号', rawQuote: '订单号', prefix: '是', suffix: '。', sourceOffset: doc.indexOf('订单号') } },
  ];
  const tasks = tasksOf(doc, marks);
  assert.deepEqual(tasks.map((task) => doc.slice(task.start, task.end)), ['6', '订单号']);
  const plan = anchorDocument(doc, tasks);
  assert.equal(plan.text, '# 价格\n\n编号 363[[PL-1]]6[[/PL-1]]1 是[[PL-2]]订单号[[/PL-2]]。\n\n另一段也有 6。\n');
  assert.equal(stripAnchors(plan.text), doc);
  const prompt = promptOf({ mode: 'agent', language: 'zh', name: 'a.md', file: 'a.md', source: doc, tasks, anchors: plan });
  assert.match(prompt, /只修改锚点之间的文字/);
  assert.match(prompt, /第 2 处（共 2 处）/);
  assert.match(prompt, /编号 363\[\[PL-1\]\]6\[\[\/PL-1\]\]1/);
  // A careless AI replaces every 6: only the selected one survives, the rest are listed.
  const greedy = plan.text.replace(/6/g, 'gemini');
  const result = resolveAnchors(doc, plan, greedy);
  assert.equal(result.scoped, '# 价格\n\n编号 363gemini1 是订单号。\n\n另一段也有 6。\n');
  assert.equal(result.full, doc.replace(/6/g, 'gemini'));
  assert.deepEqual(result.outside.map((item) => [item.before, item.after]), [['6', 'gemini'], ['6', 'gemini']]);
  // A careful AI: nothing is set aside.
  const careful = resolveAnchors(doc, plan, plan.text.replace('[[PL-1]]6[[/PL-1]]', '[[PL-1]]gemini[[/PL-1]]'));
  assert.equal(careful.scoped, careful.full); assert.equal(careful.outside.length, 0);
  // Deleting anchors falls back to the full result and says which notes lost them.
  const lost = resolveAnchors(doc, plan, greedy.replace('[[PL-2]]', ''));
  assert.equal(lost.ok, false); assert.deepEqual(lost.missing, [2]); assert.equal(lost.scoped, lost.full);
  // CRLF from the AI does not count as an outside change.
  assert.equal(resolveAnchors(doc, plan, plan.text.replace(/\n/g, '\r\n')).outside.length, 0);
  // Overlapping marks share one anchor; a document that already contains anchor text is left alone.
  const overlap = anchorDocument('abcdef\n', [{ n: 1, start: 0, end: 4 }, { n: 2, start: 2, end: 6 }]);
  assert.equal(overlap.text, '[[PL-1]]abcdef[[/PL-1]]\n'); assert.equal(overlap.groupOf.get(2), 1);
  assert.equal(anchorDocument('see [[PL-1]] here', [{ n: 1, start: 0, end: 3 }]).enabled, false);
  console.log('precise anchors ok');
}
