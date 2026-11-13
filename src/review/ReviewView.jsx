import React, { useEffect, useMemo, useRef, useState } from 'react';
import { diffArrays } from 'diff';
import { Check, X, ChevronDown, ChevronRight, Undo2, PencilLine } from 'lucide-react';
import { diffBlocks, composeReview, tasksForHunk, changeRisks } from '../../electron/review-core.mjs';
import { t, typeLabel, modifierKey } from './copy';

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
function tokens(text) {
  if (!segmenter) return text.split(/(\s+)/);
  return [...segmenter.segment(text)].map((item) => item.segment);
}

/** Like composeReview, with your own wording for the changes you edited. */
function composeWithEdits(diff, decisions, edits) {
  let output = '';
  for (const hunk of diff.hunks) {
    const accepted = hunk.type === 'change' && decisions[hunk.id] !== 'reject';
    if (accepted && typeof edits[hunk.id] === 'string') {
      const original = hunk.next.map((index) => diff.nextBlocks[index].text).join('') || hunk.base.map((index) => diff.baseBlocks[index].text).join('');
      const trailing = /\s*$/.exec(original)[0] || '\n\n', text = edits[hunk.id].replace(/\s+$/, '');
      output += text ? text + trailing : '';
      continue;
    }
    const blocks = hunk.type === 'equal' || !accepted ? hunk.base.map((index) => diff.baseBlocks[index]) : hunk.next.map((index) => diff.nextBlocks[index]);
    output += blocks.map((block) => block.text).join('');
  }
  return output;
}

