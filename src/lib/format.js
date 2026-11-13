/**
 * How body text should be aligned. Justified lines suit Chinese, Japanese and Korean, where
 * every character is the same width; in English and other spaced scripts they open wide gaps
 * between words, so that text is set ragged-right.
 */
export function textAlignFor(text) {
  const sample = String(text || '').slice(0, 20000);
  const cjk = sample.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length || 0;
  const words = sample.match(/[A-Za-z\u00c0-\u024f\u0400-\u04ff]{2,}/g)?.length || 0;
  return cjk >= words ? 'justify' : 'start';
}

export function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatKindLabel(kind, copy) {
  if (kind === 'DOCX') return copy.formatDocx;
  if (kind === 'HTML') return copy.formatHtml;
  if (kind === 'TXT') return copy.textDocument;
  return copy.markdown;
}

export function formatRecentTime(value, language) {
  const labels = {
    zh: { 'just-now': '刚刚', yesterday: '昨天', 'oct-01': '10 月 1 日', 'sep-29': '9 月 29 日', 'Just now': '刚刚', Yesterday: '昨天', 'Oct 01': '10 月 1 日', 'Sep 29': '9 月 29 日' },
    en: { 'just-now': 'Just now', yesterday: 'Yesterday', 'oct-01': 'Oct 01', 'sep-29': 'Sep 29', '刚刚': 'Just now', '昨天': 'Yesterday' },
  };
  return labels[language][value] || value;
}

/**
 * A path as shown under the document title: the file and the folder it is in. The full path
 * (which names the user's account and folders) stays in the tooltip, out of screenshots.
 */
export function shortPath(value) {
  const text = String(value || '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  const separator = text.includes('\\') ? '\\' : '/';
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2 || !/[\\/]/.test(text)) return text;
  return '\u2026' + separator + parts.slice(-2).join(separator);
}

export function formatRecentPath(value, language) {
  if (value === 'Local file') return language === 'zh' ? '本地文件' : 'Local file';
  return value.replace(/^(?:Morrow|MENG X|Redline)/, 'Stetwise');
}

export function formatMetaTime(value, language) {
  const labels = {
    zh: { 'just-now': '刚刚', 'saved-just-now': '刚刚保存', 'Just now': '刚刚', 'Saved just now': '刚刚保存' },
    en: { 'just-now': 'Just now', 'saved-just-now': 'Saved just now', '刚刚': 'Just now', '刚刚保存': 'Saved just now' },
  };
  return labels[language][value] || value;
}

export function documentSummary(markdown, fallback) {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || /^#{1,6}\s/.test(line) || /^>/.test(line) || /^[-*+]\s/.test(line) || /^\d+\.\s/.test(line) || /^\|/.test(line) || /^---+$/.test(line)) continue;
    const text = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (text) return text.slice(0, 180);
  }
  return fallback;
}

export function lightDocumentTitle(markdown, fileName) {
  const match = /^(?:#)\s+(.+?)\s*$/m.exec(markdown.slice(0, 160000));
  return match?.[1]?.replace(/[*_`]/g, '').trim() || fileName.replace(/\.(md|markdown|txt|html?)$/i, '');
}

export function estimateWordCount(markdown) {
  const compact = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return 0;
  const latin = compact.match(/[A-Za-z0-9_]+/g)?.length || 0;
  const han = compact.match(/[\u3400-\u9fff]/g)?.length || 0;
  return latin + han;
}

export function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
