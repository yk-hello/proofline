import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { markdownTokens } from './markdown-parser';
import { analyzeDocument, sourceForChunk } from './document-model';
import { findMathMatches } from './math-matches';

const MARGIN = 44, requests = new Map();
let requestId = 0;
function diagram(source) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('Diagram rendering timed out')); }, 12000);
    requests.set(id, (data) => { clearTimeout(timer); data.svg ? resolve(data.svg) : reject(new Error(data.error)); });
    self.postMessage({ type: 'diagram', id, source });
  });
}

// Source-based layout flushes pages incrementally without a document-sized canvas.
self.onmessage = async ({ data }) => {
  if (data.type === 'diagram-result') { requests.get(data.id)?.(data); requests.delete(data.id); return; }
  try {
    self.postMessage({ type: 'progress', value: 1, phase: 'font', pages: 0 });
    const response = await fetch(data.fontUrl);
    if (!response.ok) throw new Error('Unable to load the bundled PDF font');
    const font = new Uint8Array(await response.arrayBuffer()), output = [];
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, font, fontLayoutCache: data.source.length < 1000000,
      bufferPages: false, compress: true, info: { Title: data.title, Creator: 'Proofline' } });
    doc.registerFont('Reader', font); doc.font('Reader');
    doc.on('data', (part) => output.push(new Uint8Array(part)));
    const completed = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
    let pages = 1;
    const stats = { formulas: 0, diagrams: 0, images: 0, repeatedTableHeaders: 0, fallbacks: 0, fallbackReasons: [] };
    function fallback(kind, error) {
      stats.fallbacks++;
      if (stats.fallbackReasons.length < 20) stats.fallbackReasons.push({ kind, message: error?.message || String(error) });
    }
    doc.on('pageAdded', () => { pages += 1; });
    const width = doc.page.width - MARGIN * 2, pageBottom = () => doc.page.height - MARGIN;
    const assets = new Map(data.assets || []), imageCache = new Map();
    const normalize = (value) => { try { value = decodeURIComponent(value); } catch {} return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^(?:\.\.\/)+/, '').toLowerCase(); };
    const decode = (value) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    function inline(tokens) {
      return decode((tokens || []).map((t) => t.type === 'footnoteRef' ? `[${t.id}]` : t.type === 'image' ? t.text || '' : t.type === 'br' ? '\n' : t.type === 'html' ? t.text.replace(/<[^>]+>/g, '') : t.tokens ? inline(t.tokens) : t.text || t.raw || '').join(''));
    }
    function inlineContent(tokens) {
      let value = ''; const protectedRanges = [];
      const visit = (children) => {
        for (const token of children || []) {
          if (token.tokens) { visit(token.tokens); continue; }
          const start = value.length;
          value += decode(token.type === 'footnoteRef' ? `[${token.id}]` : token.type === 'image' ? '' : token.type === 'br' ? '\n' : token.type === 'html' ? token.text.replace(/<[^>]+>/g, '') : token.text || token.raw || '');
          if (['code', 'codespan', 'image'].includes(token.type)) protectedRanges.push({ start, end: value.length });
        }
      };
      visit(tokens); return { value, protectedRanges };
    }
    function ensureSpace(height = 28) { if (doc.y + height > pageBottom()) doc.addPage(); }
    function text(value, { size = 10.5, gap = 7, indent = 0, color = '#202124' } = {}) {
      if (!value) return;
      ensureSpace(size * 2); doc.font('Reader').fontSize(size).fillColor(color);
      doc.text(value, MARGIN + indent, doc.y, { width: width - indent, lineGap: 4 });
      doc.y += gap; doc.x = MARGIN;
    }
    function drawSvg(svg, x, y, w, h) {
      const dash = doc.dash;
      // SVG permits zero-length dash gaps; PDFKit 0.20 rejects them.
      doc.dash = function (length, options) {
        return dash.call(this, Array.isArray(length) ? length.map((value) => Math.max(.001, value)) : length, options);
      };
      try { SVGtoPDF(doc, svg, x, y, { width: w, height: h, fontCallback: () => 'Reader', imageCallback: () => null, warningCallback: () => {} }); }
      finally { doc.dash = dash; }
    }
    function svgGraphic(svg, maxWidth = width, maxHeight = 450, align = 'left') {
      const viewBox = /viewBox=["']([^"']+)/i.exec(svg)?.[1].split(/\s+/).map(Number);
      const w = Number(/\bwidth=["']([\d.]+)/i.exec(svg)?.[1]) || viewBox?.[2] || 400;
      const h = Number(/\bheight=["']([\d.]+)/i.exec(svg)?.[1]) || viewBox?.[3] || 200;
      const scale = Math.min(maxWidth / w, maxHeight / h, 1), drawWidth = w * scale, drawHeight = h * scale;
      ensureSpace(drawHeight + 14); drawSvg(svg, MARGIN + (align === 'center' ? (width - drawWidth) / 2 : 0), doc.y, drawWidth, drawHeight);
      doc.y += drawHeight + 12; doc.x = MARGIN;
    }
    let formulas;
    async function mathRuns(value, size = 10.5, protectedRanges = []) {
      const matches = findMathMatches(value).filter((match) => !protectedRanges.some((range) => match.index < range.end && match.index + match.raw.length > range.start));
      if (!matches.length) return null;
      formulas ||= import('./pdf-formulas').then((module) => module.formulaSvg).catch(() => null);
      const renderFormula = await formulas, runs = []; let from = 0;
      for (const match of matches) {
        if (match.index > from) runs.push({ text: value.slice(from, match.index) });
        try {
          if (!renderFormula) throw new Error('Formula renderer unavailable');
          runs.push({ formula: renderFormula(match.tex, match.display, size), display: match.display }); stats.formulas++;
        }
        catch (error) { runs.push({ text: match.raw }); fallback('formula', error); }
        from = match.index + match.raw.length;
      }
      if (from < value.length) runs.push({ text: value.slice(from) });
      return runs;
    }
    function layoutMath(runs, available, size = 10.5) {
      const lines = [], baseHeight = size * 1.7;
      let line = [], lineWidth = 0, lineHeight = baseHeight;
      const flush = () => {
        if (!line.length) return;
        lines.push({ runs: line, width: lineWidth, height: lineHeight });
        line = []; lineWidth = 0; lineHeight = baseHeight;
      };
      const append = (run) => {
        if (lineWidth + run.width > available && line.length) flush();
        line.push(run); lineWidth += run.width; lineHeight = Math.max(lineHeight, run.formula?.height || baseHeight);
      };
      for (const run of runs) {
        if (run.formula) {
          if (run.display) flush();
          const scale = Math.min(1, available / run.formula.width, (run.display ? 400 : size * 5.7) / run.formula.height);
          append({ formula: { ...run.formula, height: run.formula.height * scale }, width: run.formula.width * scale });
          if (run.display) { flush(); lines.at(-1).center = true; }
        } else for (const part of run.text.match(/\n|[^\S\n]+|[\u3400-\u9fff]|[^\s\u3400-\u9fff]+/gu) || []) {
          if (part === '\n') { flush(); continue; }
          doc.font('Reader').fontSize(size); const measured = doc.widthOfString(part);
          if (measured <= available) append({ text: part, width: measured });
          else for (const char of part) append({ text: char, width: doc.widthOfString(char) });
        }
      }
      flush(); return lines;
    }
    function drawMathLine(line, x, y, available, size) {
      if (line.center) x += (available - line.width) / 2;
      for (const run of line.runs) {
        if (run.formula) drawSvg(run.formula.svg, x, y + Math.max(0, (line.height - run.formula.height) / 2), run.width, run.formula.height);
        else doc.font('Reader').fontSize(size).fillColor('#202124').text(run.text, x, y + Math.max(0, (line.height - size * 1.7) / 2), { lineBreak: false });
        x += run.width;
      }
    }
    async function paragraph(value, indent = 0, protectedRanges = [], size = 10.5) {
      const runs = await mathRuns(value, size, protectedRanges);
      if (!runs) { text(value, { indent, size }); return; }
      // Reserve formula height both in paragraphs and table cells before pagination.
      for (const line of layoutMath(runs, width - indent, size)) {
        ensureSpace(line.height + 3); const y = doc.y;
        drawMathLine(line, MARGIN + indent, y, width - indent, size);
        doc.y = y + line.height + 3; doc.x = MARGIN;
      }
      doc.y += 6;
    }
    async function image(token) {
      let url = assets.get(normalize(token.href)) || token.href;
      if (data.resourceBase && !/^(?:[a-z]+:|\/)/i.test(url)) url = data.resourceBase + encodeURIComponent(token.href);
      if (!/^(blob:|data:|https?:|mengx-resource:)/i.test(url)) { text(token.text || ''); fallback('image', new Error('Image has no accessible resource path')); return; }
      try {
        let bytes = imageCache.get(url);
        if (!bytes) {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) }); if (!res.ok) throw new Error('Image unavailable');
          bytes = new Uint8Array(await res.arrayBuffer()); if (bytes.length > 16 * 1024 * 1024) throw new Error('Image is too large');
          if (imageCache.size >= 8) imageCache.delete(imageCache.keys().next().value); imageCache.set(url, bytes);
        }
        if (new TextDecoder().decode(bytes.slice(0, 1000)).includes('<svg')) svgGraphic(new TextDecoder().decode(bytes));
        else {
          let opened;
          try { opened = doc.openImage(bytes); }
          catch {
            const bitmap = await createImageBitmap(new Blob([bytes]));
            const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
            bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()); opened = doc.openImage(bytes);
          }
          const scale = Math.min(width / opened.width, 420 / opened.height, 1), h = opened.height * scale;
          ensureSpace(h + 10); doc.image(opened, MARGIN, doc.y, { width: opened.width * scale }); doc.y += h + 12;
        }
        stats.images++;
      } catch (error) { text(token.text || token.href, { color: '#62666b' }); fallback('image', error); }
    }
    async function table(token) {
      const columns = token.header.length; if (!columns) return;
      const cellWidth = width / columns, available = Math.max(14, cellWidth - 12);
      const values = (cells) => cells.map((cell) => cell.tokens ? inlineContent(cell.tokens) : { value: cell.text || '', protectedRanges: [] });
      const prepare = async (contents) => {
        const cells = [];
        for (const content of contents) {
          const runs = content.value.length <= 3000 ? await mathRuns(content.value, 9, content.protectedRanges) : null;
          const lines = runs ? layoutMath(runs, available, 9) : null;
          doc.font('Reader').fontSize(9);
          cells.push({ ...content, lines, height: lines ? lines.reduce((sum, line) => sum + line.height + 3, 0) + 12 : doc.heightOfString(content.value.slice(0, 3000), { width: available, lineGap: 3 }) + 12 });
        }
        return { cells, height: Math.max(25, ...cells.map((cell) => cell.height)) };
      };
      const header = values(token.header), headerLayout = await prepare(header);
      const draw = ({ cells, height }, isHeader) => {
        const y = doc.y;
        cells.forEach(({ value, lines }, col) => {
          const x = MARGIN + col * cellWidth;
          if (isHeader) doc.rect(x, y, cellWidth, height).fill('#f4f5f6');
          doc.rect(x, y, cellWidth, height).lineWidth(.4).strokeColor('#dfe1e4').stroke();
          if (lines) {
            let lineY = y + 6;
            for (const line of lines) { drawMathLine(line, x + 6, lineY, available, 9); lineY += line.height + 3; }
          } else doc.font('Reader').fontSize(9).fillColor('#202124').text(value, x + 6, y + 6, { width: available, height: height - 10, lineGap: 3 });
        }); doc.y = y + height; doc.x = MARGIN;
      };
      for (const [rowIndex, cells] of [token.header, ...token.rows].entries()) {
        const contents = rowIndex ? values(cells) : header, layout = rowIndex ? await prepare(contents) : headerLayout;
        if (layout.height > 630 || contents.some(({ value }) => value.length > 3000) || cellWidth < 30) {
          for (const [col, { value, protectedRanges }] of contents.entries()) {
            if (rowIndex) text(header[col].value + ':', { size: 9, gap: 2 });
            await paragraph(value, 0, protectedRanges, 9);
          }
          doc.y += 6; continue;
        }
        if (doc.y + layout.height > pageBottom()) {
          doc.addPage();
          if (rowIndex && headerLayout.height < 140 && headerLayout.height + layout.height < pageBottom() - MARGIN) { draw(headerLayout, true); stats.repeatedTableHeaders++; }
        }
        draw(layout, rowIndex === 0);
      } doc.y += 10;
    }
    function codeBlock(value, indent = 0) {
      doc.font('Reader').fontSize(9); const available = width - indent - 16, lines = [];
      for (const line of value.split('\n')) {
        let current = '', measured = 0;
        for (const char of line.replace(/\t/g, '    ')) {
          const w = doc.widthOfString(char); if (measured + w > available && current) { lines.push(current); current = ''; measured = 0; } current += char; measured += w;
        } lines.push(current);
      }
      for (const line of lines) {
        ensureSpace(18); const y = doc.y; doc.rect(MARGIN + indent, y, width - indent, 18).fill('#f5f6f7');
        doc.font('Reader').fontSize(9).fillColor('#30343a').text(line || ' ', MARGIN + indent + 8, y + 2, { lineBreak: false }); doc.y = y + 18;
      } doc.x = MARGIN; doc.y += 10;
    }
    async function visitImages(children) {
      for (const child of children || []) {
        if (child.type === 'image') await image(child);
        else if (child.tokens) await visitImages(child.tokens);
      }
    }
    async function render(tokens, indent = 0) {
      for (const token of tokens) switch (token.type) {
        case 'heading': {
          const size = [0, 21, 16, 13.5, 12, 11, 10.5][token.depth], value = inline(token.tokens) || token.text;
          doc.font('Reader').fontSize(size); ensureSpace(doc.heightOfString(value, { width: width - indent, lineGap: 4 }) + 45);
          doc.y += token.depth === 1 ? 4 : 8; text(value, { size, gap: 9, indent }); break;
        }
        case 'paragraph': case 'text': {
          const content = inlineContent(token.tokens);
          await paragraph(token.tokens ? content.value : token.text, indent, content.protectedRanges);
          await visitImages(token.tokens); break;
        }
        case 'code':
          if (token.lang?.trim().toLowerCase() === 'mermaid' && stats.diagrams < 100 && token.text.length <= 8000) {
            try { svgGraphic(await diagram(token.text)); stats.diagrams++; } catch (error) { codeBlock(token.text, Math.min(indent, 20)); fallback('diagram', error); }
          } else {
            codeBlock(token.text, Math.min(indent, 20));
            if (token.lang?.trim().toLowerCase() === 'mermaid') fallback('diagram', new Error('Diagram exceeds the rendering limit'));
          }
          break;
        case 'blockquote': await render(token.tokens, Math.min(indent + 10, 20)); break;
        case 'list': {
          for (const [index, item] of token.items.entries()) {
            const prefix = token.ordered ? `${Number(token.start || 1) + index}. ` : item.task ? (item.checked ? '☑ ' : '☐ ') : '• ';
            let first = true;
            for (const child of item.tokens || []) {
              if (['text', 'paragraph'].includes(child.type)) {
                const content = inlineContent(child.tokens), bullet = first ? prefix : '';
                await paragraph(bullet + (child.tokens ? content.value : child.text), Math.min(indent + 8, 20), content.protectedRanges.map(({ start, end }) => ({ start: start + bullet.length, end: end + bullet.length })));
                await visitImages(child.tokens); first = false;
              } else await render([child], Math.min(indent + 8, 20));
            }
            if (!item.tokens?.length) await paragraph(prefix + item.text, Math.min(indent + 8, 20));
          }
          doc.y += 3; break;
        }
        case 'table': await table(token); break;
        case 'definitionListsSingleLine': case 'definitionListsMultiLine':
          for (const entry of token.definitions) {
            text(inline(entry.dt), { size: 11, gap: 3, indent });
            for (const definition of entry.dds || [entry.dd]) await paragraph(inline(definition), Math.min(indent + 10, 20));
          }
          break;
        case 'footnotes':
          if (token.items.length) {
            text('脚注 / Footnotes', { size: 12, indent });
            for (const item of token.items) {
              text(`[${item.refs[0]?.id || item.label}]`, { size: 9, gap: 2, indent });
              await render(item.content, Math.min(indent + 10, 20));
            }
          }
          break;
        case 'hr': ensureSpace(20); doc.moveTo(MARGIN, doc.y + 6).lineTo(MARGIN + width, doc.y + 6).strokeColor('#dfe1e4').lineWidth(.5).stroke(); doc.y += 18; break;
        case 'html': text(token.text.replace(/<[^>]+>/g, ''), { indent }); break;
      }
    }
    const model = analyzeDocument(data.source);
    self.postMessage({ type: 'progress', value: 5, phase: 'layout', pages }); let reported = 5, reportedAt = performance.now();
    for (const chunk of model.chunks) {
      const source = data.source.slice(chunk.start, chunk.end);
      if (chunk.plain) text(source, { size: 9 }); else await render(markdownTokens(sourceForChunk(data.source, chunk, model)));
      const value = Math.min(93, 5 + Math.round(chunk.end / Math.max(data.source.length, 1) * 88));
      if (value !== reported || performance.now() - reportedAt > 150) { self.postMessage({ type: 'progress', value, phase: 'layout', pages }); reported = value; reportedAt = performance.now(); }
    }
    self.postMessage({ type: 'progress', value: 95, phase: 'finish', pages }); doc.end(); await completed;
    const bytes = new Uint8Array(output.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0;
    for (const part of output) { bytes.set(part, offset); offset += part.byteLength; }
    self.postMessage({ type: 'done', buffer: bytes.buffer, pages, stats }, [bytes.buffer]);
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'PDF generation failed' }); }
};
