// Charts stored as plain Markdown tables with one hidden directive line above them:
//
//   <!-- proofline:chart type=bar title="季度销售额" unit="万元" -->
//   | 季度 | 线上 | 门店 |
//   |---|---:|---:|
//   | Q1 | 80 | 40 |
//
// Other Markdown apps show the table (the comment is invisible), so no data is lost,
// and an AI edits the numbers like any other table. Proofline draws the chart inside a
// shadow root, so chart labels never become document text for marks or search.

export const CHART_TYPES = ['bar', 'stacked', 'hbar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter'];
const ALIASES = { column: 'bar', columns: 'bar', 'stacked-bar': 'stacked', 'bar-stacked': 'stacked', horizontal: 'hbar', 'bar-horizontal': 'hbar',
  donut: 'doughnut', ring: 'doughnut', 柱状图: 'bar', 堆叠: 'stacked', 条形图: 'hbar', 折线图: 'line', 面积图: 'area', 饼图: 'pie', 环形图: 'doughnut', 雷达图: 'radar', 散点图: 'scatter' };

// Validated categorical order (see the dataviz reference palette); identity, never rank.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const INK = '#0b0b0b', INK_2 = '#52514e', MUTED = '#8a8984', GRID = '#e7e5df', SURFACE = '#fcfcfb';
const FONT = '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif';

export const DIRECTIVE = /<!--\s*proofline:chart\b([^>]*?)-->/i;

export function parseChartSpec(text = '') {
  const spec = { type: 'bar' };
  for (const match of String(text).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
    const key = match[1].toLowerCase(), value = match[2] ?? match[3] ?? match[4];
    if (value === undefined) { if (key === 'stacked') spec.stacked = true; else if (key === 'horizontal') spec.horizontal = true; else if (CHART_TYPES.includes(ALIASES[key] || key)) spec.type = ALIASES[key] || key; continue; }
    if (key === 'type') spec.type = ALIASES[value.toLowerCase()] || ALIASES[value] || value.toLowerCase();
    else if (['title', 'unit', 'x', 'y'].includes(key)) spec[key] = value;
    else if (key === 'stacked' || key === 'horizontal') spec[key] = value !== 'false';
  }
  if (spec.type === 'stacked') { spec.type = 'bar'; spec.stacked = true; }
  if (spec.type === 'hbar') { spec.type = 'bar'; spec.horizontal = true; }
  if (!CHART_TYPES.includes(spec.type)) spec.type = 'bar';
  return spec;
}

export function chartDirective(spec) {
  const parts = [`type=${spec.stacked && spec.type === 'bar' ? 'stacked' : spec.horizontal && spec.type === 'bar' ? 'hbar' : spec.type}`];
  for (const key of ['title', 'unit']) if (spec[key]) parts.push(`${key}="${String(spec[key]).replaceAll('"', "'")}"`);
  return `<!-- proofline:chart ${parts.join(' ')} -->`;
}

/** Parse a number the way people write it in tables: 1,200 / 12.5% / ¥80 / 3.2万. */
export function parseNumber(text) {
  const value = String(text ?? '').trim().replace(/[,，\s]/g, '').replace(/^[¥$€£]/, '');
  const match = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(%|万|亿|k|K|m|M)?/.exec(value);
  if (!match) return null;
  const scale = { '万': 1e4, '亿': 1e8, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[match[2]] || 1;
  return Number(match[1]) * scale;
}

/** Rows of cell text (first row = header) into categories and numeric series. */
export function tableData(rows) {
  const [header = [], ...body] = rows;
  const series = header.slice(1).map((name, index) => ({ name: name || `#${index + 1}`, values: body.map((row) => parseNumber(row[index + 1])) }))
    .filter((item) => item.values.some((value) => value !== null));
  return { categories: body.map((row) => row[0] ?? ''), series, xName: header[0] || '' };
}

export function rowsFromTable(table) {
  return [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()));
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = (value) => (value === null || value === undefined ? '—' : Math.abs(value) >= 1e4 || Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 }));

function niceTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / count, power = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => span / m <= count) || 10 * power;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

