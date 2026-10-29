import React, { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { callCommand, insert } from '@milkdown/kit/utils';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import katex from 'katex';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { diffBlocks, splitBlocks } from '../../electron/redline-core.mjs';

const LABELS = {
  zh: { placeholder: '输入正文，或输入 / 插入标题、列表、表格、公式…', text: '正文', h: (n) => `标题 ${n}`, quote: '引用', divider: '分隔线', textGroup: '文字',
    listGroup: '列表', bullet: '无序列表', ordered: '有序列表', task: '任务清单', advanced: '插入', image: '图片', code: '代码块', table: '表格', math: '公式',
    upload: '上传', confirm: '确定', imageUrl: '粘贴图片链接', caption: '图片说明', copy: '复制', search: '搜索语言', noResult: '没有找到', preview: '预览' },
  en: { placeholder: 'Type, or press / for headings, lists, tables, math…', text: 'Text', h: (n) => `Heading ${n}`, quote: 'Quote', divider: 'Divider', textGroup: 'Text',
    listGroup: 'Lists', bullet: 'Bullet list', ordered: 'Numbered list', task: 'Task list', advanced: 'Insert', image: 'Image', code: 'Code block', table: 'Table', math: 'Math',
    upload: 'Upload', confirm: 'Confirm', imageUrl: 'Paste image link', caption: 'Caption', copy: 'Copy', search: 'Search language', noResult: 'No result', preview: 'Preview' },
};

/**
 * Keep the user's original Markdown for every block they did not touch. The editor
 * re-serializes the whole document, so without this a one-word edit would reformat
 * lists, emphasis markers and spacing everywhere and pollute AI diffs and git history.
 */
export function preserveUntouched(original, normalized, edited) {
  const raw = splitBlocks(original), norm = splitBlocks(normalized);
  if (raw.length !== norm.length) return edited;
  const diff = diffBlocks(normalized, edited);
  let output = '';
  for (const hunk of diff.hunks) {
    if (hunk.type === 'equal') output += hunk.base.map((index) => raw[index].text).join('');
    else output += hunk.next.map((index) => diff.nextBlocks[index].text).join('');
  }
  // Keep a trailing newline when the original had one.
  if (original.endsWith('\n') && !output.endsWith('\n')) output += '\n';
  return output;
}

const MarkdownEditor = forwardRef(function MarkdownEditor({ value, language = 'zh', onChange, resolveImage, onUpload, onError, className }, ref) {
  const host = useRef(null);
  const crepeRef = useRef(null);
  const baseline = useRef({ original: value, normalized: null });
  const timer = useRef(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useImperativeHandle(ref, () => ({
    undo: () => crepeRef.current?.editor.action(callCommand(undoCommand.key)),
    redo: () => crepeRef.current?.editor.action(callCommand(redoCommand.key)),
    flush: () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; emit(); } },
    focus: () => host.current?.querySelector('.ProseMirror')?.focus(),
  }));

  function emit() {
    const crepe = crepeRef.current;
    if (!crepe || baseline.current.normalized === null) return;
    const markdown = crepe.getMarkdown();
    latest.current?.(preserveUntouched(baseline.current.original, baseline.current.normalized, markdown));
  }

  useEffect(() => {
    const copy = LABELS[language] || LABELS.zh;
    let disposed = false;
    const crepe = new Crepe({
      root: host.current,
      defaultValue: value,
      features: { [Crepe.Feature.TopBar]: true, [Crepe.Feature.AI]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: copy.placeholder, mode: 'block' },
        [Crepe.Feature.TopBar]: { headingOptions: [{ label: copy.text, level: null }, ...[1, 2, 3, 4].map((level) => ({ label: copy.h(level), level }))] },
        [Crepe.Feature.BlockEdit]: {
          textGroup: { label: copy.textGroup, text: { label: copy.text }, h1: { label: copy.h(1) }, h2: { label: copy.h(2) }, h3: { label: copy.h(3) },
            h4: { label: copy.h(4) }, h5: { label: copy.h(5) }, h6: { label: copy.h(6) }, quote: { label: copy.quote }, divider: { label: copy.divider } },
          listGroup: { label: copy.listGroup, bulletList: { label: copy.bullet }, orderedList: { label: copy.ordered }, taskList: { label: copy.task } },
          advancedGroup: { label: copy.advanced, image: { label: copy.image }, codeBlock: { label: copy.code }, table: { label: copy.table }, math: { label: copy.math } },
        },
        [Crepe.Feature.ImageBlock]: {
          maxHeight: Math.max(240, Math.round(window.innerHeight * .6)),
          onUpload: async (file) => {
            try { return await onUpload(file); } catch (error) { onError?.(error.message); throw error; }
          },
          proxyDomURL: (url) => (resolveImage && url && !/^(?:[a-z]+:|\/|data:)/i.test(url) ? resolveImage(url) || url : url),
          blockUploadButton: copy.upload, blockConfirmButton: copy.confirm, blockUploadPlaceholderText: copy.imageUrl, blockCaptionPlaceholderText: copy.caption,
          inlineUploadButton: copy.upload, inlineConfirmButton: copy.confirm, inlineUploadPlaceholderText: copy.imageUrl,
        },
        [Crepe.Feature.CodeMirror]: {
          copyText: copy.copy, searchPlaceholder: copy.search, noResultText: copy.noResult, previewLabel: copy.preview,
          renderPreview: (lang, content, apply) => {
            if (lang === 'mermaid' && content.trim()) {
              import('../mermaid-renderer').then(({ renderMermaidSvg }) => renderMermaidSvg(content)).then((svg) => apply(svg)).catch(() => apply(null));
              return undefined;
            }
            if (['math', 'latex', 'tex'].includes(lang) && content.trim()) return katex.renderToString(content, { displayMode: true, throwOnError: false });
            return null;
          },
        },
      },
    });
    crepe.on((listener) => {
      listener.markdownUpdated(() => {
        if (baseline.current.normalized === null) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; emit(); }, 250);
      });
    });
    crepe.create().then(() => {
      if (disposed) return;
      crepeRef.current = crepe;
      baseline.current = { original: value, normalized: crepe.getMarkdown() };
    });
    const pasteImage = (event) => {
      const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
      if (!files.length || !onUpload) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void (async () => {
        for (const file of files) { const source = await onUpload(file); if (!disposed) crepe.editor.action(insert('![](' + source + ')\n\n')); }
      })().catch((error) => onError?.(error.message));
    };
    host.current.addEventListener('paste', pasteImage, true);
    return () => {
      disposed = true;
      host.current?.removeEventListener('paste', pasteImage, true);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; emit(); }
      crepeRef.current = null;
      void crepe.destroy();
    };
    // The editor is recreated by its parent (via `key`) when the source changes from outside.
  }, []);

  return <div ref={host} className={`markdown-editor ${className || ''}`} spellCheck={false} />;
});

export default MarkdownEditor;
