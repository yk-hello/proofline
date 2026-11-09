import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, X, Send } from 'lucide-react';
import { REDLINE_TYPES, isRedline } from './marks';
import { t, typeLabel } from './copy';

const TYPES = [...REDLINE_TYPES, 'highlight', 'underline', 'note'];
// Things people ask for most often, one click each.
const PHRASES = {
  zh: { fix: ['更简洁', '更正式', '补充具体数据', '核实事实', '修正语病'], expand: ['举一个例子', '补充数据', '解释原因', '分成几点说明'], ask: ['这样写对吗？', '有没有出处？', '有更好的说法吗？'], free: ['改成表格', '改成要点列表', '翻译成英文', '统一术语'] },
  en: { fix: ['More concise', 'More formal', 'Add concrete figures', 'Check the facts', 'Fix the grammar'], expand: ['Add an example', 'Add figures', 'Explain why', 'Break into points'], ask: ['Is this right?', 'Is there a source?', 'Is there a better way to say it?'], free: ['Make it a table', 'Make it a bullet list', 'Translate into English', 'Make terms consistent'] },
};

/** Floating panel for one mark. Opens from a click on any painted mark or right after
 * creating one, so a mark can always be changed or removed where it is. */
export default function MarkPopover({ mark, number, anchorRect, language, autoFocus, onChangeType, onChangeNote, onRemove, onClose, onSend }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(mark.note || '');
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const noteRef = useRef(null);
  const showsNote = isRedline(mark.type) || mark.type === 'note';

  useEffect(() => { setDraft(mark.note || ''); }, [mark.id, mark.note]);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !anchorRect) return;
    const margin = 8;
    let left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, anchorRect.left));
    let top = anchorRect.bottom + 10;
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - box.height - 10);
    setPosition({ left, top });
  }, [anchorRect, mark.type, showsNote]);
  useEffect(() => { if (autoFocus && showsNote) requestAnimationFrame(() => noteRef.current?.focus()); }, [autoFocus, mark.id, showsNote]);
  useEffect(() => {
    const close = (event) => {
      if (ref.current?.contains(event.target) || event.target.closest?.('.document-content')) return;
      commit(); onClose();
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  });

  function commit() { if (showsNote && draft !== (mark.note || '')) onChangeNote(draft); }

  return <div ref={ref} className="mark-popover" role="dialog" aria-label={t(language, 'markActions')} style={position}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); commit(); onClose(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); if (isRedline(mark.type) && onSend) onSend(); else onClose(); }
    }}>
    <div className="mark-popover-head">
      <span className={`mark-chip type-${mark.type}`}>{number ? `#${number} · ` : ''}{typeLabel(language, mark.type)}</span>
      <span className="mark-popover-quote" title={mark.anchor?.text}>{mark.anchor?.document ? t(language, 'wholeDocument') : mark.anchor?.text}</span>
      <button className="icon-button quiet" aria-label={t(language, 'close')} title={`${t(language, 'close')} · Esc`} onClick={() => { commit(); onClose(); }}><X size={15} /></button>
    </div>
    {!mark.anchor?.document && <div className="mark-type-row" role="group" aria-label={t(language, 'markType')}>
      {TYPES.map((type) => <button key={type} className={`mark-type type-${type} ${mark.type === type ? 'selected' : ''}`} aria-pressed={mark.type === type}
        onClick={() => { commit(); onChangeType(type); }} title={t(language, `typeHint.${type}`)}>
        <span className="mark-swatch" aria-hidden="true" />{typeLabel(language, type)}</button>)}
    </div>}
    {showsNote && <label className="mark-note">
      <span>{isRedline(mark.type) ? t(language, 'instructionLabel') : t(language, 'noteLabel')}</span>
      <textarea ref={noteRef} value={draft} rows={3} maxLength={10000} placeholder={isRedline(mark.type) ? t(language, `placeholder.${mark.type}`) : t(language, 'placeholder.note')}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
    </label>}
    {showsNote && (PHRASES[language] || PHRASES.zh)[mark.type] && <div className="mark-phrases" role="group" aria-label={language === 'zh' ? '常用要求' : 'Common requests'}>
      {(PHRASES[language] || PHRASES.zh)[mark.type].map((phrase) => <button key={phrase} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const next = draft.trim() ? (draft.includes(phrase) ? draft : `${draft.trim()}${language === 'zh' ? '；' : '; '}${phrase}`) : phrase;
        setDraft(next); onChangeNote(next); noteRef.current?.focus();
      }}>{phrase}</button>)}
    </div>}
    {mark.status === 'question' && mark.question && <div className="mark-answer mark-question"><strong>{t(language, 'aiQuestion')}</strong><p>{mark.question}</p></div>}
    {mark.answer && <div className="mark-answer"><strong>{t(language, 'aiAnswer')}</strong><p>{mark.answer}</p></div>}
    <div className="mark-popover-actions">
      <button className="danger-text" onClick={onRemove}><Trash2 size={14} />{t(language, 'removeMark')}<kbd>Del</kbd></button>
      {isRedline(mark.type) && onSend && <button className="primary-small" onClick={() => { commit(); onSend(); }} title={`${t(language, 'sendThis')} · Ctrl Enter`}><Send size={14} />{t(language, 'sendThis')}<kbd>Ctrl ↵</kbd></button>}
    </div>
  </div>;
}
