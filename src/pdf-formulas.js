import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const renderer = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined'], maxBuffer: 10000 }),
  OutputJax: new SVG({ fontCache: 'none' }) });
const cache = new Map();

export function formulaSvg(tex, display = false, size = 10.5) {
  const key = `${display}:${size}:${tex}`;
  if (cache.has(key)) return cache.get(key);
  if (tex.length > 10000) throw new Error('Formula is too large');
  const wrapper = renderer.convert(tex, { display, em: size, ex: size / 2, containerWidth: 500 });
  const svg = adaptor.firstChild(wrapper);
  const viewBox = adaptor.getAttribute(svg, 'viewBox').split(/\s+/).map(Number);
  const width = Math.max(1, viewBox[2] / 1000 * size), height = Math.max(size, viewBox[3] / 1000 * size);
  adaptor.setAttribute(svg, 'width', String(width)); adaptor.setAttribute(svg, 'height', String(height));
  const result = { svg: adaptor.outerHTML(svg), width, height };
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
