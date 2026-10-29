// Keep ordinary prices intact when Markdown also contains dollar-delimited math.
export function findMathMatches(source, { display = true } = {}) {
  const expression = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|(?<![$\\])\$([^$\n]+?)\$(?!\$)|\\\(([^\n]+?)\\\)/g;
  const matches = [];
  let match;
  while ((match = expression.exec(source))) {
    const block = match[1] !== undefined || match[2] !== undefined;
    const tex = match[1] ?? match[2] ?? match[3] ?? match[4];
    const dollars = match[3] !== undefined;
    const after = source[expression.lastIndex] || '';
    const currency = /^\d[\d,.]*(?:[kKmMbB]|USD|CNY|RMB)(?![A-Za-z])/.test(tex)
      && !/[=+^_\\]/.test(tex);
    const valid = (!block || display) && (!dollars || (!/^\s|\s$/.test(tex) && !/\d/.test(after) && !currency && /[\p{L}\d\\]/u.test(tex)));
    if (valid) matches.push({ index: match.index, raw: match[0], tex, display: block });
    else expression.lastIndex = match.index + (block ? 2 : 1);
  }
  return matches;
}
