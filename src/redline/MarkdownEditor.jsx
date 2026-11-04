import React, { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { callCommand, insert } from '@milkdown/kit/utils';
import { commandsCtx } from '@milkdown/kit/core';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { chartMarkdown } from '../charts';
import { statsTableMarkdown } from '../table-tools';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import katex from 'katex';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { diffBlocks, splitBlocks } from '../../electron/redline-core.mjs';

const LABELS = {
  zh: { placeholder: '输入正文，或输入 / 插入标题、列表、表格、公式…', text: '正文', h: (n) => `标题 ${n}`, quote: '引用', divider: '分隔线', textGroup: '文字',
    listGroup: '列表', bullet: '无序列表', ordered: '有序列表', task: '任务清单', advanced: '插入', image: '图片', code: '代码块', table: '表格', math: '公式',
    upload: '上传', confirm: '确定', imageUrl: '粘贴图片链接', caption: '图片说明', copy: '复制', search: '搜索语言', noResult: '没有找到', preview: '预览',
    chartGroup: '图表与统计', charts: { bar: '柱状图', stacked: '堆叠柱状图', hbar: '条形图', line: '折线图', area: '面积图', pie: '饼图', doughnut: '环形图', radar: '雷达图', scatter: '散点图' }, stats: '统计表（带合计）' },
  en: { placeholder: 'Type, or press / for headings, lists, tables, math…', text: 'Text', h: (n) => `Heading ${n}`, quote: 'Quote', divider: 'Divider', textGroup: 'Text',
    listGroup: 'Lists', bullet: 'Bullet list', ordered: 'Numbered list', task: 'Task list', advanced: 'Insert', image: 'Image', code: 'Code block', table: 'Table', math: 'Math',
    upload: 'Upload', confirm: 'Confirm', imageUrl: 'Paste image link', caption: 'Caption', copy: 'Copy', search: 'Search language', noResult: 'No result', preview: 'Preview',
    chartGroup: 'Charts & statistics', charts: { bar: 'Bar chart', stacked: 'Stacked bar', hbar: 'Horizontal bar', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', doughnut: 'Doughnut chart', radar: 'Radar chart', scatter: 'Scatter plot' }, stats: 'Statistics table (with totals)' },
};

/**
 * Keep the user's original Markdown for every block they did not touch. The editor
 * re-serializes the whole document, so without this a one-word edit would reformat
 * lists, emphasis markers and spacing everywhere and pollute AI diffs and git history.
 */
// The editor writes a blank line between a chart directive and its table; keep them
// together so block counts match the original and untouched blocks stay byte-for-byte.
export const tidyEditorMarkdown = (markdown) => markdown.replace(/(<!--\s*proofline:chart\b[^>]*-->)[ \t]*\n(?:[ \t]*\n)+(?=[ \t]{0,3}\|)/g, '$1\n');

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

const icon = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const CHART_ICONS = {
  bar: icon('<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>'), stacked: icon('<path d="M4 20h16"/><rect x="6" y="9" width="4" height="8"/><rect x="14" y="5" width="4" height="12"/><path d="M6 13h4M14 11h4"/>'),
  hbar: icon('<path d="M4 4v16"/><path d="M8 7h9M8 12h12M8 17h6"/>'), line: icon('<path d="M4 20h16"/><path d="M5 15l4-5 4 3 6-7"/>'), area: icon('<path d="M4 20h16"/><path d="M5 17l4-6 4 3 6-7v10z"/>'),
  pie: icon('<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'), doughnut: icon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4v4.5"/>'),
  radar: icon('<path d="M12 3l8 6-3 10H7L4 9z"/><path d="M12 8l4 3-1.5 4.5h-5L8 11z"/>'), scatter: icon('<path d="M4 20h16M4 4v16"/><circle cx="9" cy="14" r="1.2"/><circle cx="13" cy="10" r="1.2"/><circle cx="17" cy="7" r="1.2"/><circle cx="15" cy="14" r="1.2"/>'),
  table: icon('<rect x="4" y="5" width="16" height="14"/><path d="M4 10h16M4 15h16M10 5v14"/>'),
};

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
    const markdown = tidyEditorMarkdown(crepe.getMarkdown());
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
          // Charts are Markdown tables with a directive line, so they stay editable as tables.
          buildMenu: (builder) => {
            const group = builder.addGroup('proofline-charts', copy.chartGroup);
            const run = (markdown) => (ctx) => { ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key); insert(`${markdown}\n\n`)(ctx); };
            for (const [type, label] of Object.entries(copy.charts)) group.addItem(`chart-${type}`, { label, icon: CHART_ICONS[type] || CHART_ICONS.bar, onRun: run(chartMarkdown(type, language)) });
            group.addItem('stats-table', { label: copy.stats, icon: CHART_ICONS.table, onRun: run(statsTableMarkdown(language)) });
          },
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
      baseline.current = { original: value, normalized: tidyEditorMarkdown(crepe.getMarkdown()) };
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
