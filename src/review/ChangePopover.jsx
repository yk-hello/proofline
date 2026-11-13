import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Columns2, Undo2, X } from 'lucide-react';
import { WordDiff } from './ReviewView';

/**
 * One change, shown where it is in the text: what the passage said, what it says now, and a
 * way to put it back, without leaving the document for the compare page.
 */
export default function ChangePopover({ language, before, after, anchorRect, chips = [], onPutBack, onCompare, onClose }) {
  const zh = language === 'zh';
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !anchorRect) return;
    const margin = 8;
    const left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, anchorRect.left));
    let top = anchorRect.bottom + 10;
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - box.height - 10);
    setPosition({ left, top });
  }, [anchorRect, before, after]);
  useEffect(() => {
    const outside = (event) => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      else if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); onPutBack(); }
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  });
  return <div ref={ref} className="mark-popover change-popover" role="dialog" aria-label={zh ? '这处改动' : 'This change'} style={position}>
    <div className="mark-popover-head">
      <strong className="change-popover-title">{!before.trim() ? (zh ? '新增的内容' : 'Added') : zh ? '这处改动' : 'This change'}</strong>
      {chips.map((chip) => <span key={chip.text} className={chip.className}>{chip.text}</span>)}
      <span className="spacer" />
      <button className="icon-button quiet" aria-label={zh ? '关闭' : 'Close'} title="Esc" onClick={onClose}><X size={15} /></button>
    </div>
    <WordDiff before={before.trim()} after={after.trim()} />
    <div className="mark-popover-actions">
      <button className="text-like" onClick={onCompare}><Columns2 size={14} />{zh ? '对比全部改动' : 'Compare all changes'}</button>
      <button className="primary-small" onClick={onPutBack}><Undo2 size={14} />{!before.trim() ? (zh ? '去掉' : 'Remove') : zh ? '改回' : 'Put back'}<kbd>R</kbd></button>
    </div>
  </div>;
}
