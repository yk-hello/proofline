import { splitBlocks } from '../../electron/redline-core.mjs';

const WHOLE_LIMIT = 30000;   // documents up to this size are edited in one piece
const PART_TARGET = 24000;   // otherwise edit parts of about this size
const PART_MAX = 40000;

/**
 * Split a long document into editable parts at headings (and block boundaries for
 * very long sections), so the rich editor stays responsive on books and reports.
 */
export function editableParts(source) {
  if (source.length <= WHOLE_LIMIT) return [{ start: 0, end: source.length, label: '' }];
  const blocks = splitBlocks(source);
  const parts = [];
  let current = null;
  const close = () => { if (current) { parts.push(current); current = null; } };
  for (const block of blocks) {
    const heading = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/m.exec(block.text.split('\n')[0]);
    const size = current ? current.end - current.start : 0;
    if (current && ((heading && size >= PART_TARGET / 3) || size + block.text.length > PART_MAX || (size >= PART_TARGET && !heading && block.text.length > 0 && size > PART_TARGET * 1.3))) close();
    if (!current) current = { start: block.start, end: block.start, label: heading ? heading[2].replace(/[*_`]/g, '') : '' };
    if (!current.label && heading) current.label = heading[2].replace(/[*_`]/g, '');
    current.end = block.end;
  }
  close();
  let lastLabel = '';
  for (const part of parts) {
    if (!part.label) part.label = lastLabel ? `${lastLabel}（续）` : source.slice(part.start, part.start + 24).replace(/\s+/g, ' ').trim();
    lastLabel = part.label.replace(/（续）$/, '');
  }
  return parts;
}

export function partAt(parts, offset) {
  const index = parts.findIndex((part) => offset >= part.start && offset < part.end);
  return index < 0 ? Math.max(0, parts.length - 1) : index;
}
