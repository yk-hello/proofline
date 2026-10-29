export const DEFAULT_SEARCH_OPTIONS = { caseSensitive: false, wholeWord: false, regex: false, scope: 'document' };

export function normalizeSearchOptions(value = {}) {
  return { caseSensitive: Boolean(value.caseSensitive), wholeWord: Boolean(value.wholeWord), regex: Boolean(value.regex),
    scope: ['document', 'folder', 'workspace'].includes(value.scope) ? value.scope : 'document' };
}

export function searchExpression(query, options = {}) {
  const settings = normalizeSearchOptions(options);
  if (!query) return null;
  if (query.length > 2000) throw Object.assign(new Error('搜索表达式过长 / Search expression too long'), { code: 'invalid-search' });
  // Disallow recursive repetition/backreferences before highlighting on the UI thread.
  // Searches still run in a cancellable worker; an invalid pattern never replaces the document model.
  if (settings.regex && (/\([^)]*[+*{][^)]*\)[+*{]/.test(query) || /\\[1-9]|\(\?[<=!]/.test(query))) {
    throw Object.assign(new Error('请简化嵌套重复或回溯表达式 / Simplify nested repetition or backreferences'), { code: 'unsafe-regex' });
  }
  try { return new RegExp(settings.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), settings.caseSensitive ? 'gu' : 'giu'); }
  catch { throw Object.assign(new Error('正则表达式无效 / Invalid regular expression'), { code: 'invalid-regex' }); }
}

const isWord = (char) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));
export function textMatches(text, query, options = {}) {
  const expression = searchExpression(query, options);
  if (!expression) return [];
  const matches = [];
  for (const match of text.matchAll(expression)) {
    if (!match[0].length) continue;
    const start = match.index, end = start + match[0].length;
    if (options.wholeWord && (isWord(text[start - 1]) || isWord(text[end]))) continue;
    matches.push({ index: start, text: match[0], length: match[0].length });
  }
  return matches;
}
