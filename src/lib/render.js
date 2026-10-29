import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import { marked } from '../markdown-parser';
import { createTextAnchor } from '../reading-annotations';
import { findMathMatches } from '../math-matches';
import { DEFAULT_SEARCH_OPTIONS, textMatches } from '../search';

for (const [name, syntax] of Object.entries({ javascript, typescript, python, json, bash, css, xml, sql })) hljs.registerLanguage(name, syntax);

export function headingSlug(text, index = 0) {
  const base = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  return `${base}-${index}`;
}

export function normalizeResourceKey(value = '') {
  const source = String(value).split('#')[0].split('?')[0];
  const decoded = (() => {
    try { return decodeURIComponent(source); } catch { return source; }
  })();
  return decoded
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

export function documentCacheKey(name, path = '') {
  const normalized = normalizeResourceKey(path);
  const filename = normalizeResourceKey(name);
  return normalized === filename || normalized.endsWith(`/${filename}`) ? normalized : `${normalized}/${filename}`;
}

export function safeMarkdown(markdown, query = '', resolveAsset, activeSearchIndex = 0, searchIndexOffset = 0, headingOffset = 0, searchOptions = DEFAULT_SEARCH_OPTIONS, searchContext = null) {
  const raw = marked.parse(markdown);
  // KaTeX draws roots, large delimiters and arrows with SVG; keep SVG and MathML.
  const sanitized = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['target', 'rel'],
  });
  const container = document.createElement('div');
  container.innerHTML = sanitized;
  container.querySelectorAll('img[src]').forEach((image) => {
    const source = image.getAttribute('src') || '';
    image.setAttribute('data-source', source);
    if (resolveAsset && source && !/^(?:[a-z]+:|\/|data:)/i.test(source)) {
      const resolved = resolveAsset(source);
      if (resolved) {
        image.setAttribute('src', resolved);
        image.setAttribute('data-source', source);
      }
    }
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
  });
  if (searchContext?.chunk) {
    const prefix = `chunk-${searchContext.chunk.start}-`;
    container.querySelectorAll('[id^="footnote-"]').forEach((node) => {
      node.dataset.footnoteLabel = node.id.replace(/^footnote-(?:ref-)?/, '');
      node.id = prefix + node.id;
    });
    container.querySelectorAll('a[href^="#footnote-"]').forEach((node) => {
      const hash = node.getAttribute('href').slice(1);
      node.dataset.footnoteLabel = hash.replace(/^footnote-(?:ref-)?/, '');
      node.setAttribute('href', `#${prefix}${hash}`);
    });
    container.querySelectorAll('[data-footnotes] li[id]').forEach((node) => {
      const label = `^${decodeURIComponent(node.dataset.footnoteLabel)}`;
      const definition = searchContext.definitions?.[label];
      if (definition && (definition.start < searchContext.chunk.start || definition.start >= searchContext.chunk.end)) node.dataset.contextCopy = 'true';
    });
  }
  container.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
    code.parentElement?.classList.add('mermaid-block');
  });
  container.querySelectorAll('pre > code').forEach((code) => {
    const name = [...code.classList].find((value) => value.startsWith('language-'))?.slice(9);
    if (!name || name === 'mermaid' || !hljs.getLanguage(name) || code.textContent.length > 20000) return;
    code.innerHTML = hljs.highlight(code.textContent, { language: name, ignoreIllegals: true }).value;
    code.classList.add('hljs');
  });
  container.querySelectorAll('p').forEach((paragraph) => {
    const displayMatch = /^\$\$([\s\S]+)\$\$$/.exec((paragraph.textContent || '').trim());
    if (!displayMatch) return;
    paragraph.classList.add('math-block');
    paragraph.innerHTML = katex.renderToString(displayMatch[1], { displayMode: true, throwOnError: false });
  });
  const mathWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const mathNodes = [];
  let mathNode;
  while ((mathNode = mathWalker.nextNode())) {
    if (!mathNode.parentElement?.closest('code, pre, .math-block, .katex')) mathNodes.push(mathNode);
  }
  mathNodes.forEach((textNode) => {
    const value = textNode.nodeValue || '';
    const matches = findMathMatches(value, { display: false });
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(value.slice(lastIndex, match.index)));
      const holder = document.createElement('span');
      holder.innerHTML = katex.renderToString(match.tex, { throwOnError: false });
      fragment.append(...Array.from(holder.childNodes));
      lastIndex = match.index + match.raw.length;
    }
    fragment.append(document.createTextNode(value.slice(lastIndex)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
  [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((node) => !node.closest('[data-footnotes]')).forEach((heading, index) => {
    heading.dataset.heading = headingSlug(heading.textContent || '', index + headingOffset);
  });
  if (query.trim()) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    let searchHitIndex = 0;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest('.katex, mark')) textNodes.push(node);
    }
    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue || '';
      const matches = textMatches(value, query, searchOptions);
      if (!matches.length) return;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      for (const { text: match, index: offset } of matches) {
        fragment.append(document.createTextNode(value.slice(lastIndex, offset)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        const globalSearchIndex = searchIndexOffset + searchHitIndex;
        mark.dataset.searchIndex = String(globalSearchIndex);
        if (globalSearchIndex === activeSearchIndex) mark.classList.add('active-search-hit');
        mark.textContent = match;
        fragment.append(mark);
        searchHitIndex += 1;
        lastIndex = offset + match.length;
      }
      fragment.append(document.createTextNode(value.slice(lastIndex)));
      textNode.parentNode?.replaceChild(fragment, textNode);
    });
  }
  if (query.trim() && searchContext?.results) {
    const start = searchContext.chunk?.start || 0;
    const end = searchContext.chunk ? searchContext.chunk.end - start : markdown.length;
    // Search anchors are resolved against the rendered chunk, so keep the
    // source slice in the same coordinate space as the chunk-local offsets.
    const source = markdown.slice(0, end);
    const hits = searchContext.results.filter((item) => item.offset >= start && item.offset < start + end);
    const remaining = new Map(hits.map((item) => [item.offset - start, item]));
    const matchedHitIndexes = new Set();
    let cursor = 0;
    for (const mark of container.querySelectorAll('mark[data-search-index]')) {
      const block = mark.closest('p, li, pre, td, th, h1, h2, h3, h4, h5, h6') || mark.parentElement;
      const before = document.createRange(), after = document.createRange();
      before.selectNodeContents(block); before.setEndBefore(mark);
      after.selectNodeContents(block); after.setStartAfter(mark);
      let hit;
      try {
        const anchor = createTextAnchor(source, { text: mark.textContent, sourceOffset: cursor, regionStart: cursor, regionEnd: end,
          prefix: before.toString().slice(-48), suffix: after.toString().slice(0, 48) });
        hit = remaining.get(anchor.sourceOffset);
        if (hit) cursor = anchor.sourceEnd;
      } catch { /* A formula or copied footnote can have no source match here. */ }
      // Rendered Markdown can normalize whitespace, task markers and inline
      // formatting, making an exact source anchor unavailable. Preserve the
      // stable search order for ordinary visible text before falling back to
      // a source-only marker for syntax that is not visible in the reader.
      if (!hit) {
        const candidate = hits.find((item) => !matchedHitIndexes.has(item.index) && item.text === mark.textContent);
        if (candidate) {
          hit = candidate;
          remaining.delete(candidate.offset - start);
        }
      }
      if (hit) { mark.dataset.searchIndex = String(hit.index); remaining.delete(hit.offset - start); }
      else mark.replaceWith(...mark.childNodes);
      if (hit) matchedHitIndexes.add(hit.index);
    }
    const blocks = [...container.querySelectorAll('p, pre, li, h1, h2, h3, h4, h5, h6')];
    let blockCursor = 0;
    const locations = blocks.map((node) => {
      let offset = blockCursor;
      try {
        const anchor = createTextAnchor(source, { text: node.textContent.trim().slice(0, 80), sourceOffset: blockCursor, regionEnd: end });
        offset = anchor.sourceOffset; blockCursor = anchor.sourceEnd;
      } catch { /* Keep the preceding readable block as a fallback location. */ }
      return { node, offset };
    });
    for (const [offset, hit] of remaining) {
      const location = locations.findLast((item) => item.offset <= offset) || locations[0];
      const marker = document.createElement('span');
      marker.className = 'search-hit source-search-hit'; marker.dataset.searchIndex = String(hit.index);
      marker.dataset.readerUi = 'true'; marker.dataset.sourceOnly = 'true';
      (location?.node || container).append(marker);
    }
  }
  return container.innerHTML;
}

