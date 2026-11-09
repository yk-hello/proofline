// Export the current Markdown as a Word document (.docx). Headings, paragraphs, emphasis,
// lists, quotes, tables, code, links and images map to Word; charts and Mermaid diagrams
// become sharp PNG pictures with the data table below them; formulas keep their LaTeX
// source in a math font.
import {
  AlignmentType, BorderStyle, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, ExternalHyperlink, HeadingLevel, ImageRun,
  InsertedTextRun, LevelFormat, LineRuleType, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { diffArrays } from 'diff';
import { markdownTokens } from './markdown-parser';
import { DIRECTIVE, chartSvg, parseChartSpec, tableData } from './charts';
import { diffBlocks } from '../electron/review-core.mjs';

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const words = (text) => (segmenter ? [...segmenter.segment(text)].map((item) => item.segment) : text.split(/(\s+)/));

const MAX_WIDTH = 600; // px at 96 dpi, about 16 cm of text width
const CODE_FONT = 'Consolas';
const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei', cs: 'Calibri' };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const decode = (text = '') => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);

/** Rasterise SVG markup to PNG bytes (2x for print). */
export async function svgToPng(svg, width, height) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('svg')); image.src = url; });
    const w = width || image.naturalWidth || 800, h = height || image.naturalHeight || 450, scale = 2;
    const canvas = document.createElement('canvas'); canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { data: new Uint8Array(await png.arrayBuffer()), width: w, height: h, type: 'png' };
  } finally { URL.revokeObjectURL(url); }
}

async function rasterToPng(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { data: new Uint8Array(await png.arrayBuffer()), width: bitmap.width, height: bitmap.height, type: 'png' };
}

function kind(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trim();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return 'other';
}

const fit = (width, height, max = MAX_WIDTH) => (width > max ? { width: max, height: Math.round(height * max / width) } : { width, height });

/**
 * With `base`, the document is written with Word tracked changes from `base` to `source`:
 * a reader can accept or reject each one in Word. `comments` are Word comments attached to a
 * block of `source`: [{ block, text }].
 */
