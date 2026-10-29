import { Marked } from 'marked';
import katex from 'katex';
import { findMathMatches } from './math-matches.js';
import markedFootnote from 'marked-footnote';
import markedDefinitionLists from 'marked-definition-lists';

const definitions = markedDefinitionLists();
// Require spaces around inline :: so C++ namespaces and IPv6 remain ordinary text.
const inlineDefinition = definitions.extensions.find((extension) => extension.name === 'definitionListsSingleLine');
const tokenizeDefinition = inlineDefinition.tokenizer;
inlineDefinition.tokenizer = function (source, tokens) {
  const prefix = /^(?:[^\n]*\S[ \t]+::[ \t]+\S[^\n]*(?:\n|$))+/.exec(source)?.[0];
  if (!prefix) return;
  return tokenizeDefinition.call(this, prefix, tokens);
};
inlineDefinition.start = (source) => source.match(/\n[^\n]*\S[ \t]+::[ \t]+\S/)?.index;

// Reuse the plugin's block tokenizer for the conventional single-colon form.
const multilineDefinition = definitions.extensions.find((extension) => extension.name === 'definitionListsMultiLine');
const tokenizeMultiline = multilineDefinition.tokenizer;
multilineDefinition.start = (source) => source.match(/\n[^\n]+\n {0,3}::{0,1}[ \t]+\S/)?.index;
multilineDefinition.tokenizer = function (source, tokens) {
  if (!/^[^\n]+\n {0,3}::{0,1}[ \t]+\S/.test(source)) return;
  const replacements = [];
  const normalized = source.replace(/^ {0,3}:([ \t]+)(?=\S)/gm, (raw, spaces, at) => {
    replacements.push({ at, delta: 2 + spaces.length - raw.length });
    return `::${spaces}`;
  });
  const token = tokenizeMultiline.call(this, normalized, tokens);
  if (!token) return;
  let length = token.raw.length;
  for (const replacement of replacements) if (replacement.at < length) length -= replacement.delta;
  return { ...token, raw: source.slice(0, length) };
};

const footnotes = () => markedFootnote({ description: '脚注 / Footnotes', backRefLabel: '返回引用 / Back to reference {0}' });

// Math is tokenized before Markdown so LaTeX keeps its backslashes, underscores
// and asterisks (\\ line breaks, a_1, x^*): otherwise emphasis and escapes eat them.
const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const katexCache = new Map();
function renderTex(tex, displayMode) {
  const key = `${displayMode ? 'D' : 'I'}${tex}`;
  let html = katexCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
    if (katexCache.size > 4000) katexCache.clear();
    katexCache.set(key, html);
  }
  return html;
}
const blockMath = {
  name: 'blockMath', level: 'block',
  start: (source) => source.match(/(?:^|\n) {0,3}(?:\$\$|\\\[)/)?.index,
  tokenizer(source) {
    const match = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(source);
    if (!match) return undefined;
    return { type: 'blockMath', raw: match[0], text: (match[1] ?? match[2]).trim() };
  },
  renderer: (token) => `<div class="math-block" data-tex="${escapeAttribute(token.text)}">${renderTex(token.text, true)}</div>\n`,
};
const inlineMath = {
  name: 'inlineMath', level: 'inline',
  start(source) {
    const index = source.search(/\$|\\\(/);
    return index < 0 ? undefined : index;
  },
  tokenizer(source) {
    if (source[0] !== '$' && !source.startsWith('\\(')) return undefined;
    const [match] = findMathMatches(source.slice(0, 4000), { display: true });
    if (!match || match.index !== 0) return undefined;
    return { type: 'inlineMath', raw: match.raw, text: match.tex.trim(), display: match.display };
  },
  renderer: (token) => `<span class="math-inline" data-tex="${escapeAttribute(token.text)}">${renderTex(token.text, Boolean(token.display))}</span>`,
};

// CommonMark refuses **…** when a delimiter sits between a CJK character and
// punctuation (而**“灰”是…光谱**，), which is how Chinese is usually written, so
// AI-written Chinese shows raw asterisks. Accept those runs as bold/italic.
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿“”‘’《》（）【】]/;
const cjkEmphasis = {
  name: 'cjkEmphasis', level: 'inline',
  start(source) { const index = source.search(/\*/); return index < 0 ? undefined : index; },
  tokenizer(source) {
    const match = /^(\*\*|\*)(?![\s*])([^\n]*?[^\s*\\])\1(?!\*)/.exec(source);
    if (!match || /\n\s*\n/.test(match[2])) return undefined;
    // Only step in where CJK text or full-width punctuation touches a delimiter;
    // everything else keeps standard CommonMark behaviour.
    const inner = match[2];
    if (!CJK.test(inner[0]) && !CJK.test(inner.at(-1)) && !CJK.test(source[match[0].length] || '')) return undefined;
    if (inner.includes('`')) return undefined;
    return { type: match[1] === '**' ? 'strong' : 'em', raw: match[0], text: inner, tokens: this.lexer.inlineTokens(inner) };
  },
};

export const marked = new Marked({ gfm: true, breaks: true }, { extensions: [blockMath, inlineMath, cjkEmphasis] }, definitions, footnotes());
// Token consumers such as the PDF worker handle math themselves, so they get plain Markdown tokens.
const tokenMarked = new Marked({ gfm: true, breaks: true }, { extensions: [cjkEmphasis] }, definitions, footnotes());

export function markdownTokens(source) {
  const tokens = tokenMarked.lexer(source);
  if (tokenMarked.defaults.walkTokens) tokenMarked.walkTokens(tokens, tokenMarked.defaults.walkTokens);
  return tokens;
}
