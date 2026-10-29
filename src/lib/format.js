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

export function formatRecentPath(value, language) {
  if (value === 'Local file') return language === 'zh' ? '本地文件' : 'Local file';
  return value.replace(/^(?:Morrow|MENG X|Redline)/, 'Proofline');
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
