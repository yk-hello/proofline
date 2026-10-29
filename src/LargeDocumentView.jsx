import React, { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import EditableMarkdown from './EditableMarkdown';
import { textMatches } from './search';
import { sourceForChunk } from './document-model';

const Chunk = memo(function Chunk({ source, definitions, chunk, query, searchOptions, searchOffset, renderMarkdown, onClick, editable, drafts, onInput, onBeforeInput, sourceMode }) {
  const plain = sourceMode || chunk.plain;
  const html = useMemo(() => plain ? '' : renderMarkdown(sourceForChunk(source, chunk, { referenceDefinitions: definitions }), query, searchOffset, chunk.headingStart, chunk),
    [source, definitions, chunk, query, searchOffset, renderMarkdown, plain]);
  const draft = drafts?.current.get(chunk.start);
  const plainSource = draft?.source ?? source.slice(chunk.start, chunk.end);
  const plainHtml = useMemo(() => {
    const container = document.createElement('pre');
    if (!plain || !query) { container.textContent = plainSource; return container.innerHTML; }
    let start = 0, index = searchOffset;
    for (const { index: match, text, length } of textMatches(plainSource, query, searchOptions)) {
      container.append(document.createTextNode(plainSource.slice(start, match)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.dataset.searchIndex = index++;
      mark.textContent = text;
      container.append(mark);
      start = match + length;
    }
    container.append(document.createTextNode(plainSource.slice(start)));
    return container.innerHTML;
  }, [plain, sourceMode, plainSource, query, searchOptions, searchOffset]);
  return <EditableMarkdown plain={plain} html={plain ? plainHtml : draft?.html ?? html}
    className={sourceMode ? 'large-plain-block source-plain-block' : chunk.plain ? 'large-plain-block' : undefined} region={String(chunk.start)} editable={editable}
    onBeforeInput={onBeforeInput} onInput={(event) => onInput?.(chunk, event.currentTarget, plain)} onClick={onClick} />;
});

export default function LargeDocumentView({ markdown, model, query, searchOptions, activeIndex, results, headingTarget,
  articleRef, scrollContainerRef, navigationRef, renderMarkdown, onArticleClick, reference = false, editable = false, drafts, onInput, onBeforeInput, searchNavigation, sourceMode = false }) {
  const ref = useRef(null);
  const [margin, setMargin] = useState(0);
  const cancelNavigationRef = useRef(() => {});
  const virtualizer = useVirtualizer({ count: model.chunks.length, getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => sourceMode ? Math.max(100, markdown.slice(model.chunks[index].start, model.chunks[index].end).split('\n').length * 24) : model.chunks[index].height || 2000, overscan: 1, scrollMargin: margin,
    getItemKey: (index) => model.chunks[index].start, useAnimationFrameWithResizeObserver: true });
  useLayoutEffect(() => {
    const region = scrollContainerRef.current;
    if (!region || !ref.current) return;
    const update = () => setMargin(ref.current.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop);
    update();
    let frame;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); });
    observer.observe(region);
    const header = ref.current.previousElementSibling;
    if (header) observer.observe(header);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [scrollContainerRef, markdown]);
  const offsets = useMemo(() => {
    const counts = new Map();
    for (const result of results) if (!counts.has(result.chunk)) counts.set(result.chunk, result.index);
    return counts;
  }, [results]);

  function navigateTo(target) {
    cancelNavigationRef.current();
    let frame, stable = 0, attempts = 0;
    const deadline = performance.now() + 4000;
    const jump = () => {
      const offset = virtualizer.getOffsetForIndex(target.chunk, 'start')?.[0];
      if (offset !== undefined) virtualizer.scrollToOffset(offset, { behavior: 'auto' });
    };
    // Keep the exact-node adjustment separate from the virtualizer's index
    // reconciliation, which otherwise pulls the view back to the chunk start.
    jump();
    const settle = () => {
      const region = scrollContainerRef.current;
      const element = ref.current?.querySelector(target.selector);
      if (!region || performance.now() >= deadline) return;
      if (element) {
        if (target.search) {
          ref.current.querySelectorAll('.active-search-hit').forEach((node) => node.classList.remove('active-search-hit'));
          element.classList.add('active-search-hit');
        }
        let box = element.getBoundingClientRect();
        if (target.rawOffset !== undefined) {
          const raw = element.querySelector('[data-edit-region]');
          const walker = document.createTreeWalker(raw, NodeFilter.SHOW_TEXT);
          let node, remaining = target.rawOffset;
          while ((node = walker.nextNode())) {
            if (remaining <= node.textContent.length) {
              const range = document.createRange(); range.setStart(node, remaining); range.setEnd(node, Math.min(node.textContent.length, remaining + 1));
              box = range.getBoundingClientRect(); break;
            }
            remaining -= node.textContent.length;
          }
        }
        const viewport = region.getBoundingClientRect();
        const offset = target.offset !== undefined ? -target.offset : target.search ? Math.max(0, (region.clientHeight - box.height) / 2) : 12;
        const delta = box.top - viewport.top - offset;
        if (Math.abs(delta) > 2) {
          const before = region.scrollTop;
          virtualizer.scrollToOffset(region.scrollTop + delta, { behavior: 'auto' });
          // At the start/end of a document, a visible target cannot be centered.
          stable = Math.abs(region.scrollTop - before) < 1 ? stable + 1 : 0;
        } else stable += 1;
        if (stable >= 4) return;
      } else if (attempts++ % 4 === 0) {
        jump();
      }
      frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    const cancel = () => cancelAnimationFrame(frame);
    cancelNavigationRef.current = cancel;
    return cancel;
  }

  useImperativeHandle(navigationRef, () => ({
    cancel() { cancelNavigationRef.current(); },
    goToSource(offset) {
      const chunk = model.chunks.findIndex((item) => item.start <= offset && item.end > offset);
      if (chunk >= 0) navigateTo({ chunk, selector: `[data-chunk="${chunk}"]`, ...(sourceMode ? { rawOffset: offset - model.chunks[chunk].start } : {}) });
    },
    scrollTo(position) {
      cancelNavigationRef.current();
      virtualizer.scrollToOffset(position === 'end' ? scrollContainerRef.current.scrollHeight : Math.max(0, Number(position) || 0));
    },
    getPosition() {
      const region = scrollContainerRef.current;
      const row = virtualizer.getVirtualItemForOffset(region.scrollTop);
      const node = row && ref.current?.querySelector(`[data-chunk="${row.index}"]`);
      if (sourceMode && node) {
        const box = region.getBoundingClientRect(), pre = node.querySelector('pre');
        const point = document.caretRangeFromPoint?.(pre.getBoundingClientRect().left + 3, box.top + 18);
        const before = document.createRange();
        let sourceOffset = model.chunks[row.index].start;
        if (point && pre.contains(point.startContainer)) { before.selectNodeContents(pre); before.setEnd(point.startContainer, point.startOffset); sourceOffset += before.toString().length; }
        return { top: region.scrollTop, sourceStart: model.chunks[row.index].start, sourceOffset, offset: box.top - node.getBoundingClientRect().top };
      }
      return node ? { top: region.scrollTop, sourceStart: model.chunks[row.index].start,
        offset: region.getBoundingClientRect().top - node.getBoundingClientRect().top } : region.scrollTop;
    },
    restore(position) {
      if (sourceMode && typeof position === 'object' && Number.isFinite(position.sourceOffset ?? position.anchor?.sourceOffset)) {
        this.goToSource(position.sourceOffset ?? position.anchor.sourceOffset); return;
      }
      const chunk = typeof position === 'object' ? model.chunks.findIndex((item) => item.start === position.sourceStart) : -1;
      if (chunk >= 0) navigateTo({ chunk, selector: `[data-chunk="${chunk}"]`, offset: position.offset });
      else this.scrollTo(position?.top ?? position);
    },
  }));

  useEffect(() => {
    const region = scrollContainerRef.current;
    const cancel = () => {
      cancelNavigationRef.current();
      virtualizer.scrollToOffset(region.scrollTop);
    };
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) region?.addEventListener(event, cancel, { passive: true });
    return () => {
      cancelNavigationRef.current();
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) region?.removeEventListener(event, cancel);
    };
  }, []);

  useEffect(() => {
    const hit = query ? results[activeIndex] : null;
    const target = hit ? { chunk: hit.chunk, selector: `[data-search-index="${activeIndex}"]`, search: true } : null;
    if (!target) return;
    return navigateTo(target);
  }, [activeIndex, results, query, markdown, searchNavigation]);

  useEffect(() => {
    if (headingTarget?.source !== markdown) return;
    const item = headingTarget.item;
    if (sourceMode) return navigateTo({ chunk: item.chunk, selector: `[data-chunk="${item.chunk}"]`, rawOffset: item.offset - model.chunks[item.chunk].start });
    return navigateTo({ chunk: item.chunk, selector: `[data-heading="${item.slug}"]` });
  }, [headingTarget, markdown]);

  return <div ref={(node) => { ref.current = node; if (articleRef) articleRef.current = node; }}
    className={`large-document-viewport document-content ${reference ? 'reference-content' : ''} ${sourceMode ? 'source-document' : ''}`}>
    <div className="large-document-space" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => <div className="large-document-chunk" key={row.key}
        ref={virtualizer.measureElement} data-index={row.index} data-chunk={row.index}
        style={{ transform: `translateY(${row.start - margin}px)` }}>
        <Chunk source={markdown} definitions={model.referenceDefinitions} chunk={model.chunks[row.index]} query={query} searchOptions={searchOptions} searchOffset={offsets.get(row.index) || 0}
          renderMarkdown={renderMarkdown} onClick={onArticleClick} editable={editable} drafts={drafts} onInput={onInput} onBeforeInput={onBeforeInput} sourceMode={sourceMode} />
      </div>)}
    </div>
  </div>;
}
