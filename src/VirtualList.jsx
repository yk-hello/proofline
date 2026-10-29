import React, { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export function VirtualList({ items, renderItem, className = '', rowHeight = 36, onScroll, activeKey, focusKey, itemKey }) {
  const ref = useRef(null);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => ref.current,
    estimateSize: () => rowHeight, overscan: 8, useAnimationFrameWithResizeObserver: true });
  useEffect(() => {
    if (!activeKey || !itemKey || ref.current?.contains(document.activeElement)) return;
    const index = items.findIndex((item) => itemKey(item) === activeKey);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [activeKey, items]);
  useEffect(() => {
    if (!focusKey) return;
    const index = items.findIndex((item) => itemKey(item) === focusKey);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    let frame, attempts = 0;
    const focus = () => {
      const target = ref.current?.querySelector(`[data-outline="${CSS.escape(focusKey)}"]`);
      if (target) target.focus({ preventScroll: true });
      else if (attempts++ < 20) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [focusKey, items]);
  return <div className={`virtual-list ${className}`} ref={ref} onScroll={onScroll}>
    <div className="virtual-list-space" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => <div className="virtual-list-row" key={row.key} data-index={row.index}
        ref={virtualizer.measureElement} style={{ transform: `translateY(${row.start}px)` }}>{renderItem(items[row.index], row.index)}</div>)}
    </div>
  </div>;
}
