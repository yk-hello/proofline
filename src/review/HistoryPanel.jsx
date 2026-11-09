import React, { useEffect, useState } from 'react';
import { recoveryVersions } from '../document-recovery';

/** Saved versions of the current document as a timeline in the sidebar: compare or restore any of them. */
export default function HistoryPanel({ language, documentKey, refresh, reasonLabel, onCompare, onRestore }) {
  const zh = language === 'zh';
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    // Versions are written just after a save; read a moment later so the newest one is there.
    const timer = window.setTimeout(() => {
      recoveryVersions(documentKey).then((value) => { if (alive) { setRecord(value); setError(''); } }).catch((reason) => { if (alive) setError(reason.message || String(reason)); });
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [documentKey, refresh]);

  if (error) return <div className="history-panel"><p className="empty-state">{zh ? '版本存储不可用：' : 'Version storage unavailable: '}{error}</p></div>;
  if (!record) return <div className="history-panel"><p className="empty-state">{zh ? '正在读取…' : 'Loading…'}</p></div>;
  const days = new Map();
  for (const version of record.versions) {
    const day = new Date(version.at).toLocaleDateString();
    days.set(day, [...(days.get(day) || []), version]);
  }
  return <div className="history-panel">
    <p className="history-hint">{zh ? '每次保存、AI 写回和外部修改都会留一个版本。「对比」看和现在的差别，可以只改回其中几处。' : 'Saves, AI write-backs and outside changes each keep a version. Compare shows the difference from now; put back just the parts you want.'}</p>
    {!record.versions.length && <p className="empty-state">{zh ? '这篇文档还没有保存过的版本' : 'No saved versions yet'}</p>}
    {[...days.entries()].map(([day, versions]) => <section key={day} className="history-day">
      <h4>{day}</h4>
      {versions.map((version, index) => <div key={version.id} className={`history-entry reason-${version.reason}`}>
        <span className="history-dot" aria-hidden="true" />
        <div className="history-text">
          <strong>{new Date(version.at).toLocaleTimeString()}</strong>
          <small>{reasonLabel(version.reason)} · {version.length.toLocaleString()} {zh ? '字符' : 'chars'}{index === 0 && day === [...days.keys()][0] ? (zh ? ' · 最新' : ' · latest') : ''}</small>
        </div>
        <div className="history-actions">
          <button onClick={() => onCompare(version.id)}>{zh ? '对比' : 'Compare'}</button>
          <button onClick={() => onRestore(version.id)}>{zh ? '恢复' : 'Restore'}</button>
        </div>
      </div>)}
    </section>)}
  </div>;
}