// A change inside running text is clearest as one passage with the changed words marked.
// Added or removed blocks, and tables, code, charts, pictures and formulas, are clearer as
// formatted before and after.
const inline = (blocks) => blocks.length > 0 && blocks.every((block) => !/^\s*(?:\||```|~~~|<|\$\$|!\[)/m.test(block.text));

export function WordDiff({ before, after }) {
  const parts = useMemo(() => diffArrays(tokens(before), tokens(after)), [before, after]);
  return <pre className="word-diff">{parts.map((part, index) => <span key={index} className={part.added ? 'ins' : part.removed ? 'del' : ''}>{part.value.join('')}</span>)}</pre>;
}

/**
 * Block-by-block review. Two modes share the layout:
 * - review: decide each change, then Finish writes the result (nothing is written before);
 * - compare: everything is kept by default; mark the changes to put back, then revert them.
 */
export default function ReviewView({ language, review, renderMarkdown, onApply, onDiscard, onProgress, onRevert, onClose, onExportWord, onExportReport }) {
  const compare = review.mode === 'compare', readOnly = Boolean(review.readOnly);
  const initial = review.progress || {};
  // Changes outside the user's selection are set aside unless the user asks to see them.
  const [includeOutside, setIncludeOutside] = useState(Boolean(initial.includeOutside));
  const proposed = includeOutside && review.unscoped ? review.unscoped : review.proposed;
  const diff = useMemo(() => diffBlocks(review.base, proposed), [review.base, proposed]);
  const changes = diff.hunks.filter((hunk) => hunk.type === 'change');
  const [decisions, setDecisions] = useState(() => initial.decisions || {});
  const [notes, setNotes] = useState(() => initial.notes || {});
  // Your own wording for a change, used instead of the AI's when you finish.
  const [edits, setEdits] = useState(() => initial.edits || {});
  const [editing, setEditing] = useState(null);
  const [replies, setReplies] = useState(() => initial.replies || {});
  // Word diff first: it shows which words changed. See `inline` below for where it applies.
  const [mode, setMode] = useState('words');
  const [view, setView] = useState(initial.view || 'changes');
  const [expanded, setExpanded] = useState(() => new Set());
  const [focus, setFocus] = useState(0);
  const [pending, setPending] = useState(false);
  const refs = useRef(new Map());
  const decided = changes.filter((hunk) => decisions[hunk.id]).length;
  const reverted = changes.filter((hunk) => decisions[hunk.id] === 'reject').length;
  const blockText = (indexes, blocks) => indexes.map((i) => blocks[i].text).join('');
  const risks = useMemo(() => new Map(changes.map((hunk) => [hunk.id, changeRisks(blockText(hunk.base, diff.baseBlocks), blockText(hunk.next, diff.nextBlocks))])), [diff]);
  const risky = changes.filter((hunk) => risks.get(hunk.id)?.length).length;
  const answers = [...(review.answers || new Map())];
  const questions = [...(review.questions || new Map())];
  const canNote = !compare && ['agent', 'reply'].includes(review.origin);

  useEffect(() => { if (!compare && !readOnly) onProgress?.({ decisions, notes, replies, includeOutside, view, edits }); }, [decisions, notes, replies, includeOutside, view, edits]);

  function decide(id, value) { setPending(false); setDecisions((current) => ({ ...current, [id]: current[id] === value ? undefined : value })); }
  function toggleOutside() { setDecisions({}); setNotes({}); setFocus(0); setIncludeOutside((value) => !value); }
  function decideAll(value) { setPending(false); setDecisions(Object.fromEntries(changes.map((hunk) => [hunk.id, value]))); }
  function finishWith(final) { onApply(Object.keys(edits).length ? composeWithEdits(diff, final, edits) : composeReview(diff, final), final, diff, { notes: Object.fromEntries(Object.entries(notes).filter(([id, text]) => final[id] === 'reject' && text.trim())), replies }); }
  function finish() {
    if (compare) return;
    const undecided = changes.length - decided;
    if (undecided > 0 && !pending) { setPending(true); return; }
    finishWith(decisions);
  }
  function finishRest(value) { const final = { ...Object.fromEntries(changes.map((hunk) => [hunk.id, value])), ...Object.fromEntries(Object.entries(decisions).filter(([, v]) => v)) }; setDecisions(final); finishWith(final); }
  function revert() { if (reverted) onRevert?.(composeReview(diff, decisions)); }

  useEffect(() => { refs.current.get(changes[focus]?.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focus]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, [contenteditable]')) return;
      const hunk = changes[focus];
      if (['ArrowDown', 'j'].includes(event.key)) { event.preventDefault(); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (['ArrowUp', 'k'].includes(event.key)) { event.preventDefault(); setFocus((value) => Math.max(0, value - 1)); }
      else if (event.key === 'a' && hunk && !readOnly) { decide(hunk.id, 'accept'); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (event.key === 'r' && hunk && !readOnly) { decide(hunk.id, 'reject'); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (event.key === 'Escape' && compare) { event.preventDefault(); onClose?.(); }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (compare) revert(); else finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const html = (blocks) => renderMarkdown(blocks.map((block) => block.text).join(''));
  const text = (blocks) => blocks.map((block) => block.text).join('').trim();
  const title = compare ? t(language, 'compareTitle') : review.origin === 'external' ? t(language, 'reviewTitleExternal') : t(language, 'reviewTitle');

  return <section className={`review-view ${view === 'full' ? 'review-full' : ''} ${compare ? 'review-compare' : ''}`} aria-label={title}>
    <header className="review-bar">
      <div className="review-title">
        <strong>{title}</strong>
        <span>{t(language, 'reviewFrom', review.sourceLabel)} · {t(language, 'changeCount', changes.length)}{!compare && <> · {t(language, 'decided', decided, changes.length)}</>}{risky > 0 && <> · <b className="review-risk-count">{t(language, 'riskCount', risky)}</b></>}</span>
      </div>
      <div className="segmented" role="group" aria-label={t(language, 'viewLabel')}>
        <button className={view === 'changes' ? 'selected' : ''} aria-pressed={view === 'changes'} onClick={() => setView('changes')}>{t(language, 'viewChanges')}</button>
        <button className={view === 'full' ? 'selected' : ''} aria-pressed={view === 'full'} onClick={() => setView('full')}>{t(language, 'viewFull')}</button>
      </div>
      <div className="segmented" role="group">
        <button className={mode === 'rendered' ? 'selected' : ''} aria-pressed={mode === 'rendered'} onClick={() => setMode('rendered')}>{t(language, 'showRendered')}</button>
        <button className={mode === 'words' ? 'selected' : ''} aria-pressed={mode === 'words'} onClick={() => setMode('words')}>{t(language, 'showWords')}</button>
      </div>
      {compare ? <>
        {!readOnly && onExportWord && changes.length > 0 && <button className="text-like" onClick={onExportWord} title={t(language, 'exportTrackedHint')}>{t(language, 'exportTracked')}</button>}
        {!readOnly && onExportReport && changes.length > 0 && <button className="text-like" onClick={onExportReport}>{t(language, 'exportReport')}</button>}
        <button onClick={onClose}>{t(language, 'close')}</button>
        {!readOnly && <button className="primary-button" disabled={!reverted} onClick={revert}><Undo2 size={15} />{t(language, 'revertSelected', reverted)} <kbd>{modifierKey()} ↵</kbd></button>}
      </> : <>
        <button onClick={onDiscard}>{t(language, 'discard')}</button>
        <button onClick={() => decideAll('reject')} disabled={!changes.length}>{t(language, 'rejectAll')}</button>
        <button onClick={() => decideAll('accept')} disabled={!changes.length}>{t(language, 'acceptAll')}</button>
        <button className="primary-button" onClick={finish}>{t(language, 'apply')} <kbd>{modifierKey()} ↵</kbd></button>
      </>}
    </header>
    <div className="review-body">
      <div className="review-scroll">
        {pending && <div className="review-pending" role="alert">
          <strong>{t(language, 'pendingPrompt', changes.length - decided)}</strong>
          <button onClick={() => setPending(false)}>{t(language, 'keepReviewing')}</button>
          <button onClick={() => finishRest('reject')}>{t(language, 'restReject')}</button>
          <button className="primary-button" onClick={() => finishRest('accept')}>{t(language, 'restAccept')}</button>
        </div>}
        {compare && <div className="review-scope included"><p>{readOnly ? t(language, 'previewHint') : t(language, 'compareHint')}</p></div>}
        {review.conflicts?.length > 0 && <div className="review-scope warning review-conflicts" role="alert">
          <p>{t(language, 'rebaseTitle', review.conflicts.length)}</p>
          <ul>{review.conflicts.slice(0, 6).map((item, index) => <li key={index}><del>{item.before.trim().slice(0, 80) || '∅'}</del> → <ins>{item.after.trim().slice(0, 80) || '∅'}</ins></li>)}</ul>
        </div>}
        {review.rebased && !review.conflicts?.length && <div className="review-scope included"><p>{t(language, 'rebasedHint')}</p></div>}
        {review.anchorMissing?.length > 0 && <div className="review-scope warning" role="alert"><p>{t(language, 'anchorMissing', review.anchorMissing.map((n) => `#${n}`).join('、'))}</p></div>}
        {review.unscoped && <div className={`review-scope ${includeOutside ? 'included' : ''}`}>
          <div className="review-scope-head"><strong>{includeOutside ? t(language, 'outsideIncluded') : t(language, 'outsideTitle', review.outside?.length || 1)}</strong>
            <button onClick={toggleOutside}>{includeOutside ? t(language, 'outsideHide') : t(language, 'outsideShow')}</button></div>
          {!includeOutside && <><p>{t(language, 'outsideHint')}</p>
          <ul>{(review.outside || []).slice(0, 8).map((item, index) => <li key={index}><del>{item.before.slice(0, 80) || '∅'}</del><span>→</span><ins>{item.after.slice(0, 80) || '∅'}</ins></li>)}</ul></>}
        </div>}
        {!changes.length && <p className="review-empty">{compare ? t(language, 'noDifferences') : t(language, 'noChanges')}</p>}
        {diff.hunks.map((hunk, index) => {
          if (hunk.type === 'equal') {
            if (view === 'full') return <div key={`e${index}`} className="review-equal-full"><div className="document-content review-content" dangerouslySetInnerHTML={{ __html: html(hunk.base.map((i) => diff.baseBlocks[i])) }} /></div>;
            const open = expanded.has(index);
            return <div key={`e${index}`} className="review-equal">
              <button className="review-equal-toggle" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t(language, 'unchangedBlocks', hunk.base.length)}
              </button>
              {open && <div className="document-content review-content" dangerouslySetInnerHTML={{ __html: html(hunk.base.map((i) => diff.baseBlocks[i])) }} />}
            </div>;
          }
          const before = hunk.base.map((i) => diff.baseBlocks[i]), after = hunk.next.map((i) => diff.nextBlocks[i]);
          const decision = decisions[hunk.id];
          const related = tasksForHunk(diff, hunk, review.tasks || []);
          const position = changes.indexOf(hunk);
          const shown = compare ? (decision === 'reject' ? 'reject' : 'accept') : decision || 'pending';
          return <article key={hunk.id} ref={(node) => refs.current.set(hunk.id, node)} className={`review-hunk ${shown} ${position === focus ? 'focused' : ''}`} onClick={() => setFocus(position)}>
            <div className="review-hunk-head">
              <span className="review-hunk-number">{String(position + 1).padStart(2, '0')}</span>
              {related.map((task) => <span key={task.id} className={`mark-chip type-${task.type}`}>#{task.n} {typeLabel(language, task.type)}</span>)}
              {review.checkAsked && related.length === 0 && <span className="review-risk risk-unasked" title={t(language, 'notAskedHint')}>{t(language, 'notAsked')}</span>}
              {(risks.get(hunk.id) || []).map((risk) => <span key={risk.kind} className={`review-risk risk-${risk.kind}`} title={t(language, `riskHint.${risk.kind}`)}>
                {t(language, `risk.${risk.kind}`)}{risk.lost || risk.gained ? <small>{(risk.lost || []).join(' ') || '∅'} → {(risk.gained || []).join(' ') || '∅'}</small> : null}</span>)}
              <span className="spacer" />
              {!readOnly && (compare ? <>
                <button className={`review-choice reject ${decision === 'reject' ? 'selected' : ''}`} aria-pressed={decision === 'reject'} onClick={() => decide(hunk.id, 'reject')}><Undo2 size={14} />{decision === 'reject' ? t(language, 'willRevert') : t(language, 'revertThis')}<kbd>R</kbd></button>
              </> : <>
                <button className={`review-choice reject ${decision === 'reject' ? 'selected' : ''}`} aria-pressed={decision === 'reject'} onClick={() => decide(hunk.id, 'reject')}><X size={14} />{decision === 'reject' ? t(language, 'rejected') : t(language, 'reject')}<kbd>R</kbd></button>
                {after.length > 0 && <button className={`review-choice ${editing === hunk.id ? 'selected' : ''}`} aria-pressed={editing === hunk.id} title={t(language, 'editChangeHint')} onClick={(event) => { event.stopPropagation(); setEditing(editing === hunk.id ? null : hunk.id); }}><PencilLine size={14} />{typeof edits[hunk.id] === 'string' ? t(language, 'edited') : t(language, 'editChange')}</button>}
                <button className={`review-choice accept ${decision === 'accept' ? 'selected' : ''}`} aria-pressed={decision === 'accept'} onClick={() => decide(hunk.id, 'accept')}><Check size={14} />{decision === 'accept' ? t(language, 'accepted') : t(language, 'accept')}<kbd>A</kbd></button>
              </>)}
            </div>
            {editing === hunk.id ? <div className="review-edit" onClick={(event) => event.stopPropagation()}>
              <textarea autoFocus rows={Math.min(14, Math.max(3, (edits[hunk.id] ?? text(after)).split('\n').length + 1))} value={edits[hunk.id] ?? text(after)} aria-label={t(language, 'editChange')}
                onChange={(event) => setEdits((current) => ({ ...current, [hunk.id]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); setEditing(null); setDecisions((current) => ({ ...current, [hunk.id]: 'accept' })); } }} />
              <div className="review-edit-actions"><small>{t(language, 'editChangeHint')}</small>
                {typeof edits[hunk.id] === 'string' && <button onClick={() => setEdits((current) => { const next = { ...current }; delete next[hunk.id]; return next; })}>{t(language, 'useAiVersion')}</button>}
                <button className="primary-button" onClick={() => { setEditing(null); setDecisions((current) => ({ ...current, [hunk.id]: 'accept' })); }}>{t(language, 'acceptEdited')} <kbd>{modifierKey()} ↵</kbd></button></div>
            </div> : mode === 'words' && inline(before) && inline(after) ? <WordDiff before={text(before)} after={typeof edits[hunk.id] === 'string' ? edits[hunk.id].trim() : text(after)} /> : <div className="review-pair">
              {before.length > 0 && <div className="document-content review-content review-before" dangerouslySetInnerHTML={{ __html: html(before) }} />}
              {after.length > 0 && <div className={`document-content review-content review-after ${typeof edits[hunk.id] === 'string' ? 'review-edited' : ''}`} dangerouslySetInnerHTML={{ __html: typeof edits[hunk.id] === 'string' ? renderMarkdown(edits[hunk.id]) : html(after) }} />}
            </div>}
            {canNote && decision === 'reject' && before.length > 0 && <label className="review-note" onClick={(event) => event.stopPropagation()}>
              <input value={notes[hunk.id] || ''} maxLength={2000} placeholder={t(language, 'rejectNote')} aria-label={t(language, 'rejectNote')} onChange={(event) => setNotes((current) => ({ ...current, [hunk.id]: event.target.value }))} />
            </label>}
          </article>;
        })}
      </div>
      {(answers.length > 0 || questions.length > 0) && <aside className="review-answers">
        {questions.length > 0 && <><h3>{t(language, 'questions')}</h3>
        {questions.map(([n, question]) => <div key={`q${n}`} className="review-answer review-question"><span className="mark-chip">#{n}</span><p>{question}</p>
          {!compare && <textarea rows={3} maxLength={4000} value={replies[n] || ''} placeholder={t(language, 'replyPlaceholder')} aria-label={t(language, 'replyPlaceholder')} onChange={(event) => setReplies((current) => ({ ...current, [n]: event.target.value }))} />}
        </div>)}</>}
        {answers.length > 0 && <><h3>{t(language, 'answers')}</h3>
        {answers.map(([n, answer]) => <div key={n} className="review-answer"><span className="mark-chip type-ask">#{n}</span><p>{answer}</p></div>)}</>}
      </aside>}
    </div>
  </section>;
}
