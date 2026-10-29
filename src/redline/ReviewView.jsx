import React, { useEffect, useMemo, useRef, useState } from 'react';
import { diffArrays } from 'diff';
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { diffBlocks, composeReview, tasksForHunk } from '../../electron/redline-core.mjs';
import { t, typeLabel, modifierKey } from './copy';

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
function tokens(text) {
  if (!segmenter) return text.split(/(\s+)/);
  return [...segmenter.segment(text)].map((item) => item.segment);
}

function WordDiff({ before, after }) {
  const parts = useMemo(() => diffArrays(tokens(before), tokens(after)), [before, after]);
  return <pre className="word-diff">{parts.map((part, index) => <span key={index} className={part.added ? 'ins' : part.removed ? 'del' : ''}>{part.value.join('')}</span>)}</pre>;
}

/** Full-surface review of AI changes, block by block. Nothing is written until Finish. */
export default function ReviewView({ language, review, renderMarkdown, onApply, onDiscard }) {
  const diff = useMemo(() => diffBlocks(review.base, review.proposed), [review.base, review.proposed]);
  const changes = diff.hunks.filter((hunk) => hunk.type === 'change');
  const [decisions, setDecisions] = useState({});
  const [mode, setMode] = useState('rendered');
  const [expanded, setExpanded] = useState(() => new Set());
  const [focus, setFocus] = useState(0);
  const refs = useRef(new Map());
  const decided = changes.filter((hunk) => decisions[hunk.id]).length;
  const answers = [...(review.answers || new Map())];
  const questions = [...(review.questions || new Map())];

  function decide(id, value) { setDecisions((current) => ({ ...current, [id]: current[id] === value ? undefined : value })); }
  function decideAll(value) { setDecisions(Object.fromEntries(changes.map((hunk) => [hunk.id, value]))); }
  function finish() { onApply(composeReview(diff, decisions), decisions, diff); }

  useEffect(() => { refs.current.get(changes[focus]?.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focus]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea')) return;
      const hunk = changes[focus];
      if (['ArrowDown', 'j'].includes(event.key)) { event.preventDefault(); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (['ArrowUp', 'k'].includes(event.key)) { event.preventDefault(); setFocus((value) => Math.max(0, value - 1)); }
      else if (event.key === 'a' && hunk) { decide(hunk.id, 'accept'); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (event.key === 'r' && hunk) { decide(hunk.id, 'reject'); setFocus((value) => Math.min(changes.length - 1, value + 1)); }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const html = (blocks) => renderMarkdown(blocks.map((block) => block.text).join(''));
  const text = (blocks) => blocks.map((block) => block.text).join('').trim();

  return <section className="review-view" aria-label={t(language, 'reviewTitle')}>
    <header className="review-bar">
      <div className="review-title">
        <strong>{t(language, 'reviewTitle')}</strong>
        <span>{t(language, 'reviewFrom', review.sourceLabel)} · {t(language, 'changeCount', changes.length)} · {t(language, 'decided', decided, changes.length)}</span>
      </div>
      <div className="segmented" role="group">
        <button className={mode === 'rendered' ? 'selected' : ''} aria-pressed={mode === 'rendered'} onClick={() => setMode('rendered')}>{t(language, 'showRendered')}</button>
        <button className={mode === 'words' ? 'selected' : ''} aria-pressed={mode === 'words'} onClick={() => setMode('words')}>{t(language, 'showWords')}</button>
      </div>
      <button onClick={onDiscard}>{t(language, 'discard')}</button>
      <button onClick={() => decideAll('reject')} disabled={!changes.length}>{t(language, 'rejectAll')}</button>
      <button onClick={() => decideAll('accept')} disabled={!changes.length}>{t(language, 'acceptAll')}</button>
      <button className="primary-button" onClick={finish}>{t(language, 'apply')} <kbd>{modifierKey()} ↵</kbd></button>
    </header>
    <div className="review-body">
      <div className="review-scroll">
        {!changes.length && <p className="review-empty">{t(language, 'noChanges')}</p>}
        {diff.hunks.map((hunk, index) => {
          if (hunk.type === 'equal') {
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
          return <article key={hunk.id} ref={(node) => refs.current.set(hunk.id, node)} className={`review-hunk ${decision || 'pending'} ${position === focus ? 'focused' : ''}`} onClick={() => setFocus(position)}>
            <div className="review-hunk-head">
              <span className="review-hunk-number">{String(position + 1).padStart(2, '0')}</span>
              {related.map((task) => <span key={task.id} className={`mark-chip type-${task.type}`}>#{task.n} {typeLabel(language, task.type)}</span>)}
              <span className="spacer" />
              <button className={`review-choice reject ${decision === 'reject' ? 'selected' : ''}`} aria-pressed={decision === 'reject'} onClick={() => decide(hunk.id, 'reject')}><X size={14} />{decision === 'reject' ? t(language, 'rejected') : t(language, 'reject')}<kbd>R</kbd></button>
              <button className={`review-choice accept ${decision === 'accept' ? 'selected' : ''}`} aria-pressed={decision === 'accept'} onClick={() => decide(hunk.id, 'accept')}><Check size={14} />{decision === 'accept' ? t(language, 'accepted') : t(language, 'accept')}<kbd>A</kbd></button>
            </div>
            {mode === 'words' ? <WordDiff before={text(before)} after={text(after)} /> : <div className="review-pair">
              {before.length > 0 && <div className="document-content review-content review-before" dangerouslySetInnerHTML={{ __html: html(before) }} />}
              {after.length > 0 && <div className="document-content review-content review-after" dangerouslySetInnerHTML={{ __html: html(after) }} />}
            </div>}
          </article>;
        })}
      </div>
      {(answers.length > 0 || questions.length > 0) && <aside className="review-answers">
        {questions.length > 0 && <><h3>{t(language, 'questions')}</h3>
        {questions.map(([n, question]) => <div key={`q${n}`} className="review-answer review-question"><span className="mark-chip">#{n}</span><p>{question}</p></div>)}</>}
        {answers.length > 0 && <><h3>{t(language, 'answers')}</h3>
        {answers.map(([n, answer]) => <div key={n} className="review-answer"><span className="mark-chip type-ask">#{n}</span><p>{answer}</p></div>)}</>}
      </aside>}
    </div>
  </section>;
}
