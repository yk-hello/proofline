import React, { useMemo, useState } from 'react';
import { Search, Undo2, Redo2, Download, Bookmark, Send, PanelRight, X, MessageCircle, Highlighter, Underline } from 'lucide-react';
import { isRedline, sortByPosition } from './marks';
import { t, typeLabel, modifierKey } from './copy';

const PERSONAL_FILTERS = ['all', 'highlight', 'underline', 'note', 'bookmark'];
const FILTER_KEYS = { highlight: 'filterHighlight', underline: 'filterUnderline', note: 'filterNote', bookmark: 'filterBookmark' };
const PERSONAL_ICONS = { highlight: Highlighter, underline: Underline, note: MessageCircle, bookmark: Bookmark };

export default function RedlineRail({ language, mode, onMode, marks, numbers, activeId, onSelect, onRemove, onSend,
  onBookmark, onExport, onUndo, onRedo, canUndo, canRedo, onHide, busy, storage, onStorage }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const redlines = useMemo(() => sortByPosition(marks.filter((item) => isRedline(item.type))), [marks]);
  const personal = useMemo(() => sortByPosition(marks.filter((item) => !isRedline(item.type))), [marks]);
  const open = redlines.filter((item) => ['open', 'sent', 'unchanged'].includes(item.status));
  const needle = query.trim().toLocaleLowerCase();
  const matches = (item) => !needle || `${item.label} ${item.anchor?.text} ${item.note} ${item.answer || ''}`.toLocaleLowerCase().includes(needle);
  const list = (mode === 'redlines' ? redlines : personal.filter((item) => filter === 'all' || item.type === filter)).filter(matches);

  return <aside className="redline-rail" aria-label={t(language, mode === 'redlines' ? 'redlines' : 'marks')}>
    <div className="rail-head">
      <div className="rail-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'redlines'} className={mode === 'redlines' ? 'active' : ''} onClick={() => onMode('redlines')}>
          {t(language, 'redlines')}{open.length > 0 && <span className="rail-count">{open.length}</span>}</button>
        <button role="tab" aria-selected={mode === 'marks'} className={mode === 'marks' ? 'active' : ''} onClick={() => onMode('marks')}>
          {t(language, 'marks')}{personal.length > 0 && <span className="rail-count quiet">{personal.length}</span>}</button>
      </div>
      <button className="icon-button quiet" onClick={onHide} aria-label={t(language, 'hideRail')} title={t(language, 'hideRail')}><PanelRight size={16} /></button>
    </div>
    {storage && <button className={`marks-save-status ${storage.status}`} onClick={onStorage} title={storage.error || storage.path || ''}>{storage.status === 'error' ? (language === 'zh' ? '标记保存失败 · 点击处理' : 'Marks not saved · Fix') : storage.status === 'saving' ? (language === 'zh' ? '正在保存标记…' : 'Saving marks…') : (language === 'zh' ? '标记已保存 · 查看位置' : 'Marks saved · Location')}</button>}
    <div className="rail-tools">
      <label className="rail-search"><Search size={14} /><input value={query} spellCheck={false} placeholder={t(language, 'findMarks')} aria-label={t(language, 'findMarks')} onChange={(event) => setQuery(event.target.value)} />
        {query && <button className="icon-button quiet" aria-label={t(language, 'close')} onClick={() => setQuery('')}><X size={13} /></button>}</label>
      <button className="icon-button quiet" onClick={onUndo} disabled={!canUndo} aria-label={t(language, 'undoMark')} title={t(language, 'undoMark')}><Undo2 size={15} /></button>
      <button className="icon-button quiet" onClick={onRedo} disabled={!canRedo} aria-label={t(language, 'redoMark')} title={t(language, 'redoMark')}><Redo2 size={15} /></button>
      <button className="icon-button quiet" onClick={onExport} aria-label={t(language, 'exportMarks')} title={t(language, 'exportMarks')}><Download size={15} /></button>
    </div>
    {mode === 'marks' && <div className="rail-filters" role="group">
      {PERSONAL_FILTERS.map((value) => <button key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {value === 'all' ? t(language, 'all') : t(language, FILTER_KEYS[value])}</button>)}
    </div>}
    <div className="rail-list">
      {mode === 'marks' && (filter === 'all' || filter === 'bookmark') && <button className="rail-bookmark" onClick={onBookmark}><Bookmark size={14} />{t(language, 'bookmarkHere')}</button>}
      {list.map((item) => {
        const number = numbers.get(item.id);
        const Icon = PERSONAL_ICONS[item.type];
        return <div key={item.id} className={`rail-item ${isRedline(item.type) ? 'redline' : 'personal'} type-${item.type} status-${item.status || 'none'} ${activeId === item.id ? 'active' : ''}`}>
          <button className="rail-item-body" onClick={() => onSelect(item.id)} disabled={item.anchor?.orphaned && item.type !== 'bookmark' && !['resolved', 'answered'].includes(item.status)}>
            <span className="rail-item-meta">
              {isRedline(item.type) ? <span className={`mark-chip type-${item.type}`}>#{number} {typeLabel(language, item.type)}</span>
                : <span className="rail-item-kind">{Icon && <Icon size={13} />}{typeLabel(language, item.type)}</span>}
              {item.status && item.status !== 'open' && <span className={`status-pill ${item.status}`}>{t(language, item.status)}</span>}
              {item.sentTo && <small>{item.sentTo}</small>}
            </span>
            <span className="rail-item-quote">{item.type === 'bookmark' ? item.label : item.anchor?.text}</span>
            {item.note && <span className="rail-item-note">{item.note}</span>}
            {item.answer && <span className="rail-item-answer">{item.answer}</span>}
            {item.status === 'question' && item.question && <span className="rail-item-question"><strong>{t(language, 'aiQuestion')}</strong>{item.question}</span>}
            {item.anchor?.orphaned && !['resolved', 'answered'].includes(item.status) && <small className="rail-item-warning">{t(language, 'orphaned')}</small>}
          </button>
          {isRedline(item.type) && <button className="icon-button quiet rail-item-send" disabled={busy} onClick={() => onSend([item.id])} aria-label={t(language, item.status === 'open' ? 'sendThis' : 'resend')} title={t(language, 'resend')}><Send size={13} /></button>}
          <button className="icon-button quiet rail-item-remove" onClick={() => onRemove(item.id)} aria-label={t(language, 'removeMark')} title={t(language, 'removeMark')}><X size={13} /></button>
        </div>;
      })}
      {!list.length && <p className="rail-empty">{t(language, mode === 'redlines' ? 'redlineEmpty' : 'marksEmpty')}</p>}
    </div>
    {mode === 'redlines' && <footer className="rail-actions">
      <button className="send-button" onClick={onSend} disabled={!open.length || busy}><Send size={16} /><span>{t(language, 'sendToAi')}</span><kbd>{modifierKey()} ↵</kbd></button>
    </footer>}
  </aside>;
}
