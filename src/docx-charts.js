// Word charts on import. A chart in a .docx is DrawingML (word/charts/chartN.xml) that
// keeps the plotted values in caches, so the data can be read without Excel. Each chart
// is replaced by a text marker before mammoth converts the document, and the marker is
// then swapped for a Stetwise chart: a Markdown table with a <!-- stetwise:chart --> line.
import JSZip from 'jszip';
import { chartDirective } from './charts';

const MARKER = (index) => `STETWISECHART${index}END`;
const MARKER_PATTERN = /STETWISECHART(\d+)END/g;

const children = (node, name) => (node ? [...node.children].filter((child) => child.localName === name) : []);
const child = (node, name) => children(node, name)[0] || null;
const descendants = (node, name) => (node ? [...node.getElementsByTagNameNS('*', name)] : []);
const textOf = (node) => descendants(node, 't').map((item) => item.textContent).join('') || descendants(node, 'v').map((item) => item.textContent).join(' ');

function points(node) {
  // strRef/numRef (with a cache) or strLit/numLit: <c:pt idx="n"><c:v>…</c:v></c:pt>
  const cache = node && (descendants(node, 'strCache')[0] || descendants(node, 'numCache')[0] || descendants(node, 'strLit')[0] || descendants(node, 'numLit')[0] || descendants(node, 'multiLvlStrCache')[0]);
  if (!cache) return [];
  const count = Number(child(cache, 'ptCount')?.getAttribute('val')) || 0, values = [];
  for (const point of descendants(cache, 'pt')) {
    const index = Number(point.getAttribute('idx'));
    if (!(index in values)) values[index] = child(point, 'v')?.textContent ?? '';
  }
  return Array.from({ length: Math.max(count, values.length) }, (_, index) => values[index] ?? '');
}

const PLOTS = { barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie',
  doughnutChart: 'doughnut', areaChart: 'area', area3DChart: 'area', radarChart: 'radar', scatterChart: 'scatter', bubbleChart: 'scatter', stockChart: 'line', surfaceChart: 'line', surface3DChart: 'line' };

/** Read one chart part: type, title and the cached table of values. */
export function parseChartXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const plotArea = descendants(doc, 'plotArea')[0];
  if (!plotArea) return null;
  const plots = [...plotArea.children].filter((node) => PLOTS[node.localName]);
  if (!plots.length) return null;
  const plot = plots[0], kind = plot.localName;
  const spec = { type: PLOTS[kind] };
  const simplified = plots.length > 1 || /3D|ofPie|bubble|stock|surface/.test(kind);
  if (kind.startsWith('bar')) {
    if (child(plot, 'barDir')?.getAttribute('val') === 'bar') spec.horizontal = true;
    if (/stacked/i.test(child(plot, 'grouping')?.getAttribute('val') || '')) spec.stacked = true;
  }
  const chart = descendants(doc, 'chart')[0];
  const titleNode = chart && child(chart, 'title');
  if (titleNode && child(chart, 'autoTitleDeleted')?.getAttribute('val') !== '1') spec.title = textOf(titleNode).trim();
  const series = plots.flatMap((item) => children(item, 'ser')).map((ser, index) => ({
    name: textOf(child(ser, 'tx')).trim() || `系列 ${index + 1}`,
    categories: points(child(ser, 'cat') || child(ser, 'xVal')),
    values: points(child(ser, 'val') || child(ser, 'yVal')),
  })).filter((item) => item.values.length);
  if (!series.length) return null;
  const categories = series.find((item) => item.categories.length)?.categories || series[0].values.map((_, index) => String(index + 1));
  const length = Math.max(categories.length, ...series.map((item) => item.values.length));
  const single = spec.type === 'pie' || spec.type === 'doughnut';
  const used = single ? series.slice(0, 1) : series;
  const rows = [[spec.type === 'scatter' ? 'x' : '类别', ...used.map((item) => item.name)]];
  for (let index = 0; index < length; index++) rows.push([categories[index] ?? String(index + 1), ...used.map((item) => item.values[index] ?? '')]);
  return { spec, rows, simplified: simplified || (single && series.length > 1) };
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
export function chartToMarkdown({ spec, rows, simplified }, language = 'zh') {
  const lines = [chartDirective(spec), `| ${rows[0].map(cell).join(' | ')} |`, `| ${rows[0].map((_, index) => (index ? '---:' : '---')).join(' | ')} |`, ...rows.slice(1).map((row) => `| ${row.map(cell).join(' | ')} |`)];
  if (simplified) lines.push('', language === 'en' ? '*(Chart imported from Word in simplified form; the data is complete.)*' : '*（这张图表从 Word 导入时做了简化，数据完整保留。）*');
  return lines.join('\n');
}

