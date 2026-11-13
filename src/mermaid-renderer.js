import DOMPurify from 'dompurify';
let library, sequence = 0;
let queue = Promise.resolve();
// Drawing a diagram blocks the page for a moment. In the reader that work waits for a pause
// in scrolling, so a long document with many diagrams still scrolls smoothly.
let lastScroll = -Infinity;
if (typeof document !== 'undefined') document.addEventListener('scroll', () => { lastScroll = performance.now(); }, { capture: true, passive: true });
async function scrollPause(limit = 2500) {
  const started = performance.now();
  while (performance.now() - lastScroll < 150 && performance.now() - started < limit) await new Promise((resolve) => setTimeout(resolve, 50));
}
export class DiagramSkipped extends Error { name = 'DiagramSkipped'; }
/** `wanted` is asked when the diagram's turn comes: a diagram that scrolled away is not drawn. */
export function renderMermaidSvg(source, { wanted, waitForScroll = false } = {}) {
  const task = queue.catch(() => {}).then(async () => {
    if (source.length > 8000) throw new Error('Diagram exceeds the rendering limit');
    if (waitForScroll) await scrollPause();
    if (wanted && !wanted()) throw new DiagramSkipped('Diagram is no longer on screen');
    library ||= import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', look: 'classic', htmlLabels: false, maxTextSize: 8000,
        flowchart: { htmlLabels: false }, themeVariables: { fontFamily: 'Noto Sans SC Variable, sans-serif', fontSize: '13px',
          primaryColor: '#f5f6f7', primaryTextColor: '#202124', primaryBorderColor: '#c8cbd0', lineColor: '#60646a',
          // Same categorical order as Stetwise charts (charts.js).
          ...Object.fromEntries(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'].flatMap((color, index) => [[`pie${index + 1}`, color], [`cScale${index}`, color]])),
          pieStrokeColor: '#fcfcfb', pieStrokeWidth: '2px', pieOuterStrokeWidth: '0', pieSectionTextColor: '#ffffff', pieTitleTextSize: '15px',
          xyChart: { plotColorPalette: '#2a78d6, #eb6834, #1baf7a, #eda100, #e87ba4, #008300, #6250d6, #e34948' } } });
      return mermaid;
    });
    const mermaid = await library, host = document.createElement('div'), id = `mengx-diagram-${++sequence}`;
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;background:white;pointer-events:none'; document.body.append(host);
    try {
      const { svg } = await mermaid.render(id, source, host);
      host.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      const root = host.querySelector('svg');
      if (!root || root.querySelectorAll('*').length > 6000) throw new Error('Diagram could not be rendered');
      for (const node of [root, ...root.querySelectorAll('*')]) {
        const style = getComputedStyle(node);
        for (const attr of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'opacity']) {
          const value = style.getPropertyValue(attr); if (value && value !== 'normal') node.setAttribute(attr, value);
        }
      }
      const box = root.viewBox.baseVal; root.setAttribute('width', String(box.width || 800)); root.setAttribute('height', String(box.height || 400));
      return root.outerHTML;
    } finally { host.remove(); document.getElementById(`d${id}`)?.remove(); }
  });
  queue = task; return task;
}
