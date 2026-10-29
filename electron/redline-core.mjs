import { diffArrays } from 'diff';
// Pure Proofline logic shared by the reader, the CLI and the MCP server.
// No DOM, no Node APIs: everything here works on strings.

export const REDLINE_TYPES = ['fix', 'expand', 'delete', 'ask'];
export const TYPE_LABELS = {
  zh: { fix: '修改', expand: '展开', delete: '删除', ask: '提问', highlight: '高亮', underline: '划线', note: '批注', bookmark: '书签' },
  en: { fix: 'Fix', expand: 'Expand', delete: 'Delete', ask: 'Ask', highlight: 'Highlight', underline: 'Underline', note: 'Note', bookmark: 'Bookmark' },
};

/** Split Markdown into top-level blocks. Each block keeps its trailing blank lines,
 * so joining every block's `text` reproduces the source exactly. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

export function splitBlocks(source) {
  const blocks = [];
  const lines = source.split(/(?<=\n)/);
  let current = '', start = 0, offset = 0, fence = null, trailing = false;
  const push = () => { if (current) { blocks.push({ start, end: start + current.length, text: current }); start += current.length; current = ''; } };
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(bare);
    if (fence) {
      current += line; offset += line.length;
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !bare.trim().slice(fenceMatch[1].length).trim()) fence = null;
      continue;
    }
    const blank = !bare.trim();
    if (!blank && trailing) { push(); trailing = false; }
    // Each top-level list item is its own block, so a revision of one item never drops its siblings.
    if (!blank && current && LIST_ITEM.test(bare) && LIST_ITEM.test(current.split('\n')[0])) push();
    if (!blank && fenceMatch) { if (current && !trailing) { push(); } fence = fenceMatch[1]; }
    else if (!blank && /^ {0,3}#{1,6}(\s|$)/.test(bare) && current) push();
    current += line; offset += line.length;
    if (blank && current.trim()) trailing = true;
    // A heading is always its own block.
    if (!blank && !fence && /^ {0,3}#{1,6}(\s|$)/.test(bare)) trailing = true;
  }
  push();
  return blocks;
}

export function blockAt(blocks, offset) {
  let low = 0, high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1, block = blocks[middle];
    if (offset < block.start) high = middle - 1;
    else if (offset >= block.end) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(blocks.length - 1, low));
}

function headingTrail(source, offset) {
  const trail = [];
  const re = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  let match;
  while ((match = re.exec(source)) && match.index <= offset) {
    const level = match[1].length;
    while (trail.length && trail.at(-1).level >= level) trail.pop();
    trail.push({ level, text: match[2].replace(/[*_`]/g, '') });
  }
  return trail.map((item) => item.text).join(' / ');
}

function locate(source, mark) {
  const anchor = mark.anchor || {};
  const quote = anchor.rawQuote || anchor.text || '';
  if (!quote) return -1;
  let best = -1, score = -Infinity;
  for (let at = source.indexOf(quote); at >= 0; at = source.indexOf(quote, at + 1)) {
    const value = (anchor.prefix && source.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix ? 1e6 : 0)
      + (anchor.suffix && source.slice(at + quote.length, at + quote.length + anchor.suffix.length) === anchor.suffix ? 1e6 : 0)
      - Math.abs(at - (anchor.sourceOffset || 0));
    if (value > score) { score = value; best = at; }
  }
  return best;
}

/** Turn open redline marks into numbered tasks, grouped by the block they sit in. */
export function buildTasks(source, marks, { includeStatuses = ['open', 'sent', 'unchanged', 'question'] } = {}) {
  const redlines = marks.filter((mark) => REDLINE_TYPES.includes(mark.type) && includeStatuses.includes(mark.status || 'open'));
  const blocks = splitBlocks(source);
  const located = redlines.map((mark) => ({ mark, at: locate(source, mark) }))
    .sort((a, b) => (a.at < 0 ? Infinity : a.at) - (b.at < 0 ? Infinity : b.at));
  const all = marks.filter((mark) => REDLINE_TYPES.includes(mark.type)).map((mark) => ({ mark, at: locate(source, mark) }))
    .sort((a, b) => (a.at < 0 ? Infinity : a.at) - (b.at < 0 ? Infinity : b.at));
  const numbers = new Map(all.map((entry, index) => [entry.mark.id, index + 1]));
  // 1-based line numbers so a command-line agent can jump straight to the spot.
  const lineStarts = [0];
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (offset) => { let low = 0, high = lineStarts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid - 1; } return low + 1; };
  return located.map(({ mark, at }) => {
    const blockIndex = at < 0 ? -1 : blockAt(blocks, at);
    const block = blockIndex >= 0 ? blocks[blockIndex] : null;
    return {
      n: numbers.get(mark.id), id: mark.id, type: mark.type, quote: mark.anchor?.text || '',
      instruction: mark.note || '', question: mark.status === 'question' ? mark.question || '' : '', heading: at < 0 ? '' : headingTrail(source, at),
      blockIndex, blockStart: block?.start ?? -1, blockEnd: block?.end ?? -1,
      block: block ? block.text.replace(/\s+$/, '') : '', orphaned: at < 0,
      line: at < 0 ? 0 : lineOf(at),
      lineEnd: at < 0 ? 0 : lineOf(Math.max(at, at + (mark.anchor?.rawQuote || mark.anchor?.text || '').length - 1)),
    };
  });
}