export async function markdownToDocx({ source, base = null, comments = [], author = 'Stetwise', title = '', language = 'zh', loadImage, renderMermaid }) {
  const zh = language !== 'en';
  const blocks = [];
  let listInstance = 0, lastOrdered = false, pendingChart = null;
  const warnings = [];
  // Tracked changes: while `revision` is set, every run is an insertion or a deletion.
  let revision = null, revisionId = 1;
  const date = new Date().toISOString();
  const run = (options) => {
    if (!revision) return new TextRun(options);
    const changed = { ...options, id: revisionId++, author, date };
    return revision === 'ins' ? new InsertedTextRun(changed) : new DeletedTextRun(changed);
  };
  // Comments open before the first paragraph of their block and close after it.
  const commentList = [], commentsByBlock = new Map();
  for (const item of comments) {
    const id = commentList.length + 1;
    commentList.push({ id, author, initials: 'PL', date: new Date(), children: String(item.text || '').split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })) });
    commentsByBlock.set(item.block, [...(commentsByBlock.get(item.block) || []), id]);
  }
  let pendingComments = [];
  const withComments = (children) => {
    if (!pendingComments.length) return children;
    const ids = pendingComments; pendingComments = [];
    return [...ids.map((id) => new CommentRangeStart(id)), ...children, ...ids.flatMap((id) => [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })])];
  };

  async function image(src, alt = '') {
    try {
      const bytes = await loadImage(src);
      if (!bytes) throw new Error('missing');
      const type = kind(bytes);
      let picture;
      if (type === 'svg') picture = await svgToPng(new TextDecoder().decode(bytes));
      else if (type === 'other') picture = await rasterToPng(bytes, 'image/*');
      else { const bitmap = await createImageBitmap(new Blob([bytes])); picture = { data: bytes, width: bitmap.width, height: bitmap.height, type }; }
      return new ImageRun({ type: picture.type, data: picture.data, transformation: fit(picture.width, picture.height), altText: { title: alt, description: alt, name: alt || 'image' } });
    } catch {
      warnings.push(src);
      return new TextRun({ text: `[${zh ? '图片' : 'Image'}: ${alt || src}]`, italics: true, color: '888888' });
    }
  }

  async function inline(list = [], style = {}) {
    const runs = [];
    for (const token of list) {
      switch (token.type) {
        case 'text': case 'escape':
          if (token.tokens?.length) runs.push(...await inline(token.tokens, style));
          else runs.push(run({ text: decode(token.text), ...style }));
          break;
        case 'strong': runs.push(...await inline(token.tokens, { ...style, bold: true })); break;
        case 'em': runs.push(...await inline(token.tokens, { ...style, italics: true })); break;
        case 'del': runs.push(...await inline(token.tokens, { ...style, strike: true })); break;
        case 'codespan': runs.push(run({ text: decode(token.text), ...style, font: CODE_FONT, shading: { type: ShadingType.CLEAR, fill: 'F2F2F0', color: 'auto' } })); break;
        case 'br': runs.push(new TextRun({ text: '', break: 1 })); break;
        case 'link': runs.push(new ExternalHyperlink({ link: token.href, children: (await inline(token.tokens, { ...style, color: '1F5FBF', underline: {} })) })); break;
        case 'image': runs.push(await image(token.href, token.text)); break;
        case 'inlineMath': runs.push(run({ text: token.text, ...style, font: 'Cambria Math', italics: true })); break;
        case 'html': { const text = token.text.replace(/<[^>]+>/g, ''); if (text.trim()) runs.push(run({ text: decode(text), ...style })); break; }
        default: if (token.text) runs.push(run({ text: decode(token.raw ?? token.text), ...style }));
      }
    }
    return runs;
  }

  const quoteBorder = { left: { style: BorderStyle.SINGLE, size: 12, color: 'C8C6BF', space: 8 } };

  // The picture's description carries what Stetwise needs to turn it back into a chart
  // or diagram when the .docx is opened again (see restoreStetwiseObjects).
  async function picture(png, caption, restore = '') {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: 'png', data: png.data, transformation: fit(png.width, png.height), altText: { title: caption || 'chart', description: restore || caption || 'chart', name: caption || 'chart' } })] }));
  }

  async function table(token, compact = false) {
    const header = new TableRow({ tableHeader: true, children: await Promise.all(token.header.map(async (cell, index) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'F2F2F0', color: 'auto' },
      children: [new Paragraph({ alignment: align(token.align[index]), children: await inline(cell.tokens, { bold: true, size: compact ? 18 : undefined }) })] }))) });
    const rows = await Promise.all(token.rows.map(async (row) => new TableRow({ children: await Promise.all(row.map(async (cell, index) => new TableCell({
      children: [new Paragraph({ alignment: align(token.align[index]), children: await inline(cell.tokens, { size: compact ? 18 : undefined }) })] }))) })));
    blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }));
    blocks.push(new Paragraph({ children: [] }));
  }
  const align = (value) => (value === 'right' ? AlignmentType.RIGHT : value === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT);

  async function render(list, { quote = false, level = 0 } = {}) {
    for (const token of list) {
      const extra = quote ? { border: quoteBorder, indent: { left: 360 } } : {};
      switch (token.type) {
        case 'space': break;
        case 'heading': blocks.push(new Paragraph({ heading: HEADINGS[token.depth - 1], children: withComments(await inline(token.tokens)) })); break;
        case 'paragraph': {
          const only = token.tokens?.length === 1 && token.tokens[0].type === 'image';
          blocks.push(new Paragraph({ ...extra, alignment: only ? AlignmentType.CENTER : undefined, ...(only ? { spacing: { line: 240, lineRule: LineRuleType.AUTO } } : {}), children: withComments(await inline(token.tokens)) }));
          break;
        }
        case 'text': blocks.push(new Paragraph({ ...extra, children: withComments(await inline(token.tokens || [token])) })); break;
        case 'blockMath': blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children: withComments([run({ text: token.text, font: 'Cambria Math', italics: true })]) })); break;
        case 'code': {
          if (/^mermaid$/i.test(token.lang || '') && renderMermaid) {
            try { const svg = await renderMermaid(token.text); const box = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(svg); await picture(await svgToPng(svg, box ? Number(box[1]) : undefined, box ? Number(box[2]) : undefined), 'diagram', `stetwise-mermaid:${encodeURIComponent(token.text)}`); break; }
            catch { /* fall back to the source */ }
          }
          for (const line of token.text.split('\n')) blocks.push(new Paragraph({ spacing: { before: 0, after: 0 }, shading: { type: ShadingType.CLEAR, fill: 'F6F6F4', color: 'auto' },
            children: withComments([run({ text: line || ' ', font: CODE_FONT, size: 19 })]) }));
          blocks.push(new Paragraph({ children: [] }));
          break;
        }
        case 'blockquote': await render(token.tokens, { quote: true, level }); break;
        case 'list': {
          const instance = token.ordered && lastOrdered && Number(token.start) > 1 ? listInstance : ++listInstance;
          for (const item of token.items) {
            const [first, ...rest] = item.tokens;
            const prefix = item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : [];
            const children = withComments(first ? [...prefix, ...await inline(first.tokens || [first])] : prefix);
            blocks.push(new Paragraph({ ...extra, children, ...(token.ordered ? { numbering: { reference: 'pl-ordered', level: Math.min(level, 5), instance } } : { bullet: { level: Math.min(level, 5) } }) }));
            const nested = rest.filter((part) => part.type !== 'space');
            if (nested.length) await render(nested, { quote, level: level + 1 });
          }
          break;
        }
        case 'table': {
          if (pendingChart) {
            const rows = [token.header.map((cell) => decode(cell.text)), ...token.rows.map((row) => row.map((cell) => decode(cell.text)))];
            const { svg } = chartSvg(pendingChart, tableData(rows));
            try { await picture(await svgToPng(svg, 680, 360), pendingChart.title, `stetwise-chart:${encodeURIComponent(pendingChart.raw || '')}`); } catch { warnings.push('chart'); }
            pendingChart = null;
            await table(token, true);
          } else await table(token);
          break;
        }
        case 'html': {
          const directive = DIRECTIVE.exec(token.text);
          if (directive) { pendingChart = { ...parseChartSpec(directive[1]), raw: directive[1].trim() }; break; }
          const text = decode(token.text.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')).trim();
          if (text) blocks.push(new Paragraph({ ...extra, children: withComments([run({ text })]) }));
          break;
        }
        case 'hr': blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9D7D0', space: 1 } }, children: [] })); break;
        case 'definitionListsSingleLine': case 'definitionListsMultiLine':
          for (const item of token.items || []) {
            blocks.push(new Paragraph({ children: await inline(item.dtTokens || item.dt?.tokens || [{ type: 'text', text: item.dt || '' }], { bold: true }) }));
            for (const dd of [].concat(item.dds || item.dd || [])) blocks.push(new Paragraph({ indent: { left: 480 }, children: await inline(dd.tokens || [{ type: 'text', text: dd.text || String(dd) }]) }));
          }
          break;
        case 'footnotes':
          if (!token.items?.length) break;
          blocks.push(new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D7D0', space: 6 } }, children: [new TextRun({ text: zh ? '脚注' : 'Footnotes', bold: true, size: 20 })] }));
          for (const note of token.items || []) blocks.push(new Paragraph({ children: [new TextRun({ text: `${note.label}. `, size: 20 }), ...await inline((note.tokens || []).flatMap((part) => part.tokens || [part]), { size: 20 })] }));
          break;
        default: if (token.tokens) await render(token.tokens, { quote, level }); else if (token.text) blocks.push(new Paragraph({ children: [new TextRun({ text: decode(token.text) })] }));
      }
    }
  }

  // One block at a time, so comments and changes land on the right paragraph.
  const meaningful = (tokens) => tokens.filter((token) => token.type !== 'space' && !(token.type === 'footnotes' && !token.items?.length));
  const plain = (tokens) => tokens.length === 1 && ['paragraph', 'heading'].includes(tokens[0].type) && (tokens[0].tokens || []).every((token) => token.type === 'text' && !token.tokens?.length);
  async function block(text, index) {
    const tokens = markdownTokens(text);
    if (index !== undefined) pendingComments = [...pendingComments, ...(commentsByBlock.get(index) || [])];
    await render(tokens);
    const last = meaningful(tokens).at(-1);
    lastOrdered = last?.type === 'list' && Boolean(last.ordered);
    pendingComments = [];
  }
  if (!base) {
    if (!comments.length) await render(markdownTokens(source));
    else { const { nextBlocks } = diffBlocks(source, source); for (const [index, item] of nextBlocks.entries()) await block(item.text, index); }
  } else {
    const diff = diffBlocks(base, source);
    for (const hunk of diff.hunks) {
      if (hunk.type === 'equal') { for (const index of hunk.next) await block(diff.nextBlocks[index].text, index); continue; }
      const before = hunk.base.map((index) => diff.baseBlocks[index].text).join(''), after = hunk.next.map((index) => diff.nextBlocks[index].text).join('');
      const a = markdownTokens(before), b = markdownTokens(after);
      const pa = meaningful(a), pb = meaningful(b);
      const item = (tokens) => tokens.length === 1 && tokens[0].type === 'list' && tokens[0].items.length === 1 && plain(meaningful(tokens[0].items[0].tokens || []).flatMap((part) => part.type === 'text' && part.tokens ? [{ ...part, type: 'paragraph' }] : [part])) ? tokens[0] : null;
      const textOf = (tokens) => decode(tokens[0].type === 'list' ? tokens[0].items[0].text : tokens[0].text);
      const sameParagraph = plain(pa) && plain(pb) && pa[0].type === pb[0].type && pa[0].depth === pb[0].depth;
      const sameItem = item(pa) && item(pb) && pa[0].ordered === pb[0].ordered;
      if (hunk.base.length === 1 && hunk.next.length === 1 && (sameParagraph || sameItem)) {
        // A changed paragraph or list item: word-level insertions and deletions inside it.
        pendingComments = [...(commentsByBlock.get(hunk.next[0]) || [])];
        const children = [];
        for (const part of diffArrays(words(textOf(pa)), words(textOf(pb)))) {
          revision = part.added ? 'ins' : part.removed ? 'del' : null;
          children.push(run({ text: part.value.join('') }));
        }
        revision = null;
        let layout = pb[0].type === 'heading' ? { heading: HEADINGS[pb[0].depth - 1] } : {};
        if (sameItem) {
          const instance = pb[0].ordered && lastOrdered && Number(pb[0].start) > 1 ? listInstance : pb[0].ordered ? ++listInstance : listInstance;
          layout = pb[0].ordered ? { numbering: { reference: 'pl-ordered', level: 0, instance } } : { bullet: { level: 0 } };
        }
        blocks.push(new Paragraph({ ...layout, children: withComments(children) }));
        lastOrdered = Boolean(sameItem && pb[0].ordered);
        continue;
      }
      // Anything else (lists, tables, several paragraphs): the old blocks as one deletion, the new as one insertion.
      revision = 'del'; for (const index of hunk.base) await block(diff.baseBlocks[index].text);
      revision = 'ins'; for (const index of hunk.next) await block(diff.nextBlocks[index].text, index);
      revision = null;
    }
  }
  const document = new Document({
    creator: 'Stetwise', title, description: title,
    ...(commentList.length ? { comments: { children: commentList } } : {}),
    styles: { default: { document: { run: { font: BODY_FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 300, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [{ id: 'Hyperlink', name: 'Hyperlink', run: { color: '1F5FBF', underline: {} } }] },
    numbering: { config: [{ reference: 'pl-ordered', levels: Array.from({ length: 6 }, (_, level) => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3], text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) }] },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1300, right: 1300 } } }, children: blocks }],
  });
  return { blob: await Packer.toBlob(document), warnings };
}