export function safeDocumentHtml(html, query = '', options = {}) {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  if (!query.trim()) return sanitized;
  const container = document.createElement('div');
  container.innerHTML = sanitized;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest('code, pre, .katex, script, style')) nodes.push(node);
  }
  let index = 0;
  nodes.forEach((textNode) => {
    const value = textNode.nodeValue || '';
    const matches = textMatches(value, query, options);
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const { text: match, index: offset } of matches) {
      fragment.appendChild(document.createTextNode(value.slice(last, offset)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.dataset.searchIndex = String(index++);
      mark.textContent = match;
      fragment.appendChild(mark);
      last = offset + match.length;
    }
    fragment.appendChild(document.createTextNode(value.slice(last)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
  return container.innerHTML;
}

export function plainTextSearchResults(markdown, query) {
  if (!query.trim()) return [];
  const needle = query.toLocaleLowerCase();
  const lines = markdown.split(/\r?\n/);
  const results = [];
  lines.forEach((line, lineIndex) => {
    let from = 0;
    const lowered = line.toLocaleLowerCase();
    while (from < lowered.length) {
      const match = lowered.indexOf(needle, from);
      if (match < 0) break;
      const start = Math.max(0, match - 52);
      const end = Math.min(line.length, match + needle.length + 64);
      const trimmed = line.trim();
      const location = /^#{1,6}\s/.test(trimmed) ? '标题' : /^\s*```/.test(trimmed) ? '代码' : '正文';
      results.push({ index: results.length, line: lineIndex, location, snippet: line.slice(start, end).trim() || query });
      from = match + Math.max(needle.length, 1);
    }
  });
  return results;
}

export function buildSearchResults(html, query, source) {
  if (!query.trim()) return [];
  const container = document.createElement('div');
  container.innerHTML = html;
  let sourceCursor = 0;
  return [...container.querySelectorAll('[data-search-index]')].map((mark) => {
    const index = Number(mark.dataset.searchIndex) || 0;
    const block = mark.closest('h1, h2, h3, p, li, blockquote, pre, td, th') || mark.parentElement;
    const before = document.createRange(), after = document.createRange();
    before.selectNodeContents(block); before.setEndBefore(mark);
    after.selectNodeContents(block); after.setStartAfter(mark);
    const prefix = before.toString(), suffix = after.toString();
    const fullText = `${prefix}${mark.textContent}${suffix}`;
    const matchPosition = prefix.length;
    const start = matchPosition > 48 ? matchPosition - 48 : 0;
    const end = Math.min(fullText.length, start + 116);
    let snippet = fullText.slice(start, end);
    if (start > 0) snippet = `…${snippet}`;
    if (end < fullText.length) snippet = `${snippet}…`;
    const tagName = block?.tagName?.toLowerCase();
    const location = tagName?.match(/^h[1-3]$/) ? '标题' : tagName === 'pre' ? '代码' : '正文';
    let offset;
    try {
      const anchor = createTextAnchor(source, { text: mark.textContent, sourceOffset: sourceCursor,
        regionEnd: source.length, prefix: prefix.slice(-48), suffix: suffix.slice(0, 48) });
      offset = anchor.sourceOffset; sourceCursor = anchor.sourceEnd;
    } catch { /* Source-only syntax may have no matching visible passage. */ }
    return { index, offset, text: mark.textContent, length: mark.textContent.length,
      snippet: snippet || mark.textContent || query, location };
  });
}

export function makeOutline(markdown) {
  let headingIndex = 0;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      const text = match[2].replace(/[*_`]/g, '');
      const slug = headingSlug(text, headingIndex);
      headingIndex += 1;
      return { level: match[1].length, text, slug };
    })
    .filter(Boolean);
}