// A bar with a 4px rounded data end and a square baseline end.
function barPath(x, y, w, h, horizontal) {
  const r = Math.min(4, (horizontal ? h : w) / 2, Math.abs(horizontal ? w : h));
  if (horizontal) { if (w <= 0) return ''; return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`; }
  if (h <= 0) return '';
  return `M${x},${y + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

function legend(series, x, y, width) {
  if (series.length < 2) return { svg: '', height: 0 };
  let cx = x, cy = y, out = '';
  for (const [index, item] of series.entries()) {
    const label = esc(item.name), w = 18 + Math.min(160, [...item.name].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 6.6), 0)) + 16;
    if (cx + w > x + width && cx > x) { cx = x; cy += 20; }
    out += `<rect x="${cx}" y="${cy - 9}" width="10" height="10" rx="2" fill="${SERIES_COLORS[index % 8]}"/><text x="${cx + 15}" y="${cy}" fill="${INK_2}" font-size="12">${label}</text>`;
    cx += w;
  }
  return { svg: out, height: cy - y + 18 };
}

/** Build the SVG and a list of hover targets for one chart. */
export function chartSvg(spec, data, { width = 680, height = 360 } = {}) {
  const series = data.series.slice(0, 8), categories = data.categories, unit = spec.unit ? ` ${spec.unit}` : '';
  const tips = [];
  const head = spec.title ? `<text x="0" y="16" fill="${INK}" font-size="15" font-weight="650">${esc(spec.title)}</text>` : '';
  const top0 = spec.title ? 30 : 4;
  const lg = ['pie', 'doughnut'].includes(spec.type) ? { svg: '', height: 0 } : legend(series, 0, top0 + 12, width);
  const top = top0 + lg.height + (lg.height ? 8 : 6);
  let body = '';
  if (!series.length || !categories.length) {
    body = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${MUTED}" font-size="13">表格里没有可画图的数字 / No numeric columns to chart</text>`;
  } else if (spec.type === 'pie' || spec.type === 'doughnut') {
    const values = series[0].values.map((value) => Math.max(0, value || 0)), total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = width / 2, cy = top + (height - top) / 2, r = Math.min((height - top) / 2 - 24, width / 4), inner = spec.type === 'doughnut' ? r * .58 : 0;
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const sweep = value / total * Math.PI * 2; if (!sweep) return;
      const a0 = angle, a1 = angle + sweep; angle = a1;
      const large = sweep > Math.PI ? 1 : 0, p = (a, rad) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      const path = sweep >= Math.PI * 2 - 1e-6
        ? `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0z${inner ? `M${cx - inner},${cy}a${inner},${inner} 0 1 1 ${2 * inner},0a${inner},${inner} 0 1 1 ${-2 * inner},0z` : ''}`
        : inner ? `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}z` : `M${cx},${cy}L${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}z`;
      body += `<path d="${path}" fill="${SERIES_COLORS[index % 8]}" stroke="${SURFACE}" stroke-width="2" fill-rule="evenodd" data-tip="${tips.length}"/>`;
      tips.push({ label: categories[index], series: series[0].name, value: values[index], share: value / total });
      const mid = (a0 + a1) / 2, lx = cx + (r + 16) * Math.cos(mid), ly = cy + (r + 16) * Math.sin(mid);
      if (value / total >= .04) body += `<text x="${lx}" y="${ly + 4}" text-anchor="${Math.cos(mid) >= 0 ? 'start' : 'end'}" fill="${INK_2}" font-size="12">${esc(categories[index])} ${Math.round(value / total * 100)}%</text>`;
    });
    if (inner) body += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="${INK}" font-size="20" font-weight="650">${fmt(total)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="${MUTED}" font-size="11">${esc(series[0].name)}${esc(unit)}</text>`;
  } else if (spec.type === 'radar') {
    const cx = width / 2, cy = top + (height - top) / 2, r = Math.min((height - top) / 2 - 22, width / 3), n = categories.length;
    const max = Math.max(...series.flatMap((item) => item.values.map((value) => value || 0)), 1), ticks = niceTicks(0, max, 4), hi = ticks.at(-1);
    const point = (i, value) => { const a = -Math.PI / 2 + i / n * Math.PI * 2, k = (value || 0) / hi * r; return [cx + k * Math.cos(a), cy + k * Math.sin(a)]; };
    for (const tick of ticks.slice(1)) body += `<polygon points="${categories.map((_, i) => point(i, tick).join(',')).join(' ')}" fill="none" stroke="${GRID}"/>`;
    categories.forEach((label, i) => { const [x, y] = point(i, hi), [lx, ly] = point(i, hi * 1.12); body += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${GRID}"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" fill="${INK_2}" font-size="12">${esc(label)}</text>`; });
    series.forEach((item, s) => {
      const color = SERIES_COLORS[s % 8], points = item.values.map((value, i) => point(i, value));
      body += `<polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
      points.forEach(([x, y], i) => { body += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2" data-tip="${tips.length}"/>`; tips.push({ label: categories[i], series: item.name, value: item.values[i] }); });
    });
  } else if (spec.type === 'scatter') {
    const xs = categories.map(parseNumber), left = 52, right = width - 12, bottom = height - 34;
    const ys = series.flatMap((item) => item.values).filter((v) => v !== null), xt = niceTicks(Math.min(...xs.filter((v) => v !== null), 0), Math.max(...xs.filter((v) => v !== null), 1)), yt = niceTicks(Math.min(0, ...ys), Math.max(...ys, 1));
    const sx = (v) => left + (v - xt[0]) / (xt.at(-1) - xt[0]) * (right - left), sy = (v) => bottom - (v - yt[0]) / (yt.at(-1) - yt[0]) * (bottom - top);
    for (const tick of yt) body += `<line x1="${left}" x2="${right}" y1="${sy(tick)}" y2="${sy(tick)}" stroke="${GRID}"/><text x="${left - 8}" y="${sy(tick) + 4}" text-anchor="end" fill="${MUTED}" font-size="11">${fmt(tick)}</text>`;
    for (const tick of xt) body += `<text x="${sx(tick)}" y="${bottom + 18}" text-anchor="middle" fill="${MUTED}" font-size="11">${fmt(tick)}</text>`;
    series.forEach((item, s) => item.values.forEach((value, i) => {
      if (value === null || xs[i] === null) return;
      body += `<circle cx="${sx(xs[i])}" cy="${sy(value)}" r="5" fill="${SERIES_COLORS[s % 8]}" stroke="${SURFACE}" stroke-width="2" data-tip="${tips.length}"/>`;
      tips.push({ label: `${data.xName || 'x'} ${fmt(xs[i])}`, series: item.name, value });
    }));
  } else {
    // Bar (grouped / stacked / horizontal), line and area share one value axis.
    const horizontal = spec.type === 'bar' && spec.horizontal, stacked = spec.type === 'bar' && spec.stacked;
    const totals = categories.map((_, i) => series.reduce((sum, item) => sum + Math.max(0, item.values[i] || 0), 0));
    const all = series.flatMap((item) => item.values).filter((value) => value !== null);
    const ticks = niceTicks(Math.min(0, ...all), stacked ? Math.max(...totals, 1) : Math.max(...all, 1));
    const lo = ticks[0], hi = ticks.at(-1);
    const labelWidth = horizontal ? Math.min(160, 14 + Math.max(...categories.map((c) => [...String(c)].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 12 : 6.6), 0)))) : 0;
    const left = horizontal ? labelWidth : Math.max(36, 12 + Math.max(...ticks.map((t) => fmt(t).length)) * 7), right = width - 8, bottom = height - (horizontal ? 24 : 30);
    const scale = (value) => horizontal ? left + (value - lo) / (hi - lo) * (right - left) : bottom - (value - lo) / (hi - lo) * (bottom - top);
    const band = ((horizontal ? bottom - top : right - left)) / categories.length;
    for (const tick of ticks) {
      const at = scale(tick);
      body += horizontal ? `<line x1="${at}" x2="${at}" y1="${top}" y2="${bottom}" stroke="${tick === 0 ? '#bdbbb4' : GRID}"/><text x="${at}" y="${bottom + 16}" text-anchor="middle" fill="${MUTED}" font-size="11">${fmt(tick)}</text>`
        : `<line x1="${left}" x2="${right}" y1="${at}" y2="${at}" stroke="${tick === 0 ? '#bdbbb4' : GRID}"/><text x="${left - 8}" y="${at + 4}" text-anchor="end" fill="${MUTED}" font-size="11">${fmt(tick)}</text>`;
    }
    const step = Math.max(1, Math.ceil(categories.length / Math.floor((right - left) / 56)));
    categories.forEach((label, i) => {
      if (horizontal) body += `<text x="${left - 8}" y="${top + band * (i + .5) + 4}" text-anchor="end" fill="${INK_2}" font-size="12">${esc(label)}</text>`;
      else if (i % step === 0) body += `<text x="${left + band * (i + .5)}" y="${bottom + 18}" text-anchor="middle" fill="${INK_2}" font-size="12">${esc(label)}</text>`;
    });
    if (spec.type === 'bar') {
      const groups = stacked ? 1 : series.length, inner = Math.min(band * .72, (horizontal ? 30 : 56) * groups + 2 * (groups - 1)), gap = groups > 1 ? 2 : 0, w = (inner - gap * (groups - 1)) / groups, zero = scale(Math.max(lo, 0));
      categories.forEach((label, i) => {
        let base = 0;
        series.forEach((item, s) => {
          const value = item.values[i]; if (value === null) return;
          const color = SERIES_COLORS[s % 8], start = band * i + (band - inner) / 2 + (stacked ? 0 : s * (w + gap));
          const from = stacked ? base : 0, to = stacked ? base + Math.max(0, value) : value; if (stacked) base = to;
          const a = scale(from), b = scale(to), data = `data-tip="${tips.length}"`;
          if (horizontal) { const x = Math.min(a, b), len = Math.abs(b - a) - (stacked && s ? 2 : 0); body += `<path d="${barPath(x + (stacked && s ? 2 : 0), top + start, len, w, true)}" fill="${color}" ${data}/>`; }
          else { const y = Math.min(a, b), len = Math.abs(b - a) - (stacked && s ? 2 : 0); body += value >= 0 || stacked ? `<path d="${barPath(left + start, y, w, len, false)}" fill="${color}" ${data}/>` : `<rect x="${left + start}" y="${zero}" width="${w}" height="${len}" fill="${color}" ${data}/>`; }
          tips.push({ label, series: item.name, value });
        });
      });
    } else {
      const x = (i) => left + band * (i + .5);
      series.forEach((item, s) => {
        const color = SERIES_COLORS[s % 8], points = item.values.map((value, i) => (value === null ? null : [x(i), scale(value)]));
        const segments = []; let current = [];
        for (const point of points) { if (point) current.push(point); else if (current.length) { segments.push(current); current = []; } }
        if (current.length) segments.push(current);
        for (const segment of segments) {
          const d = segment.map(([px, py], k) => `${k ? 'L' : 'M'}${px},${py}`).join('');
          if (spec.type === 'area') body += `<path d="${d}L${segment.at(-1)[0]},${scale(Math.max(lo, 0))}L${segment[0][0]},${scale(Math.max(lo, 0))}z" fill="${color}" fill-opacity="${series.length > 1 ? .12 : .18}"/>`;
          body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        }
        points.forEach((point, i) => { if (!point) return; body += `<circle cx="${point[0]}" cy="${point[1]}" r="${categories.length <= 16 ? 3.5 : 0}" fill="${color}" stroke="${SURFACE}" stroke-width="1.5"/><rect x="${point[0] - band / 2}" y="${top}" width="${band}" height="${bottom - top}" fill="transparent" data-tip="${tips.length}"/>`; tips.push({ label: categories[i], series: item.name, value: item.values[i], all: series.map((other) => ({ name: other.name, value: other.values[i] })) }); });
        // Direct label at the line end for up to four series.
        const last = points.findLast(Boolean);
        if (last && series.length > 1 && series.length <= 4) body += `<text x="${Math.min(last[0] + 6, right - 2)}" y="${last[1] - 8}" text-anchor="end" fill="${INK_2}" font-size="11">${esc(item.name)}</text>`;
      });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(spec.title || '')}" font-family='${FONT}'>${head}${lg.svg}${body}</svg>`;
  return { svg, tips: tips.map((tip) => ({ ...tip, unit: spec.unit || '' })) };
}