const RULES = {
  zh: {
    title: (name) => `# Proofline 修订任务：${name}`,
    chatIntro: (name) => `你是一名严谨的文档修订助手。请根据下面的 批注修订文档《${name}》。文档全文附在最后。`,
    agentIntro: (file) => `请直接修改文件 \`${file}\`，逐条处理下面的 批注。每条批注都标明了它在文件中的行号。`,
    chatRules: [
      '只修改批注所在的段落，其他内容一字不改。',
      '保留原有的 Markdown 格式（标题、列表、表格、代码、公式、链接）。',
      '只返回需要修改的段落，不要返回全文，也不要在块外写解释。每个段落使用下面的格式，内容是修订后的完整段落：',
      '<<<REDLINE #编号\n修订后的完整段落\n>>>',
      '多条批注位于同一段落时，只返回一次，编号用逗号分隔，例如 <<<REDLINE #2,#3。',
      '「删除」批注：删去标记的文字；如果整个段落都应删除，返回一个空块。',
      '「提问」批注：不要修改文档，用下面的格式回答：\n<<<ANSWER #编号\n你的回答\n>>>',
    ],
    agentRules: (scope) => [
      '只修改批注所在的段落，其他内容保持原样，包括空行和 Markdown 格式。',
      '行号按任务生成时的文件计算。先改前面的批注会让后面的行号移动，所以请从文件末尾往前处理，或以「标记文字」为准核对位置。',
      scope === 'folder' ? '除非批注明确要求，不要修改或创建其他文件。' : '不要创建或修改其他任何文件。',
      '不要修改 `*.redline.json` 文件，也不要删除本任务文件以外的内容。',
      '「删除」批注：删去标记的文字；如整段都应删除，则删除该段。',
      '「提问」批注：不要修改文档，在最终回复中用下面的格式回答：\n<<<ANSWER #编号\n你的回答\n>>>',
      '完成后用一两句话说明改了哪些地方。',
    ],
    list: '## 批注',
    type: { fix: '修改', expand: '展开', delete: '删除', ask: '提问' },
    where: '位置', lines: (a, b) => (a === b ? `第 ${a} 行` : `第 ${a}–${b} 行`), block: '所在段落', marked: '标记文字', instruction: '要求', none: '（未填写，按批注类型处理）',
    defaults: { fix: '修正这段文字中的问题。', expand: '展开写得更充分、更具体。', delete: '删除标记的文字。', ask: '回答关于这段文字的问题。' },
    document: '## 文档全文',
    orphaned: '（原文已变化，找不到这段文字，请根据标记文字自行判断位置）',
  },
  en: {
    title: (name) => `# Proofline revision task: ${name}`,
    chatIntro: (name) => `You are a careful document editor. Revise the document "${name}" according to the notes below. The full document is attached at the end.`,
    agentIntro: (file) => `Edit the file \`${file}\` directly and address every note below. Each note gives its line number in the file.`,
    chatRules: [
      'Change only the paragraphs that carry a note. Leave everything else exactly as it is.',
      'Keep the existing Markdown formatting (headings, lists, tables, code, math, links).',
      'Return only the paragraphs you changed, never the whole document, and write nothing outside the blocks. Use this format; the content is the full revised paragraph:',
      '<<<REDLINE #number\nrevised paragraph\n>>>',
      'When several notes share a paragraph, return it once with comma-separated numbers, e.g. <<<REDLINE #2,#3.',
      'Delete notes: remove the marked text; if the whole paragraph should go, return an empty block.',
      'Ask notes: do not change the document. Answer in this format:\n<<<ANSWER #number\nyour answer\n>>>',
    ],
    agentRules: (scope) => [
      'Change only the paragraphs that carry a note; keep everything else, including blank lines and Markdown formatting.',
      'Line numbers refer to the file as it was when this task was written. Editing an earlier note shifts later lines, so work from the end of the file upward, or confirm each spot with the marked text.',
      scope === 'folder' ? 'Do not create or modify other files unless a note explicitly asks for it.' : 'Do not create or modify any other file.',
      'Do not modify `*.redline.json` files.',
      'Delete notes: remove the marked text; delete the paragraph if all of it should go.',
      'Ask notes: do not change the document; answer in your final reply using:\n<<<ANSWER #number\nyour answer\n>>>',
      'When finished, summarize what you changed in one or two sentences.',
    ],
    list: '## Notes',
    type: { fix: 'Fix', expand: 'Expand', delete: 'Delete', ask: 'Ask' },
    where: 'Location', lines: (a, b) => (a === b ? `line ${a}` : `lines ${a}–${b}`), block: 'Paragraph', marked: 'Marked text', instruction: 'Instruction', none: '(none given; act on the note type)',
    defaults: { fix: 'Correct the problem in this passage.', expand: 'Develop this passage in more depth and detail.', delete: 'Remove the marked text.', ask: 'Answer the question about this passage.' },
    document: '## Full document',
    orphaned: '(The passage changed and could not be located; use the marked text to find it.)',
  },
};

