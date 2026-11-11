import { textMatches } from './search.js';
// Source offsets keep large documents navigable without copying every line into React.
export function headingSlug(text, index = 0) {
  const base = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  return `${base}-${index}`;
}

export function analyzeDocument(source, progress = () => {}) {
  const outline = [];
  const chunks = [];
  const referenceDefinitions = Object.create(null);
  let start = 0, line = 0, chunkLine = 0, headingStart = 0;
  let fence = null, wordCount = 0, summary = '', title = '', lastProgress = -1;
  let chunkPlain = false, continuedLine = false;
  let previousLine = null, definition = null;
  // The last place the current chunk could be cut without splitting a block (a blank line or a heading).
  let boundary = 0, boundaryLine = 0, boundaryHeading = 0;
  function flush(end) {
    if (end <= start) return;
    const chars = end - start;
    chunks.push({ start, end, line: chunkLine, headingStart, plain: chunkPlain,
      // A bounded initial estimate; measured heights replace it when a chunk is read.
      height: Math.max(200, Math.min(6000, (line - chunkLine) * 18 + chars / 45 * 8)) });
    start = end; chunkLine = line; headingStart = outline.length; chunkPlain = Boolean(fence);
  }
  for (let offset = 0; offset < source.length;) {
    let next = source.indexOf('\n', offset);
    if (next < 0) next = source.length;
    else next += 1;
    const fullEnd = next;
    // A pasted or imported picture is one long data: line; keep it whole so it renders.
    const imageLine = fullEnd - offset > 40000 && fullEnd - offset < 16e6 && /^ {0,3}!\[[^\]\n]*\]\(data:image\/[\w.+-]+;base64,/.test(source.slice(offset, offset + 400));
    next = imageLine ? fullEnd : Math.min(next, offset + 40000);
    const oversizedLine = continuedLine || next < fullEnd;
    const raw = source.slice(offset, next).replace(/\r?\n$/, '');
    if (oversizedLine) {
      flush(offset);
      chunkPlain = true;
    }
    if (imageLine && offset > start) flush(offset);
    const heading = !fence && !oversizedLine && /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    const setext = !fence && !oversizedLine && /^ {0,3}(=+|-+)[ \t]*$/.exec(raw)
      && previousLine && previousLine.text.trim() && !/^\s*(?:[#>|]|[-*+]\s|\d+\.\s|\[.*\]:)/.test(previousLine.text);
    if (!fence && !oversizedLine && (heading || !raw.trim())) { boundary = offset; boundaryLine = line; boundaryHeading = outline.length; }
    // Split at structural boundaries, leaving normal tables, lists, quotes and fences whole.
    if (!fence && offset - start >= 5000 && (heading || !raw.trim())) flush(offset);
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fenceMatch) {
      if (!fence) fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      else if (fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) fence = null;
    } else if (!fence) {
      const reference = /^ {0,3}\[(\^?[^\]\n]+)\]:/.exec(raw);
      if (reference) {
        const label = reference[1].startsWith('^') ? reference[1] : reference[1].trim().replace(/\s+/g, ' ').toLowerCase();
        definition = { start: offset, end: next };
        referenceDefinitions[label] = definition;
      } else if (definition && (/^(?: {4}|\t)/.test(raw) || !raw.trim())) definition.end = next;
      else definition = null;
      if (heading || setext) {
        const text = (heading ? heading[2] : previousLine.text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
        const item = { level: heading ? heading[1].length : raw.trim()[0] === '=' ? 1 : 2, text, slug: headingSlug(text, outline.length),
          line: heading ? line : previousLine.line, offset: heading ? offset : previousLine.offset, chunk: chunks.length };
        outline.push(item);
        if (item.level === 1 && !title) title = text;
      } else if (!summary && raw.trim() && !/^\s*(?:[>|]|[-*+]\s|\d+\.\s|---+$|!\[)/.test(raw)) {
        summary = raw.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim().slice(0, 180);
      }
    }
    const counted = raw.length > 2000 ? raw.replace(/\(data:[^)\s]*\)/g, '') : raw;
    wordCount += (counted.match(/[\u3400-\u9fff]/g)?.length || 0) + (counted.match(/[A-Za-z0-9_]+/g)?.length || 0);
    if (next === fullEnd) line += 1;
    continuedLine = next < fullEnd;
    previousLine = !fence && !oversizedLine ? { text: raw, offset, line: line - 1 } : null;
    offset = next;
    // An enormous single block still gets bounded rendering; its fallback is plain text.
    if (oversizedLine || offset - start >= 40000) {
      const oversizedBlock = Boolean(fence) || (!heading && !imageLine) || oversizedLine;
      // Only the oversized block itself falls back to plain text: what stands before it in
      // this chunk (headings, paragraphs) is cut off first and keeps its formatting.
      if (oversizedBlock && !chunkPlain && !oversizedLine && boundary > start && boundary < offset) {
        const chars = boundary - start;
        chunks.push({ start, end: boundary, line: chunkLine, headingStart, plain: false,
          height: Math.max(200, Math.min(6000, (boundaryLine - chunkLine) * 18 + chars / 45 * 8)) });
        for (let index = boundaryHeading; index < outline.length; index++) outline[index].chunk += 1;
        start = boundary; chunkLine = boundaryLine; headingStart = boundaryHeading;
      }
      if (oversizedBlock) chunkPlain = true;
      flush(offset);
    }
    const percent = Math.floor(offset / Math.max(source.length, 1) * 100);
    if (percent >= lastProgress + 5) { progress(percent); lastProgress = percent; }
  }
  flush(source.length);
  const parents = [];
  outline.forEach((item, index) => {
    while (parents.length && outline[parents.at(-1)].level >= item.level) parents.pop();
    item.parent = parents.at(-1) ?? null;
    item.index = index;
    item.children = 0;
    if (item.parent !== null) outline[item.parent].children++;
    parents.push(index);
  });
  return { outline, chunks, referenceDefinitions, wordCount, summary, title, lines: line };
}

// Carry only the referenced definitions into a bounded, independently parsed chunk.
export function sourceForChunk(source, chunk, model) {
  const body = source.slice(chunk.start, chunk.end);
  const definitions = model.referenceDefinitions;
  if (!definitions || chunk.plain) return body;
  const labels = new Set();
  for (const match of body.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const value = match[2] || match[1];
    labels.add(value.startsWith('^') ? value : value.trim().replace(/\s+/g, ' ').toLowerCase());
  }
  const appended = [];
  let budget = 512000;
  for (const label of labels) {
    if (!Object.hasOwn(definitions, label)) continue;
    const definition = definitions[label];
    if (definition.start >= chunk.start && definition.start < chunk.end) continue;
    const length = definition.end - definition.start;
    if (length > budget) continue;
    budget -= length;
    appended.push(source.slice(definition.start, definition.end));
  }
  return appended.length ? `${body}\n\n${appended.join('\n\n')}` : body;
}

// Show what the reader sees in the result list, not Markdown syntax.
export function plainSnippet(value, cut = false) {
  const text = value
    .replace(/^\s*(?:#{1,6}|>+|[-*+]|\d+[.)])\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ').trim();
  return (cut ? '…' : '') + text.replace(/^· | ·$/g, '');
}

export function searchDocument(source, query, model, options = {}) {
  if (!query.trim()) return [];
  const results = [];
  let line = 0, chunkIndex = 0;
  for (let offset = 0; offset < source.length;) {
    let end = source.indexOf('\n', offset);
    if (end < 0) end = source.length;
    const text = source.slice(offset, end);
    for (const match of textMatches(text, query, options)) {
      const at = match.index;
      while (model.chunks[chunkIndex + 1]?.start <= offset + at) chunkIndex += 1;
      results.push({ index: results.length, offset: offset + at, length: match.length, text: match.text, line, chunk: chunkIndex,
        location: /^#{1,6}\s/.test(text) ? '标题' : /^\s*\|/.test(text) ? '表格' : /^\s*>/.test(text) ? '引用' : /^\s*(?:[-*+]|\d+[.)])\s/.test(text) ? '列表' : '正文',
        snippet: plainSnippet(text.slice(Math.max(0, at - 40), Math.min(text.length, at + match.length + 70)), at > 40) });
    }
    line += 1; offset = end + 1;
  }
  return results;
}
