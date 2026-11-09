import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { typeLabel } from './copy';

const STATUS = {
  zh: { open: '待处理', sent: '已发送', resolved: '已解决', unchanged: '未改动', answered: '已回答', question: 'AI 有疑问' },
  en: { open: 'Open', sent: 'Sent', resolved: 'Resolved', unchanged: 'Unchanged', answered: 'Answered', question: 'AI asked' },
};

/** Document statistics: size, structure, and where the AI instructions stand. */
export default function StatsDialog({ language, stats, name, onClose }) {
  const zh = language !== 'en';
  useEffect(() => { const onKey = (event) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const figure = (value, label) => <div className="stats-figure"><strong>{Number(value || 0).toLocaleString()}</strong><span>{label}</span></div>;
  const instructionTypes = ['fix', 'expand', 'delete', 'ask', 'free'].filter((type) => stats.marks[type]);
  const personalTypes = ['highlight', 'underline', 'note'].filter((type) => stats.marks[type]);
  const instructions = instructionTypes.reduce((sum, type) => sum + stats.marks[type], 0);
  const done = (stats.statuses.resolved || 0) + (stats.statuses.answered || 0);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="stats-dialog" role="dialog" aria-modal="true" aria-label={zh ? '文档统计' : 'Document statistics'}>
      <header><div><span className="stats-kicker">{zh ? '文档统计' : 'Document statistics'}</span><h2>{name}</h2></div>
        <button className="icon-button quiet" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><X size={16} /></button></header>
      <section className="stats-grid primary">
        {figure(stats.words, zh ? '字数' : 'Words')}
        {figure(stats.characters, zh ? '字符（不含空格）' : 'Characters (no spaces)')}
        {figure(stats.minutes, zh ? '分钟阅读' : 'Min read')}
      </section>
      <section className="stats-grid">
        {figure(stats.headings, zh ? '标题' : 'Headings')}
        {figure(stats.paragraphs, zh ? '段落' : 'Paragraphs')}
        {figure(stats.tables, zh ? '表格' : 'Tables')}
        {figure(stats.charts, zh ? '图表' : 'Charts')}
        {figure(stats.images, zh ? '图片' : 'Images')}
        {figure(stats.codeBlocks, zh ? '代码块' : 'Code blocks')}
        {figure(stats.formulas, zh ? '公式' : 'Formulas')}
        {figure(stats.links, zh ? '链接' : 'Links')}
      </section>
      <section className="stats-marks">
        <h3>{zh ? `AI 指令 ${instructions} 条` : `${instructions} AI instructions`}{instructions > 0 && <span>{zh ? `已完成 ${done}` : `${done} done`}</span>}</h3>
        {instructions > 0 && <div className="stats-progress" role="img" aria-label={zh ? `已完成 ${done} / ${instructions}` : `${done} of ${instructions} done`}><span style={{ width: `${Math.round(done / instructions * 100)}%` }} /></div>}
        <dl>
          {instructionTypes.map((type) => <div key={type}><dt><span className={`mark-chip type-${type}`}>{typeLabel(language, type)}</span></dt><dd>{stats.marks[type]}</dd></div>)}
          {Object.entries(stats.statuses).map(([status, count]) => <div key={status}><dt>{(STATUS[zh ? 'zh' : 'en'])[status] || status}</dt><dd>{count}</dd></div>)}
          {personalTypes.map((type) => <div key={type}><dt>{typeLabel(language, type)}</dt><dd>{stats.marks[type]}</dd></div>)}
        </dl>
        {!instructions && !personalTypes.length && <p>{zh ? '还没有标记。' : 'No marks yet.'}</p>}
      </section>
    </div>
  </div>;
}
