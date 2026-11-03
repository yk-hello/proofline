// Search inside the rich editor (Milkdown). The editor owns its DOM, so matches are
// painted with the CSS Custom Highlight API instead of wrapping text in <mark> nodes,
// which would corrupt the editor state. Offsets are per visible block, so a match is
// found in what the user sees, not in Markdown syntax such as ** or >.
import { textMatches } from './search';

const BLOCK = 'p, h1, h2, h3, h4, h5, h6, li, th, td, blockquote, .cm-line, figcaption';
const SKIP = '.milkdown-top-bar, .cm-gutters, .cm-panels, button, [contenteditable="false"]';
// Code blocks are CodeMirror views inside a non-editable wrapper; their text lives in .cm-content.
const skipped = (element) => !element || (element.closest('.cm-content') ? false : Boolean(element.closest(SKIP)));
const KIND = (node) => {
  if (node.closest('h1, h2, h3, h4, h5, h6')) return { zh: '标题', en: 'Heading' };
  if (node.closest('th, td')) return { zh: '表格', en: 'Table' };
  if (node.closest('.cm-line')) return { zh: '代码', en: 'Code' };
  if (node.closest('li')) return { zh: '列表', en: 'List' };
  if (node.closest('blockquote')) return { zh: '引用', en: 'Quote' };
  return { zh: '正文', en: 'Text' };
};

function blocksOf(root) {
  const groups = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (!node.nodeValue || skipped(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let node;
  while ((node = walker.nextNode())) {
    const block = node.parentElement.closest(BLOCK) || root;
    let group = groups.get(block);
    if (!group) { group = { block, text: '', nodes: [] }; groups.set(block, group); }
    group.nodes.push({ node, start: group.text.length });
    group.text += node.nodeValue;
  }
  return [...groups.values()];
}

function rangeFor(group, start, end) {
  const range = document.createRange();
  let startSet = false;
  for (const item of group.nodes) {
    const length = item.node.nodeValue.length;
    if (!startSet && start <= item.start + length) { range.setStart(item.node, Math.max(0, start - item.start)); startSet = true; }
    if (startSet && end <= item.start + length) { range.setEnd(item.node, Math.max(0, end - item.start)); return range; }
  }
  return startSet ? range : null;
}

export function findEditorMatches(root, query, options, language = 'zh', limit = 5000) {
  if (!root || !query) return [];
  const results = [];
  for (const group of blocksOf(root)) {
    for (const match of textMatches(group.text, query, options)) {
      const range = rangeFor(group, match.index, match.index + match.length);
      if (!range) continue;
      const before = group.text.slice(Math.max(0, match.index - 28), match.index);
      const after = group.text.slice(match.index + match.length, match.index + match.length + 40);
      const kind = KIND(group.nodes[0].node.parentElement);
      results.push({ index: results.length, range, location: language === 'zh' ? kind.zh : kind.en,
        snippet: `${match.index > 28 ? '…' : ''}${before}${match.text}${after}`.replace(/\s+/g, ' ') });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

const supported = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

export function paintEditorMatches(matches, activeIndex) {
  if (!supported()) return;
  CSS.highlights.delete('pl-search');
  CSS.highlights.delete('pl-search-active');
  if (!matches.length) return;
  CSS.highlights.set('pl-search', new Highlight(...matches.map((item) => item.range)));
  const active = matches[activeIndex];
  if (active) CSS.highlights.set('pl-search-active', new Highlight(active.range));
}

export function clearEditorMatches() {
  if (!supported()) return;
  CSS.highlights.delete('pl-search');
  CSS.highlights.delete('pl-search-active');
}

/** Scroll the scroll container so the match sits in the middle of the view. */
export function revealRange(range, container) {
  if (!range || !container) return;
  const box = range.getBoundingClientRect(), frame = container.getBoundingClientRect();
  if (!box.height && !box.width) { range.startContainer.parentElement?.scrollIntoView({ block: 'center' }); return; }
  const target = container.scrollTop + (box.top - frame.top) - frame.height / 2 + box.height / 2;
  container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
}