const STYLE = `:host{display:block;margin:28px 0}
.frame{position:relative;border:1px solid #e7e5df;border-radius:6px;background:${SURFACE};padding:16px 16px 10px}
.bar{display:flex;gap:6px;justify-content:flex-end;margin:-6px -6px 6px 0}
button{font:600 12px ${FONT};color:${INK_2};background:#fff;border:1px solid #d9d7d0;border-radius:4px;padding:4px 10px;cursor:pointer}
button:hover{color:${INK};border-color:${INK}} button[aria-pressed=true]{color:#fff;background:${INK};border-color:${INK}}
.tip{position:absolute;pointer-events:none;background:#fff;border:1px solid #d9d7d0;border-radius:6px;box-shadow:0 4px 14px #0002;padding:6px 9px;font:12px/1.5 ${FONT};color:${INK};white-space:nowrap;opacity:0;transition:opacity .08s}
.tip b{font-weight:650} .tip span{color:${INK_2}}
[data-tip]{cursor:default} [data-tip]:hover{opacity:.86}
.data{margin-top:8px} :host(:not(.show-data)) .data{display:none} :host(.show-data) .chart{display:none}
.error{font:13px ${FONT};color:#9a1b0c;padding:8px 0}`;

/** Attach (or refresh) the shadow-root chart for a .pl-chart-block that wraps a table. */
export function hydrateChart(block, labels = {}) {
  const table = block.querySelector('table');
  if (!table) return;
  const spec = parseChartSpec(block.dataset.chartSpec || '');
  const rows = rowsFromTable(table), signature = JSON.stringify([spec, rows, labels.data]);
  if (block.dataset.chartRendered === signature && block.shadowRoot) return;
  const root = block.shadowRoot || block.attachShadow({ mode: 'open' });
  const { svg, tips } = chartSvg(spec, tableData(rows));
  root.innerHTML = `<style>${STYLE}</style><div class="frame"><div class="bar"><button class="view" aria-pressed="false">${esc(labels.data || '数据')}</button><button class="mark" title="${esc(labels.markHint || '')}">${esc(labels.mark || '对图表下指令')}</button></div><div class="chart">${svg}</div><div class="data"><slot></slot></div><div class="tip" role="tooltip"></div></div>`;
  block.dataset.chartRendered = signature;
  const tip = root.querySelector('.tip'), frame = root.querySelector('.frame');
  root.querySelector('.chart').addEventListener('pointermove', (event) => {
    const target = event.composedPath().find((node) => node.dataset?.tip !== undefined);
    if (!target) { tip.style.opacity = 0; return; }
    const item = tips[Number(target.dataset.tip)], box = frame.getBoundingClientRect();
    const rows = item.all && item.all.length > 1 ? item.all.map((entry) => `<div><span>${esc(entry.name)}</span> <b>${fmt(entry.value)}${esc(item.unit)}</b></div>`).join('')
      : `<div><span>${esc(item.series)}</span> <b>${fmt(item.value)}${esc(item.unit)}</b>${item.share !== undefined ? ` <span>(${Math.round(item.share * 1000) / 10}%)</span>` : ''}</div>`;
    tip.innerHTML = `<div><b>${esc(item.label)}</b></div>${rows}`;
    const x = Math.min(event.clientX - box.left + 14, box.width - tip.offsetWidth - 6), y = Math.max(6, event.clientY - box.top - tip.offsetHeight - 10);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.style.opacity = 1;
  });
  root.querySelector('.chart').addEventListener('pointerleave', () => { tip.style.opacity = 0; });
  const view = root.querySelector('.view');
  view.addEventListener('click', () => { const on = block.classList.toggle('show-data'); view.setAttribute('aria-pressed', String(on)); });
  root.querySelector('.mark').addEventListener('click', () => {
    block.classList.add('show-data'); view.setAttribute('aria-pressed', 'true');
    block.dispatchEvent(new CustomEvent('proofline:select-component', { bubbles: true, composed: true, detail: { node: table } }));
  });
}

