import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, X, Send } from 'lucide-react';
import { REDLINE_TYPES, isRedline } from './marks';
import { t, typeLabel } from './copy';

const TYPES = [...REDLINE_TYPES, 'highlight', 'underline', 'note'];

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
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); onClose(); }
    }}>
    <div className="mark-popover-head">
      <span className={`mark-chip type-${mark.type}`}>{number ? `#${number} · ` : ''}{typeLabel(language, mark.type)}</span>
      <span className="mark-popover-quote" title={mark.anchor?.text}>{mark.anchor?.text}</span>
      <button className="icon-button quiet" aria-label={t(language, 'close')} title={`${t(language, 'close')} · Esc`} onClick={() => { commit(); onClose(); }}><X size={15} /></button>
    </div>
    <div className="mark-type-row" role="group" aria-label={t(language, 'markType')}>
      {TYPES.map((type) => <button key={type} className={`mark-type type-${type} ${mark.type === type ? 'selected' : ''}`} aria-pressed={mark.type === type}
        onClick={() => { commit(); onChangeType(type); }} title={t(language, `typeHint.${type}`)}>
        <span className="mark-swatch" aria-hidden="true" />{typeLabel(language, type)}</button>)}
    </div>
    {showsNote && <label className="mark-note">
      <span>{isRedline(mark.type) ? t(language, 'instructionLabel') : t(language, 'noteLabel')}</span>
      <textarea ref={noteRef} value={draft} rows={3} maxLength={10000} placeholder={isRedline(mark.type) ? t(language, `placeholder.${mark.type}`) : t(language, 'placeholder.note')}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
    </label>}
    {mark.status === 'question' && mark.question && <div className="mark-answer mark-question"><strong>{t(language, 'aiQuestion')}</strong><p>{mark.question}</p></div>}
    {mark.answer && <div className="mark-answer"><strong>{t(language, 'aiAnswer')}</strong><p>{mark.answer}</p></div>}
    <div className="mark-popover-actions">
      <button className="danger-text" onClick={onRemove}><Trash2 size={14} />{t(language, 'removeMark')}<kbd>Del</kbd></button>
      {isRedline(mark.type) && onSend && <button className="primary-small" onClick={() => { commit(); onSend(); }}><Send size={14} />{t(language, 'sendThis')}</button>}
    </div>
  </div>;
}
