import TurndownService from 'turndown';

export const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript']);
turndown.addRule('readerMath', {
  filter: (node) => node.classList?.contains('katex') || node.classList?.contains('katex-display') || node.classList?.contains('math-block'),
  replacement: (_content, node) => {
    const formula = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (!formula) return node.textContent || '';
    const display = node.classList.contains('katex-display') || node.classList.contains('math-block');
    return display ? `\n\n$$\n${formula}\n$$\n\n` : `$${formula}$`;
  },
});
turndown.addRule('readerImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const source = node.getAttribute('data-source') || node.getAttribute('src') || '';
    const title = node.getAttribute('title');
    return `![${node.getAttribute('alt') || ''}](${source}${title ? ` "${title.replaceAll('"', '\\"')}"` : ''})`;
  },
});
turndown.addRule('readerTable', {
  filter: 'table',
  replacement: (_content, node) => {
    const rows = [...node.querySelectorAll('tr')].map((row) => [...row.children]);
    if (!rows.length) return '';
    const cell = (node) => turndown.turndown(node.innerHTML).trim().replaceAll('|', '\\|').replace(/\n+/g, '<br>');
    const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
    const divider = rows[0].map((node) => {
      const align = node.getAttribute('align') || node.style.textAlign;
      return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---';
    });
    return `\n\n${[line(rows[0]), `| ${divider.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')}\n\n`;
  },
});
turndown.addRule('readerDefinitions', {
  filter: 'dl',
  replacement: (_content, node) => {
    let term = '';
    const entries = [];
    for (const child of node.children) {
      if (child.tagName === 'DT') term = turndown.turndown(child.innerHTML).trim();
      else if (child.tagName === 'DD') entries.push(`${term} :: ${turndown.turndown(child.innerHTML).trim()}`);
    }
    return `\n\n${entries.join('\n')}\n\n`;
  },
});
turndown.addRule('readerFootnoteReference', {
  filter: (node) => node.tagName === 'A' && node.hasAttribute('data-footnote-ref'),
  replacement: (_content, node) => `[^${decodeURIComponent(node.dataset.footnoteLabel || node.getAttribute('href').replace('#footnote-', ''))}]`,
});
turndown.addRule('readerFootnoteSection', {
  filter: (node) => node.tagName === 'SECTION' && node.hasAttribute('data-footnotes'),
  replacement: (_content, node) => `\n\n${[...node.querySelectorAll(':scope > ol > li')].map((item) => {
    const body = item.cloneNode(true);
    body.querySelectorAll('[data-footnote-backref]').forEach((link) => link.remove());
    const label = decodeURIComponent(item.dataset.footnoteLabel || item.id.replace('footnote-', ''));
    return `[^${label}]: ${turndown.turndown(body.innerHTML).trim().replace(/\n/g, '\n    ')}`;
  }).join('\n\n')}\n\n`,
});
turndown.addRule('readerTask', {
  filter: (node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox',
  replacement: (_content, node) => `[${node.checked ? 'x' : ' '}] `,
});

export function htmlDocumentToMarkdown(html) {
  try {
    return turndown.turndown(html).trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function htmlToMarkdown(html) {
  const container = document.createElement('div'); container.innerHTML = html;
  container.querySelectorAll('[data-reader-ui], [data-context-copy]').forEach((node) => node.remove());
  return turndown.turndown(container.innerHTML).trim();
}
