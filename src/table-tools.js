// Reading-view table tools: sort by a column (view only), totals and averages for
// numeric columns, and "insert as a total row" which writes a real Markdown row.
// Nothing here adds text nodes to the document: labels and figures are drawn from
// data attributes with CSS, so marks and search see only the author's table.
import { parseNumber } from './charts';

const isNumericColumn = (values) => {
  const filled = values.filter((value) => value.trim() !== '' && !/^[-—–]$/.test(value.trim()));
  return filled.length >= 2 && filled.every((value) => parseNumber(value) !== null);
};
const decimals = (values) => Math.max(0, ...values.map((value) => (/\.(\d+)/.exec(String(value).replace(/[,，]/g, '')) || [, ''])[1].length));
const format = (value, places) => Number(value.toFixed(Math.min(places, 4))).toLocaleString(undefined, { maximumFractionDigits: Math.min(places, 4) });

export function columnStats(rows) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: width }, (_, index) => {
    const values = rows.map((row) => row[index] ?? '');
    if (index === 0 || !isNumericColumn(values)) return null;
    const numbers = values.map(parseNumber).filter((value) => value !== null), places = decimals(values);
    const percent = values.some((value) => /%/.test(value));
    const sum = numbers.reduce((total, value) => total + value, 0);
    return { sum: percent ? null : sum, average: sum / numbers.length, places, percent, count: numbers.length };
  });
}

const bodyRows = (table) => [...(table.tBodies[0]?.rows || [])].filter((row) => !row.classList.contains('pl-total-row'));
const cellText = (row) => [...row.cells].map((cell) => cell.textContent.trim());

export function enhanceTables(root, labels) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.closest('.markdown-editor, .review-word-diff')) return;
    const rows = bodyRows(table);
    if (!table.tHead || rows.length < 2) return;
    const signature = JSON.stringify(rows.map(cellText));
    if (table.dataset.plTable === signature) return;
    table.dataset.plTable = signature;
    rows.forEach((row, index) => { if (row.dataset.plOrder === undefined) row.dataset.plOrder = String(index); });
    [...table.tHead.rows[0].cells].forEach((cell, index) => { cell.dataset.plSort = cell.dataset.plSort || 'none'; cell.dataset.plColumn = String(index); cell.title = labels.sortHint; });
    table.querySelector('tfoot.pl-table-stats')?.remove();
    // A total row the author already wrote is not counted again.
    const data = rows.map(cellText), last = data.at(-1)?.[0] || '';
    const stats = columnStats(/^(合计|总计|小计|total|sum|totals)$/i.test(last) ? data.slice(0, -1) : data);
    if (/^(合计|总计|小计|total|sum|totals)$/i.test(last)) table.dataset.hasTotal = 'true';
    if (!stats.some(Boolean)) return;
    const foot = document.createElement('tfoot');
    foot.className = 'pl-table-stats'; foot.dataset.readerUi = 'true'; foot.contentEditable = 'false';
    for (const kind of ['sum', 'average']) {
      if (kind === 'sum' && !stats.some((item) => item && item.sum !== null)) continue;
      const row = document.createElement('tr'); row.className = `pl-total-row pl-${kind}`;
      stats.forEach((item, index) => {
        const cell = document.createElement('td');
        if (index === 0) cell.dataset.value = kind === 'sum' ? labels.sum : labels.average;
        else if (item) cell.dataset.value = kind === 'sum' ? (item.sum === null ? '' : format(item.sum, item.places)) : format(item.average, item.places + 1) + (item.percent ? '%' : '');
        const align = table.tHead.rows[0].cells[index]?.getAttribute('align'); if (align) cell.setAttribute('align', align);
        row.append(cell);
      });
      if (kind === 'sum') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'pl-insert-total'; button.dataset.label = labels.insert; button.setAttribute('aria-label', labels.insert); button.title = labels.insertHint;
        row.cells[0].append(button);
      }
      foot.append(row);
    }
    table.append(foot);
  });
}

/** Sort a rendered table by one column: ascending, descending, then back to the original order. */
export function sortTable(table, column) {
  const head = table.tHead?.rows[0]; if (!head) return;
  const cell = head.cells[column], state = cell.dataset.plSort === 'asc' ? 'desc' : cell.dataset.plSort === 'desc' ? 'none' : 'asc';
  [...head.cells].forEach((other) => { other.dataset.plSort = 'none'; });
  cell.dataset.plSort = state;
  const body = table.tBodies[0], rows = bodyRows(table);
  const key = (row) => { const text = row.cells[column]?.textContent.trim() || ''; const number = parseNumber(text); return number === null ? text : number; };
  rows.sort((a, b) => {
    if (state === 'none') return Number(a.dataset.plOrder) - Number(b.dataset.plOrder);
    const x = key(a), y = key(b), order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh');
    return state === 'asc' ? order : -order;
  });
  rows.forEach((row) => body.append(row));
  if (state === 'none') delete table.dataset.sorted; else table.dataset.sorted = 'true';
}