function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}markdown\n${text}\n${marks}`;
}

const AGENT = {
  zh: {
    title: (name) => `# Proofline 修订任务：${name}`,
    file: (file, lines) => `文档文件：\`${file}\`（在当前工作目录下，共 ${lines} 行）。`,
    readTitle: '## 第一步：通读全文',
    read: (file) => `请先从头到尾完整读一遍 \`${file}\`，弄清全文的主题、结构、术语和语气，再处理下面的批注。修改要和全文保持一致，不要只看批注附近的几行。`,
    noteTitle: '## 用户的补充说明', noNote: '（无）',
    listTitle: (n) => `## 批注（共 ${n} 条）`,
    type: { fix: '修改', expand: '展开', delete: '删除', ask: '提问' },
    lines: (a, b) => (a === b ? `第 ${a} 行` : `第 ${a}–${b} 行`), where: '章节',
    marked: '标记内容', instruction: '用户要求', block: '所在段落原文',
    asked: '你上次的疑问', askedHint: '（用户已经看过这个疑问，补充内容写在上面的「用户要求」或「用户的补充说明」里）',
    defaults: { fix: '修正这段文字中的问题。', expand: '展开写得更充分、更具体。', delete: '删除标记的文字。', ask: '回答关于这段文字的问题。' },
    orphaned: '（原文已变化，找不到这段文字，请根据标记内容在全文中判断位置）',
    rulesTitle: '## 处理规则',
    rules: (file, scope) => [
      '只修改批注所在的段落，其他内容保持原样，包括空行和 Markdown 格式。',
      '行号按任务生成时的文件计算。请从文件末尾往前处理，并用「标记内容」核对位置，避免前面的修改让行号错位。',
      '「删除」：删去标记的文字；如果整段都应删除，删除该段。',
      '「提问」：不要修改文档，在回复里用 ANSWER 格式回答。',
      '有疑问就先问，不要猜：如果某条要求不清楚、和全文其他地方矛盾，或者改了会影响别处，这一条先不要改，在回复里用 QUESTION 格式写出你的问题。其他没有疑问的批注照常处理。',
      scope === 'folder' ? `除非批注明确要求，只修改 \`${file}\`，不要创建或修改其他文件。` : `只修改 \`${file}\`，不要创建或修改其他任何文件。`,
      '不要修改 `*.redline.json` 和本任务文件。',
    ],
    replyTitle: '## 完成后的回复',
    reply: '逐条说明处理结果，每条一行：「#编号 已修改 / 已回答 / 有疑问 / 未修改：一句话说明」，最后用一两句话总结改了什么。回答和疑问分别用下面的格式（编号换成批注的数字）：',
  },
  en: {
    title: (name) => `# Proofline revision task: ${name}`,
    file: (file, lines) => `Document: \`${file}\` (in the current working directory, ${lines} lines).`,
    readTitle: '## Step 1: read the whole document',
    read: (file) => `Read \`${file}\` from beginning to end before handling the notes below, so you understand its subject, structure, terms and tone. Keep every change consistent with the whole document, not just the lines around a note.`,
    noteTitle: "## The user's additional notes", noNote: '(none)',
    listTitle: (n) => `## Notes (${n})`,
    type: { fix: 'Fix', expand: 'Expand', delete: 'Delete', ask: 'Ask' },
    lines: (a, b) => (a === b ? `line ${a}` : `lines ${a}–${b}`), where: 'Section',
    marked: 'Marked text', instruction: 'User instruction', block: 'Paragraph as written',
    asked: 'Your earlier question', askedHint: '(The user has seen this question; their answer is in the instruction above or in the additional notes.)',
    defaults: { fix: 'Correct the problem in this passage.', expand: 'Develop this passage in more depth and detail.', delete: 'Remove the marked text.', ask: 'Answer the question about this passage.' },
    orphaned: '(The passage changed and could not be located; use the marked text to find it in the document.)',
    rulesTitle: '## Rules',
    rules: (file, scope) => [
      'Change only the paragraphs that carry a note; keep everything else, including blank lines and Markdown formatting.',
      'Line numbers refer to the file as it was when this task was written. Work from the end of the file upward and confirm each spot with the marked text, so earlier edits do not shift later lines.',
      'Delete: remove the marked text; if the whole paragraph should go, delete the paragraph.',
      'Ask: do not change the document; answer in your reply using the ANSWER format.',
      'Ask rather than guess: if a note is unclear, contradicts the rest of the document, or would affect other parts, do not change it; write your question in the QUESTION format. Handle the other notes as usual.',
      scope === 'folder' ? `Unless a note explicitly asks for it, change only \`${file}\` and do not create or modify other files.` : `Change only \`${file}\`; do not create or modify any other file.`,
      'Do not modify `*.redline.json` files or this task file.',
    ],
    replyTitle: '## Your reply when finished',
    reply: 'Report each note on its own line: "#number changed / answered / question / not changed: one sentence", then summarize the changes in one or two sentences. Use these formats for answers and questions (replace number with the note number):',
  },
};

