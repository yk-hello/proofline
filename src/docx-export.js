// Export the current Markdown as a Word document (.docx). Headings, paragraphs, emphasis,
// lists, quotes, tables, code, links and images map to Word; charts and Mermaid diagrams
// become sharp PNG pictures with the data table below them; formulas keep their LaTeX
// source in a math font.
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, LineRuleType, Packer,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { markdownTokens } from './markdown-parser';
import { DIRECTIVE, chartSvg, parseChartSpec, tableData } from './charts';

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

export async function markdownToDocx({ source, title = '', language = 'zh', loadImage, renderMermaid }) {
  const zh = language !== 'en';
  const tokens = markdownTokens(source);
  const blocks = [];
  let listInstance = 0;
  const warnings = [];

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
          else runs.push(new TextRun({ text: decode(token.text), ...style }));
          break;
        case 'strong': runs.push(...await inline(token.tokens, { ...style, bold: true })); break;
        case 'em': runs.push(...await inline(token.tokens, { ...style, italics: true })); break;
        case 'del': runs.push(...await inline(token.tokens, { ...style, strike: true })); break;
        case 'codespan': runs.push(new TextRun({ text: decode(token.text), ...style, font: CODE_FONT, shading: { type: ShadingType.CLEAR, fill: 'F2F2F0', color: 'auto' } })); break;
        case 'br': runs.push(new TextRun({ text: '', break: 1 })); break;
        case 'link': runs.push(new ExternalHyperlink({ link: token.href, children: (await inline(token.tokens, { ...style, color: '1F5FBF', underline: {} })) })); break;
        case 'image': runs.push(await image(token.href, token.text)); break;
        case 'inlineMath': runs.push(new TextRun({ text: token.text, ...style, font: 'Cambria Math', italics: true })); break;
        case 'html': { const text = token.text.replace(/<[^>]+>/g, ''); if (text.trim()) runs.push(new TextRun({ text: decode(text), ...style })); break; }
        default: if (token.text) runs.push(new TextRun({ text: decode(token.raw ?? token.text), ...style }));
      }
    }
    return runs;
  }

  const quoteBorder = { left: { style: BorderStyle.SINGLE, size: 12, color: 'C8C6BF', space: 8 } };

  async function picture(png, caption) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: 'png', data: png.data, transformation: fit(png.width, png.height), altText: { title: caption || 'chart', description: caption || 'chart', name: caption || 'chart' } })] }));
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
    let pendingChart = null;
    for (const token of list) {
      const extra = quote ? { border: quoteBorder, indent: { left: 360 } } : {};
      switch (token.type) {
        case 'space': break;
        case 'heading': blocks.push(new Paragraph({ heading: HEADINGS[token.depth - 1], children: await inline(token.tokens) })); break;
        case 'paragraph': {
          const only = token.tokens?.length === 1 && token.tokens[0].type === 'image';
          blocks.push(new Paragraph({ ...extra, alignment: only ? AlignmentType.CENTER : undefined, ...(only ? { spacing: { line: 240, lineRule: LineRuleType.AUTO } } : {}), children: await inline(token.tokens) }));
          break;
        }
        case 'text': blocks.push(new Paragraph({ ...extra, children: await inline(token.tokens || [token]) })); break;
        case 'blockMath': blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: token.text, font: 'Cambria Math', italics: true })] })); break;
        case 'code': {
          if (/^mermaid$/i.test(token.lang || '') && renderMermaid) {
            try { const svg = await renderMermaid(token.text); const box = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(svg); await picture(await svgToPng(svg, box ? Number(box[1]) : undefined, box ? Number(box[2]) : undefined)); break; }
            catch { /* fall back to the source */ }
          }
          for (const line of token.text.split('\n')) blocks.push(new Paragraph({ spacing: { before: 0, after: 0 }, shading: { type: ShadingType.CLEAR, fill: 'F6F6F4', color: 'auto' },
            children: [new TextRun({ text: line || ' ', font: CODE_FONT, size: 19 })] }));
          blocks.push(new Paragraph({ children: [] }));
          break;
        }
        case 'blockquote': await render(token.tokens, { quote: true, level }); break;
        case 'list': {
          const instance = ++listInstance;
          for (const item of token.items) {
            const [first, ...rest] = item.tokens;
            const prefix = item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : [];
            const children = first ? [...prefix, ...await inline(first.tokens || [first])] : prefix;
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
            try { await picture(await svgToPng(svg, 680, 360), pendingChart.title); } catch { warnings.push('chart'); }
            pendingChart = null;
            await table(token, true);
          } else await table(token);
          break;
        }
        case 'html': {
          const directive = DIRECTIVE.exec(token.text);
          if (directive) { pendingChart = parseChartSpec(directive[1]); break; }
          const text = decode(token.text.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')).trim();
          if (text) blocks.push(new Paragraph({ ...extra, children: [new TextRun({ text })] }));
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

  await render(tokens);
  const document = new Document({
    creator: 'Proofline', title, description: title,
    styles: { default: { document: { run: { font: BODY_FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 300, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [{ id: 'Hyperlink', name: 'Hyperlink', run: { color: '1F5FBF', underline: {} } }] },
    numbering: { config: [{ reference: 'pl-ordered', levels: Array.from({ length: 6 }, (_, level) => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3], text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) }] },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1300, right: 1300 } } }, children: blocks }],
  });
  return { blob: await Packer.toBlob(document), warnings };
}
