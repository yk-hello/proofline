export const DOCUMENT_EXTENSIONS = /\.(md|markdown|mdown|mkd|txt|html?|docx)$/i;
export const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd)$/i;

export const READING_PREFERENCE_DEFAULTS = {
  fontFamily: 'sans',
  fontSize: 'medium',
  lineHeight: 'comfortable',
  paragraphSpacing: 'comfortable',
  background: 'white',
  codeSize: 'medium',
};

export function normalizeReadingPreferences(value = {}) {
  return {
    fontFamily: ['sans', 'serif'].includes(value.fontFamily) ? value.fontFamily : READING_PREFERENCE_DEFAULTS.fontFamily,
    fontSize: ['small', 'medium', 'large'].includes(value.fontSize) ? value.fontSize : READING_PREFERENCE_DEFAULTS.fontSize,
    lineHeight: ['tight', 'comfortable', 'relaxed'].includes(value.lineHeight) ? value.lineHeight : READING_PREFERENCE_DEFAULTS.lineHeight,
    paragraphSpacing: ['compact', 'comfortable', 'airy'].includes(value.paragraphSpacing) ? value.paragraphSpacing : READING_PREFERENCE_DEFAULTS.paragraphSpacing,
    background: 'white',
    codeSize: ['small', 'medium', 'large'].includes(value.codeSize) ? value.codeSize : 'medium',
  };
}

export function readReadingPreferences(key = '') {
  let globalValue = {};
  let byDocument = {};
  try { globalValue = JSON.parse(window.localStorage.getItem('mengx-reading-preferences') || '{}'); } catch { /* use defaults */ }
  try { byDocument = JSON.parse(window.localStorage.getItem('mengx-reading-preferences-by-document') || '{}'); } catch { /* use defaults */ }
  const globalPreferences = normalizeReadingPreferences(globalValue);
  const scoped = byDocument[key] || {};
  return Object.entries(scoped).reduce((result, [name, value]) => {
    if ((name === 'fontFamily' && ['sans', 'serif'].includes(value)) ||
        (name === 'fontSize' && ['small', 'medium', 'large'].includes(value)) ||
        (name === 'lineHeight' && ['tight', 'comfortable', 'relaxed'].includes(value)) ||
        (name === 'paragraphSpacing' && ['compact', 'comfortable', 'airy'].includes(value)) ||
        (name === 'background' && value === 'white') ||
        (name === 'codeSize' && ['small', 'medium', 'large'].includes(value))) result[name] = value;
    return result;
  }, globalPreferences);
}

export function readReadingWidth(key = '') {
  try {
    const byDocument = JSON.parse(window.localStorage.getItem('mengx-reading-preferences-by-document') || '{}');
    return ['narrow', 'comfortable', 'wide'].includes(byDocument[key]?.readingWidth) ? byDocument[key].readingWidth : (window.localStorage.getItem('morrow-reading-width') || 'comfortable');
  } catch { return window.localStorage.getItem('morrow-reading-width') || 'comfortable'; }
}
