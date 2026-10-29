// Text quotes and their surrounding source survive reflow and most small edits.
// This data belongs to the reader; it is never inserted into the source file.
export const ANNOTATIONS_KEY = 'mengx-reading-annotations-v1';

function closestMatch(source, quote, hint, prefix = '', suffix = '') {
  if (!quote) return -1;
  let best = -1, score = -Infinity, count = 0;
  for (let at = source.indexOf(quote); at >= 0 && count++ < 10000; at = source.indexOf(quote, at + Math.max(1, quote.length))) {
    const value = (prefix && source.slice(Math.max(0, at - prefix.length), at) === prefix ? 1000000 : 0)
      + (suffix && source.slice(at + quote.length, at + quote.length + suffix.length) === suffix ? 1000000 : 0) - Math.abs(at - hint);
    if (value > score) { best = at; score = value; }
  }
  return best;
}

// A bounded projection for selections crossing inline Markdown emphasis/links.
function project(source, base = 0) {
  const skip = new Set();
  for (const match of source.matchAll(/!?\[([^\]]*)\]\([^\n)]*\)/g)) {
    const start = match.index, textStart = start + (match[0][0] === '!' ? 2 : 1);
    for (let i = start; i < start + match[0].length; i++) if (i < textStart || i >= textStart + match[1].length) skip.add(i);
  }
  let text = ''; const offsets = [];
  for (let i = 0; i < source.length; i++) {
    if (skip.has(i) || /[*`~]/.test(source[i])) continue;
    if (source[i] === '_' && (!/\w/.test(source[i - 1] || '') || !/\w/.test(source[i + 1] || ''))) continue;
    text += source[i]; offsets.push(base + i);
  }
  return { text, offsets };
}

// Last resort: compare only visible characters. Drops whitespace (rendered line and
// paragraph breaks are absent from a DOM selection), inline markers, and block markers
// such as #, >, list bullets and table pipes, so selections across lines, paragraphs,
// headings and list items still find their source.
const SKELETON_SKIP = /[\s*`~_|\\]/;
function skeleton(source, base = 0) {
  const lineMarker = /^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)+/gm;
  const skip = new Uint8Array(source.length);
  for (const match of source.matchAll(lineMarker)) skip.fill(1, match.index, match.index + match[0].length);
  for (const match of source.matchAll(/!?\[([^\]\n]*)\]\([^\n)]*\)/g)) {
    const textStart = match.index + (match[0][0] === '!' ? 2 : 1);
    skip.fill(1, match.index, textStart); skip.fill(1, textStart + match[1].length, match.index + match[0].length);
  }
  let text = ''; const offsets = [];
  for (let i = 0; i < source.length; i++) {
    if (skip[i] || SKELETON_SKIP.test(source[i])) continue;
    text += source[i]; offsets.push(base + i);
  }
  return { text, offsets };
}
const squeeze = (value) => [...String(value || '')].filter((char) => !SKELETON_SKIP.test(char)).join('');