/**
 * Replace every chart drawing in a .docx with a marker and return the edited file plus
 * the Markdown for each chart. Charts that cannot be read become a short note.
 */
export async function extractDocxCharts(arrayBuffer, language = 'zh') {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentPath = 'word/document.xml', relsPath = 'word/_rels/document.xml.rels';
  const xml = await zip.file(documentPath)?.async('string');
  if (!xml || !/chart/.test(xml)) return { buffer: arrayBuffer, charts: [] };
  const rels = new Map();
  const relsXml = await zip.file(relsPath)?.async('string') || '';
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(match[0])?.[1], target = /Target="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/word\/\.\.\//, ''));
  }
  const charts = [];
  // A chart sits in <w:drawing> (sometimes inside <mc:AlternateContent>); replace the whole wrapper.
  const pattern = /<mc:AlternateContent\b(?:(?!<\/mc:AlternateContent>)[\s\S])*?<\/mc:AlternateContent>|<w:drawing\b[\s\S]*?<\/w:drawing>/g;
  let changed = false;
  const edited = await replaceAsync(xml, pattern, async (block) => {
    const id = /<c:chart\b[^>]*r:id="([^"]+)"/.exec(block)?.[1] || /<cx:chart\b[^>]*r:id="([^"]+)"/.exec(block)?.[1];
    if (!id) return block;
    changed = true;
    const part = rels.get(id), chartXml = part ? await zip.file(part)?.async('string') : null;
    let markdown;
    try { const parsed = chartXml && parseChartXml(chartXml); markdown = parsed ? chartToMarkdown(parsed, language) : null; } catch { markdown = null; }
    charts.push(markdown || (language === 'en' ? '*(A Word chart here could not be imported.)*' : '*（这里有一张 Word 图表，类型暂不支持，未能导入。）*'));
    return `<w:t xml:space="preserve">${MARKER(charts.length - 1)}</w:t>`;
  });
  if (!changed) return { buffer: arrayBuffer, charts: [] };
  zip.file(documentPath, edited);
  return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), charts };
}

async function replaceAsync(text, pattern, replacer) {
  const parts = [], matches = [...text.matchAll(pattern)];
  let cursor = 0;
  for (const match of matches) { parts.push(text.slice(cursor, match.index), await replacer(match[0])); cursor = match.index + match[0].length; }
  parts.push(text.slice(cursor));
  return parts.join('');
}

/** Swap the markers in converted Markdown for the chart blocks, each on its own. */
export function insertCharts(markdown, charts) {
  if (!charts.length) return markdown;
  return markdown.split('\n').map((line) => {
    if (!MARKER_PATTERN.test(line)) return line;
    MARKER_PATTERN.lastIndex = 0;
    const pieces = line.split(MARKER_PATTERN), out = [];
    for (let index = 0; index < pieces.length; index++) {
      if (index % 2 === 0) { if (pieces[index].trim()) out.push(pieces[index].trim()); }
      else out.push('', charts[Number(pieces[index])] || '', '');
    }
    return out.join('\n');
  }).join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * A .docx exported by Stetwise marks its chart and diagram pictures in their
 * description. Turn them back: chart picture + the data table after it becomes the
 * chart directive + table; a diagram picture becomes its Mermaid source again.
 */
export function restoreStetwiseObjects(markdown) {
  const decode = (value) => { try { return decodeURIComponent(value.replace(/\\(.)/g, '$1')); } catch { return null; } };
  return markdown
    .replace(/!\[(?:stetwise|proofline)-chart:([^\]]*)\]\([^)\s]*\)[ \t]*\n+(?=[ \t]{0,3}\|)/g, (all, spec) => { const value = decode(spec); return value === null ? all : `<!-- stetwise:chart ${value} -->\n`; })
    .replace(/!\[(?:stetwise|proofline)-mermaid:([^\]]*)\]\([^)\s]*\)/g, (all, code) => { const value = decode(code); return value === null ? all : `\`\`\`mermaid\n${value.trim()}\n\`\`\``; });
}
