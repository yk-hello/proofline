import React, { useLayoutEffect, useRef } from 'react';

export default function EditableMarkdown({ html, text, plain = false, region = 'article', editable, className,
  elementRef, onBeforeInput, onInput, onClick }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (plain && text !== undefined) {
      if (node.textContent !== text) node.textContent = text;
    } else if (node.innerHTML !== html) node.innerHTML = html || '';
  }, [html, text, plain]);
  const Tag = plain ? 'pre' : 'div';
  return <Tag ref={(node) => { ref.current = node; if (elementRef) elementRef.current = node; }}
    className={className} data-edit-region={region} contentEditable={editable ? (plain ? 'plaintext-only' : true) : false} suppressContentEditableWarning spellCheck={false}
    onBeforeInput={onBeforeInput} onInput={onInput} onClick={onClick} />;
}