function buildAgentPrompt({ language, name, file, source, tasks, scope, note }) {
  const copy = AGENT[language] || AGENT.zh;
  const target = file || name, lineCount = source ? source.split('\n').length - (source.endsWith('\n') ? 1 : 0) : 0;
  const out = [copy.title(name), '', copy.file(target, lineCount), '', copy.readTitle, '', copy.read(target), '',
    copy.noteTitle, '', String(note || '').trim() || copy.noNote, '', copy.listTitle(tasks.length), ''];
  for (const task of tasks) {
    const at = task.line ? ` · ${copy.lines(task.line, task.lineEnd || task.line)}` : '';
    out.push(`### #${task.n} ${copy.type[task.type]}${at}${task.heading ? ` · ${copy.where}：${task.heading}` : ''}`);
    if (task.orphaned) out.push(copy.orphaned);
    out.push(`- ${copy.marked}：「${task.quote.replace(/\s+/g, ' ').slice(0, 600)}」`);
    out.push(`- ${copy.instruction}：${task.instruction.trim() || copy.defaults[task.type]}`);
    if (task.question) out.push(`- ${copy.asked}：${task.question.replace(/\s+/g, ' ').slice(0, 1200)} ${copy.askedHint}`);
    if (!task.orphaned && task.block && task.block.length < 1600) out.push(`- ${copy.block}：`, fence(task.block));
    out.push('');
  }
  out.push(copy.rulesTitle, '');
  copy.rules(target, scope).forEach((rule, index) => out.push(`${index + 1}. ${rule}`));
  out.push('', copy.replyTitle, '', copy.reply, '', '<<<ANSWER #编号'.replace('编号', language === 'en' ? 'number' : '编号'), '…', '>>>', '',
    '<<<QUESTION #编号'.replace('编号', language === 'en' ? 'number' : '编号'), '…', '>>>');
  return out.join('\n');
}