/** The Markdown row to append for "insert as a total row". */
export function totalRowMarkdown(table, label) {
  const rows = bodyRows(table).sort((a, b) => Number(a.dataset.plOrder) - Number(b.dataset.plOrder)).map(cellText);
  const stats = columnStats(/^(合计|总计|小计|total|sum|totals)$/i.test(rows.at(-1)?.[0] || '') ? rows.slice(0, -1) : rows);
  const cells = stats.map((item, index) => (index === 0 ? label : item && item.sum !== null ? String(Number(item.sum.toFixed(Math.min(item.places, 4)))) : ''));
  return `| ${cells.join(' | ')} |`;
}

/** Find the Markdown table lines that contain [start, end) and append a row after them. */
export function appendTableRow(source, start, end, row) {
  let from = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1, to = source.indexOf('\n', end); if (to < 0) to = source.length;
  // Extend to the whole table: consecutive lines that start with a pipe.
  while (from > 0) { const prev = source.lastIndexOf('\n', from - 2) + 1; if (!/^\s{0,3}\|/.test(source.slice(prev, from - 1))) break; from = prev; }
  while (to < source.length) { const nextEnd = source.indexOf('\n', to + 1); const line = source.slice(to + 1, nextEnd < 0 ? source.length : nextEnd); if (!/^\s{0,3}\|/.test(line)) break; to = nextEnd < 0 ? source.length : nextEnd; }
  if (!/^\s{0,3}\|/.test(source.slice(from, source.indexOf('\n', from) < 0 ? source.length : source.indexOf('\n', from)))) return null;
  return source.slice(0, to) + '\n' + row + source.slice(to);
}

export function statsTableMarkdown(language = 'zh') {
  const zh = language !== 'en';
  const rows = zh
    ? [['项目', '一月', '二月', '三月', '合计'], ['收入', '120', '135', '150', '405'], ['成本', '80', '86', '90', '256'], ['利润', '40', '49', '60', '149']]
    : [['Item', 'Jan', 'Feb', 'Mar', 'Total'], ['Revenue', '120', '135', '150', '405'], ['Cost', '80', '86', '90', '256'], ['Profit', '40', '49', '60', '149']];
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(rows[0]), `| ${rows[0].map((_, index) => (index ? '---:' : '---')).join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** Counts for the document statistics panel. */
export function documentStats(source, marks = [], wordCount = 0) {
  const text = String(source || '');
  const withoutCode = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  const cjk = (withoutCode.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latinWords = (withoutCode.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9][\w'’-]*/g) || []).length;
  const fences = [...text.matchAll(/^(`{3,}|~{3,})\s*([\w-]*)[^\n]*\n[\s\S]*?^\1\s*$/gm)];
  const tables = (text.match(/^\s{0,3}\|?[\s:]*-{2,}[\s:|-]*$/gm) || []).length;
  const status = {}, types = {};
  for (const mark of marks) { types[mark.type] = (types[mark.type] || 0) + 1; if (['fix', 'expand', 'delete', 'ask', 'free'].includes(mark.type)) status[mark.status || 'open'] = (status[mark.status || 'open'] || 0) + 1; }
  return {
    words: wordCount || cjk + latinWords, characters: text.replace(/\s/g, '').length, cjk, latinWords,
    minutes: Math.max(1, Math.round(cjk / 400 + latinWords / 220)),
    headings: (withoutCode.match(/^\s{0,3}#{1,6}\s+\S/gm) || []).length,
    paragraphs: withoutCode.split(/\n\s*\n/).filter((block) => block.trim() && !/^\s{0,3}(?:#|\||>|[-*+]\s|\d+[.)]\s|<!--)/.test(block.trim())).length,
    tables, charts: (text.match(/<!--\s*proofline:chart\b/gi) || []).length + fences.filter((match) => match[2] === 'mermaid').length,
    images: (withoutCode.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length, links: (withoutCode.match(/(?<!!)\[[^\]]+\]\([^)]*\)/g) || []).length,
    codeBlocks: fences.filter((match) => match[2] !== 'mermaid').length, formulas: (withoutCode.match(/\$\$[\s\S]+?\$\$|(?<![\\$])\$[^$\n]+\$/g) || []).length,
    marks: types, statuses: status,
  };
}