/** Mermaid code blocks: draw the diagram in a sibling shadow host; the code stays as the source. */
export function hydrateMermaid(pre, render, labels = {}) {
  if (pre.dataset.diagramState) return;
  const code = pre.querySelector('code')?.textContent || '';
  if (!code.trim()) return;
  pre.dataset.diagramState = 'pending';
  const host = document.createElement('div');
  host.className = 'pl-diagram-host'; host.dataset.readerUi = 'true'; host.contentEditable = 'false';
  pre.before(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}.chart{display:flex;justify-content:center;overflow-x:auto}.chart svg{max-width:100%;height:auto}</style><div class="frame"><div class="bar"><button class="view" aria-pressed="false">${esc(labels.source || '源码')}</button><button class="mark">${esc(labels.mark || '对图表下指令')}</button></div><div class="chart"></div></div>`;
  const view = root.querySelector('.view');
  view.addEventListener('click', () => { const on = pre.classList.toggle('diagram-source-visible'); view.setAttribute('aria-pressed', String(on)); });
  root.querySelector('.mark').addEventListener('click', () => {
    pre.classList.add('diagram-source-visible'); view.setAttribute('aria-pressed', 'true');
    pre.dispatchEvent(new CustomEvent('proofline:select-component', { bubbles: true, composed: true, detail: { node: pre.querySelector('code') || pre } }));
  });
  render(code).then((svg) => {
    root.querySelector('.chart').innerHTML = svg; pre.dataset.diagramState = 'rendered'; pre.classList.add('diagram-rendered');
  }).catch((error) => { root.querySelector('.chart').innerHTML = `<div class="error">${esc(labels.failed || '图表无法渲染')}：${esc(error.message || '')}</div>`; pre.dataset.diagramState = 'failed'; });
}

/** Render every chart and diagram under root (idempotent; safe to call after each update). */
export function hydrateWidgets(root, { renderMermaid, labels } = {}) {
  if (!root) return;
  root.querySelectorAll('.pl-chart-block').forEach((block) => hydrateChart(block, labels));
  if (renderMermaid) root.querySelectorAll('pre.mermaid-block').forEach((pre) => hydrateMermaid(pre, renderMermaid, labels));
}

/** Markdown for a new chart: directive line + table. */
export function chartMarkdown(type = 'bar', language = 'zh') {
  const zh = language !== 'en';
  const rows = type === 'pie' || type === 'doughnut'
    ? [[zh ? '渠道' : 'Channel', zh ? '占比' : 'Share'], [zh ? '线上' : 'Online', '45'], [zh ? '门店' : 'Stores', '30'], [zh ? '分销' : 'Resellers', '25']]
    : type === 'scatter' ? [['x', 'y'], ['1', '2.1'], ['2', '3.9'], ['3', '6.2'], ['4', '7.8']]
    : type === 'radar' ? [[zh ? '维度' : 'Axis', zh ? '方案 A' : 'Plan A', zh ? '方案 B' : 'Plan B'], [zh ? '成本' : 'Cost', '4', '3'], [zh ? '速度' : 'Speed', '3', '5'], [zh ? '质量' : 'Quality', '5', '4'], [zh ? '风险' : 'Risk', '2', '3'], [zh ? '体验' : 'UX', '4', '5']]
    : [[zh ? '季度' : 'Quarter', zh ? '线上' : 'Online', zh ? '门店' : 'Stores'], ['Q1', '80', '40'], ['Q2', '95', '55'], ['Q3', '120', '60'], ['Q4', '110', '72']];
  const title = { bar: zh ? '季度销售额' : 'Sales by quarter', stacked: zh ? '季度销售额' : 'Sales by quarter', hbar: zh ? '季度销售额' : 'Sales by quarter', line: zh ? '季度趋势' : 'Quarterly trend', area: zh ? '季度趋势' : 'Quarterly trend', pie: zh ? '渠道占比' : 'Share by channel', doughnut: zh ? '渠道占比' : 'Share by channel', radar: zh ? '方案对比' : 'Plan comparison', scatter: zh ? '相关性' : 'Correlation' }[type];
  const spec = parseChartSpec(`type=${type}`); spec.title = title; if (!['scatter', 'radar', 'pie', 'doughnut'].includes(type)) spec.unit = zh ? '万元' : 'k';
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [chartDirective(spec), line(rows[0]), `| ${rows[0].map((_, i) => (i ? '---:' : '---')).join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}