export function buildPrompt({ mode = 'chat', language = 'zh', name, file, source, tasks, scope = 'file', note = '' }) {
  if (mode === 'agent') return buildAgentPrompt({ language, name, file, source, tasks, scope, note });
  const copy = RULES[language] || RULES.zh;
  const lines = [copy.title(name), '', mode === 'chat' ? copy.chatIntro(name) : copy.agentIntro(file || name), ''];
  (mode === 'chat' ? copy.chatRules : copy.agentRules(scope)).forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
  lines.push('', copy.list, '');
  for (const task of tasks) {
    const at = task.line ? ` ${copy.lines(task.line, task.lineEnd || task.line)}` : '';
    lines.push(`### #${task.n} [${copy.type[task.type]}]${at}${task.heading ? ` · ${copy.where}: ${task.heading}` : ''}`);
    if (task.orphaned) lines.push(copy.orphaned);
    else if (mode === 'chat' || task.block.length < 1600) lines.push(`${copy.block}:`, fence(task.block));
    lines.push(`${copy.marked}: "${task.quote.replace(/\s+/g, ' ').slice(0, 600)}"`);
    lines.push(`${copy.instruction}: ${task.instruction.trim() || copy.defaults[task.type] || copy.none}`, '');
  }
  if (mode === 'chat') lines.push(copy.document, '', fence(source));
  return lines.join('\n');
}