export function createTextAnchor(source, { text, sourceOffset = 0, regionStart = 0, regionEnd, prefix = '', suffix = '' }) {
  text = String(text || '').slice(0, 20000);
  if (!text.trim()) throw new TypeError('Select some document text first');
  const start = Math.max(0, regionStart), end = Math.min(source.length, regionEnd ?? start + 80000);
  const section = source.slice(start, end);
  let at = closestMatch(section, text, sourceOffset - start, prefix, suffix), to;
  if (at >= 0) { at += start; to = at + text.length; }
  else {
    const projection = project(section, start);
    const offset = closestMatch(projection.text, text, sourceOffset - start, prefix, suffix);
    if (offset >= 0) { at = projection.offsets[offset]; to = projection.offsets[offset + text.length - 1] + 1; }
    else {
      const bones = skeleton(section, start), needle = squeeze(text);
      if (!needle) throw new Error('The selection could not be anchored. Try selecting a shorter passage.');
      // The hint is a source offset; convert it to the skeleton's coordinates.
      let hint = 0; while (hint < bones.offsets.length && bones.offsets[hint] < sourceOffset) hint++;
      const found = closestMatch(bones.text, needle, hint, squeeze(prefix).slice(-24), squeeze(suffix).slice(0, 24));
      if (found < 0) throw new Error('The selection could not be anchored. Try selecting a shorter passage.');
      at = bones.offsets[found]; to = bones.offsets[found + needle.length - 1] + 1;
      // Keep the closing ** / ` / ] of an inline span the selection ended inside.
      while (to < source.length && /[*`~_]/.test(source[to]) && source.slice(at, to).split(source[to]).length % 2 === 0) to++;
    }
  }
  return { text, sourceOffset: at, sourceEnd: to, rawQuote: source.slice(at, to),
    prefix: source.slice(Math.max(0, at - 48), at), suffix: source.slice(to, to + 48),
    displayPrefix: prefix, displaySuffix: suffix };
}

export function resolveTextAnchor(source, anchor) {
  if (!anchor?.rawQuote) return { ...anchor, orphaned: true };
  const at = closestMatch(source, anchor.rawQuote, anchor.sourceOffset, anchor.prefix, anchor.suffix);
  return at < 0 ? { ...anchor, orphaned: true } : { ...anchor, sourceOffset: at, sourceEnd: at + anchor.rawQuote.length, orphaned: false };
}

export function readAnnotations(storage, key) {
  try { const items = JSON.parse(storage.getItem(ANNOTATIONS_KEY) || '{}')[key]; return Array.isArray(items) ? items : []; }
  catch { return []; }
}

export function writeAnnotations(storage, key, items) {
  let all;
  try { all = JSON.parse(storage.getItem(ANNOTATIONS_KEY) || '{}'); } catch { all = {}; }
  all[key] = items;
  storage.setItem(ANNOTATIONS_KEY, JSON.stringify(all));
}

function textNodes(region) {
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement.closest('.katex-mathml, .mermaid-diagram, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = []; let text = '', node;
  while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.textContent; }
  return { text, nodes };
}

// Selection endpoints can be text nodes, inline elements, or the edit region itself.
// Normalize all of them before resolving the virtual-document chunk that owns the text.
function closestEditRegion(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.('[data-edit-region]') || null;
}

export function captureReadingSelection(root, source, chunks = []) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !root) return null;
  let range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;
  // A drag that ends past the last line (or starts above the first) leaves an
  // endpoint outside the article: keep the part of the selection inside it.
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    range = range.cloneRange();
    const content = root.querySelector('[data-edit-region]')?.parentElement || root;
    if (!root.contains(range.startContainer)) range.setStart(content, 0);
    if (!root.contains(range.endContainer)) range.setEnd(content, content.childNodes.length);
  }
  // Endpoints between blocks (margins, list bullets) snap into the nearest text region.
  if (!closestEditRegion(range.startContainer) || !closestEditRegion(range.endContainer)) {
    const spanned = [...root.querySelectorAll('[data-edit-region]')].filter((item) => range.intersectsNode(item));
    if (!spanned.length) return null;
    range = range.cloneRange();
    if (!closestEditRegion(range.startContainer)) range.setStart(spanned[0], 0);
    if (!closestEditRegion(range.endContainer)) { const last = spanned.at(-1); range.setEnd(last, last.childNodes.length); }
  }
  const text = range.toString();
  if (!text.trim() || text.length > 20000) return null;

  const region = closestEditRegion(range.startContainer);
  const endRegion = closestEditRegion(range.endContainer);

  // Single-region selection: precise prefix/suffix anchoring within the chunk.
  if (region && endRegion === region && region.contains(range.endContainer)) {
    const before = document.createRange(); before.selectNodeContents(region); before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange(); after.selectNodeContents(region); after.setStart(range.endContainer, range.endOffset);
    const regionStart = Number(region.dataset.editRegion) || 0;
    const chunk = chunks.find((item) => item.start === regionStart);
    try {
      return { anchor: createTextAnchor(source, { text, sourceOffset: regionStart + before.toString().length,
        regionStart, regionEnd: chunk?.end ?? source.length, prefix: before.toString().slice(-48), suffix: after.toString().slice(0, 48) }), rect: range.getBoundingClientRect() };
    } catch { return null; }
  }

  // Cross-region selection: find the first region, compute offset from its start,
  // and search across a wide enough window to cover all spanned regions.
  const startRegion = region || closestEditRegion(range.commonAncestorContainer);
  if (!startRegion) return null;
  const regionStart = Number(startRegion.dataset.editRegion) || 0;
  // Measure how far into the start region the selection begins.
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(startRegion);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const sourceOffset = regionStart + beforeStart.toString().length;
  // Find the last spanned region to set the search window end.
  const lastRegion = endRegion || startRegion;
  const lastRegionStart = Number(lastRegion.dataset.editRegion) || regionStart;
  const lastChunk = chunks.find((item) => item.start === lastRegionStart);
  const regionEnd = lastChunk?.end ?? Math.min(source.length, lastRegionStart + 80000);
  // Prefix from just before the selection start; suffix just after the end.
  const prefixStr = beforeStart.toString().slice(-48);
  const afterEnd = document.createRange();
  afterEnd.selectNodeContents(lastRegion);
  afterEnd.setStart(range.endContainer, range.endOffset);
  const suffixStr = afterEnd.toString().slice(0, 48);
  try {
    return { anchor: createTextAnchor(source, { text, sourceOffset, regionStart, regionEnd, prefix: prefixStr, suffix: suffixStr }), rect: range.getBoundingClientRect() };
  } catch { return null; }
}

export function findRenderedAnchor(root, anchor, chunks = []) {
  if (!root || anchor.orphaned) return null;
  const regions = root.matches('[data-edit-region]') ? [root] : [...root.querySelectorAll('[data-edit-region]')];
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index];
    const start = Number(region.dataset.editRegion) || 0;
    const chunk = chunks.find((item) => item.start === start);
    if (chunk && (anchor.sourceOffset < start || anchor.sourceOffset >= chunk.end)) continue;
    // A mark may run past this region (across paragraphs or chunks): search the
    // following regions too, as one continuous text, like the selection did.
    const nodes = []; let text = '';
    for (let next = index; next < regions.length && (next === index || text.length < anchor.sourceOffset - start + anchor.text.length + 4000); next++) {
      const part = textNodes(regions[next]);
      for (const item of part.nodes) nodes.push({ node: item.node, start: text.length + item.start });
      text += part.text;
    }
    const at = closestMatch(text, anchor.text, anchor.sourceOffset - start, anchor.displayPrefix, anchor.displaySuffix);
    if (at < 0) continue;
    const begin = [...nodes].reverse().find((item) => item.start <= at);
    const end = [...nodes].reverse().find((item) => item.start < at + anchor.text.length);
    if (!begin || !end) continue;
    const range = document.createRange(); range.setStart(begin.node, at - begin.start); range.setEnd(end.node, at + anchor.text.length - end.start);
    return range;
  }
  return null;
}

export const MARK_HIGHLIGHTS = ['fix', 'expand', 'delete', 'ask', 'highlight', 'underline', 'note'];

export function clearReadingHighlights() {
  if (!globalThis.CSS?.highlights) return;
  for (const type of MARK_HIGHLIGHTS) CSS.highlights.delete(`rl-${type}`);
  CSS.highlights.delete('rl-active');
}

// Paints every mark with the CSS Custom Highlight API and returns the painted
// ranges so the reader can hit-test clicks: any visible mark can be acted on.
export function paintReadingHighlights(root, items, source, chunks = [], activeId = null) {
  const painted = [];
  const groups = Object.fromEntries(MARK_HIGHLIGHTS.map((type) => [type, []]));
  const active = [];
  for (const item of items) {
    if (item.type === 'bookmark' || !groups[item.type]) continue;
    const anchor = resolveTextAnchor(source, item.anchor), range = findRenderedAnchor(root, anchor, chunks);
    if (!range) continue;
    groups[item.type].push(range);
    if (item.id === activeId) active.push(range);
    painted.push({ item, range });
  }
  if (globalThis.CSS?.highlights && globalThis.Highlight) {
    for (const type of MARK_HIGHLIGHTS) CSS.highlights.set(`rl-${type}`, new Highlight(...groups[type]));
    CSS.highlights.set('rl-active', new Highlight(...active));
  }
  return painted;
}

export function hitTestMarks(painted, x, y) {
  let node = null, offset = 0;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) { node = position.offsetNode; offset = position.offset; }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  }
  const hits = painted.filter(({ range }) => {
    try {
      if (node && range.isPointInRange(node, offset)) {
        // The caret can sit at the boundary of a range; confirm the pointer is over its boxes.
        return [...range.getClientRects()].some((box) => x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1);
      }
    } catch { /* detached range */ }
    return false;
  });
  // Prefer the shortest (most specific) mark when marks overlap.
  return hits.sort((a, b) => a.range.toString().length - b.range.toString().length)[0] || null;
}
