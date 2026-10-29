import React, { useEffect, useRef, useState } from 'react';
import { Square, ChevronDown, ChevronUp, X } from 'lucide-react';
import { t } from './copy';

export default function RunPanel({ language, run, onStop, onDismiss, onRetry, onReview, onSettings, onDiagnose }) {
  const [open, setOpen] = useState(run.status === 'failed');
  const active = ['starting', 'running'].includes(run.status), zh = language === 'zh';
  const [now, setNow] = useState(Date.now());
  const log = useRef(null);
  useEffect(() => { if (!active) return undefined; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  useEffect(() => { if (run.status === 'failed') setOpen(true); }, [run.status]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [run.output, open]);
  const seconds = Math.round(((run.finishedAt || now) - run.startedAt) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div className={`run-panel ${run.status}`} role="status" aria-live="polite">
    <div className="run-head">
      {active && <span className="run-pulse" aria-hidden="true" />}
      <strong>{active ? t(language, 'runTitle', run.agent.name) : run.status === 'failed' ? t(language, 'runFailed') : run.status === 'cancelled' ? (zh ? '任务已停止' : 'Task stopped') : t(language, 'runDone')}</strong>
      <span className="run-time">{elapsed}</span>
      <button className="icon-button quiet" onClick={() => setOpen((value) => !value)} aria-label={t(language, 'runOutput')} title={t(language, 'runOutput')}>{open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
      {active ? <button className="run-stop" disabled={!run.id} onClick={onStop}><Square size={12} />{t(language, 'stop')}</button>
        : <button className="icon-button quiet" onClick={onDismiss} aria-label={t(language, 'close')}><X size={15} /></button>}
    </div>
    {active && <p className="run-activity">{run.status === 'starting' ? (zh ? '正在检查登录与启动环境…' : 'Checking sign-in and environment…') : run.phase === 'waiting' ? (zh ? '进程仍在运行，超过 60 秒没有新输出；可继续等待或停止。' : 'Process alive; no output for over 60 seconds. Wait or stop.') : (zh ? '进程运行中 · 每 3 秒检查状态' : 'Process running · checked every 3 seconds')}{run.pid ? ' · PID ' + run.pid : ''}</p>}
    {run.diagnostic && <p role="alert" className="run-diagnostic">{run.diagnostic.message}</p>}
    {run.storageError && <p role="alert" className="settings-error">{run.storageError}</p>}
    {!active && <div className="run-actions"><button onClick={onRetry}>{t(language, 'resend')}</button>{typeof run.proposed === 'string' && <button onClick={onReview}>{zh ? '审阅已有结果' : 'Review available result'}</button>}<button onClick={onSettings}>{zh ? '检查连接与设置' : 'Connection settings'}</button><button onClick={onDiagnose}>{zh ? '生成 CLI 诊断任务' : 'Create CLI diagnosis task'}</button></div>}
    {open && <pre ref={log} className="run-log">{run.output || t(language, 'noOutput')}{run.code !== undefined && run.code !== null ? `\n${t(language, 'exitCode', run.code)}` : ''}</pre>}
  </div>;
}