/** Parse a chat or agent reply into block replacements and answers. */
export function parseReply(text) {
  const value = String(text || '').replace(/\r\n/g, '\n');
  const patches = [], answers = new Map(), questions = new Map();
  const re = /<<<[ \t]*(REDLINE|ANSWER|QUESTION)[ \t]+((?:#?\d+[ \t]*[,，、]?[ \t]*)+)\r?\n?([\s\S]*?)\n?>>>/g;
  let match;
  while ((match = re.exec(value))) {
    const numbers = [...match[2].matchAll(/\d+/g)].map((item) => Number(item[0]));
    const body = match[3].replace(/^\n+|\n+$/g, '');
    if (match[1] === 'ANSWER') numbers.forEach((n) => answers.set(n, body));
    else if (match[1] === 'QUESTION') numbers.forEach((n) => questions.set(n, body));
    else patches.push({ numbers, text: unwrapFence(body) });
  }
  return { patches, answers, questions, structured: patches.length > 0 || answers.size > 0 || questions.size > 0 };
}

function unwrapFence(text) {
  const match = /^(`{3,}|~{3,})(?:markdown|md)?\n([\s\S]*?)\n\1\s*$/.exec(text.trim());
  return match ? match[2] : text;
}

/** If the reply is a whole revised document rather than blocks, return it. */
export function extractFullDocument(text, original) {
  let value = unwrapFence(String(text || '').replace(/\r\n/g, '\n').trim());
  if (!value || value.length < Math.min(200, original.length * 0.4)) return null;
  return value.endsWith('\n') ? value : value + '\n';
}

/** Apply block patches to the source. Each patch replaces whole blocks. */
export function applyPatches(source, tasks, patches) {
  const byNumber = new Map(tasks.map((task) => [task.n, task]));
  const blocks = splitBlocks(source);
  const replacements = new Map();
  const missing = [];
  for (const patch of patches) {
    const indexes = [...new Set(patch.numbers.map((n) => byNumber.get(n)?.blockIndex).filter((index) => Number.isInteger(index) && index >= 0))];
    if (!indexes.length) { missing.push(...patch.numbers); continue; }
    indexes.sort((a, b) => a - b);
    indexes.forEach((index, position) => replacements.set(index, position === 0 ? patch.text : ''));
  }
  let output = '';
  blocks.forEach((block, index) => {
    if (!replacements.has(index)) { output += block.text; return; }
    const trailing = /\s*$/.exec(block.text)[0];
    const text = replacements.get(index).replace(/\s+$/, '');
    output += text ? text + (trailing.includes('\n\n') ? trailing : '\n\n') : '';
  });
  return { source: output, missing };
}

/** Block-level diff. Returns hunks of equal or changed blocks. */
export function diffBlocks(base, next) {
  const a = splitBlocks(base), b = splitBlocks(next);
  const parts = diffArrays(a, b, { comparator: (left, right) => left.text === right.text, timeout: 1500 })
    || [{ removed: true, value: a }, { added: true, value: b }];
  const hunks = [];
  let ai = 0, bi = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      hunks.push({ type: 'equal', base: range(ai, ai + part.value.length), next: range(bi, bi + part.value.length) });
      ai += part.value.length; bi += part.value.length;
    } else {
      let hunk = hunks.at(-1);
      if (hunk?.type !== 'change') { hunk = { type: 'change', id: 'h' + hunks.length, base: [], next: [] }; hunks.push(hunk); }
      if (part.removed) { hunk.base.push(...range(ai, ai + part.value.length)); ai += part.value.length; }
      if (part.added) { hunk.next.push(...range(bi, bi + part.value.length)); bi += part.value.length; }
    }
  }
  return { baseBlocks: a, nextBlocks: b, hunks };
}

function range(from, to) { return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index); }

/** Compose the final source from per-hunk decisions ('accept' | 'reject'). */
export function composeReview(diff, decisions) {
  let output = '';
  for (const hunk of diff.hunks) {
    if (hunk.type === 'equal') { output += hunk.base.map((index) => diff.baseBlocks[index].text).join(''); continue; }
    const accepted = decisions[hunk.id] !== 'reject';
    const blocks = accepted ? hunk.next.map((index) => diff.nextBlocks[index]) : hunk.base.map((index) => diff.baseBlocks[index]);
    output += blocks.map((block) => block.text).join('');
  }
  return output;
}

/** Which tasks a change hunk touches, by the base block range. */
export function tasksForHunk(diff, hunk, tasks) {
  if (hunk.type !== 'change') return [];
  if (hunk.base.length) {
    const start = diff.baseBlocks[hunk.base[0]].start, end = diff.baseBlocks[hunk.base.at(-1)].end;
    return tasks.filter((task) => task.blockStart >= start && task.blockStart < end);
  }
  return [];
}
