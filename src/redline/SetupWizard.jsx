import React, { useEffect, useState } from 'react';
import { X, Check, RefreshCw, FileText, Pin, Bot } from 'lucide-react';

const COPY = {
  zh: {
    title: '开始使用 Proofline', subtitle: '两步设好，以后可以在「更多 → 默认应用与 AI」里再看。',
    defaultTitle: '设为默认应用', defaultBody: '双击 Markdown 和文本文件时直接用 Proofline 打开。Windows 需要你在系统设置里点一下确认。',
    defaultButton: '打开系统设置', defaultDone: '已是默认应用', recheck: '重新检测',
    pinTitle: '固定到任务栏', pinBody: 'Windows 11 不允许程序自己固定。在任务栏的 Proofline 图标上点右键，选「固定到任务栏」。', pinDone: '已固定',
    aiTitle: '本机 AI', aiBody: '下面列出能启动的命令行工具；登录与服务连接还需分别检查。其他 AI 或设备可用「其他 AI / 其他设备」导出任务文件夹，改好后再导入。',
    checking: '正在检测…', none: '没有检测到能直接运行的命令行 AI。安装 Claude Code、Codex CLI、Gemini CLI 等以后点右上角重新检测。',
    done: '完成',
  },
  en: {
    title: 'Set up Proofline', subtitle: 'Two steps. See them again later under More → Default app and AI.',
    defaultTitle: 'Make Proofline the default app', defaultBody: 'Open Markdown and text files in Proofline with a double-click. Windows asks you to confirm in Settings.',
    defaultButton: 'Open Settings', defaultDone: 'Proofline is the default', recheck: 'Check again',
    pinTitle: 'Pin to taskbar', pinBody: 'Windows 11 does not let apps pin themselves. Right-click the Proofline icon on the taskbar and choose Pin to taskbar.', pinDone: 'Pinned',
    aiTitle: 'AI on this computer', aiBody: 'These CLI programs can start. Check sign-in and service connection separately. Other AI / device exports a task folder and imports the result.',
    checking: 'Checking…', none: 'No command-line AI that runs here was found. Install Claude Code, Codex CLI, Gemini CLI and others, then check again.',
    done: 'Done',
  },
};

export default function SetupWizard({ language, onClose, platform }) {
  const copy = COPY[language] || COPY.zh;
  const system = window.mengxDesktop?.system, agents = window.mengxDesktop?.agents;
  const [defaults, setDefaults] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [cli, setCli] = useState(null);

  async function refresh(force = false) {
    if (!system) return;
    if (force) setCli(null);
    const [nextDefaults, nextPinned, detected] = await Promise.all([
      system.defaultStatus().catch(() => null), system.pinnedStatus().catch(() => null), agents.detect({}, force).catch(() => []),
    ]);
    setDefaults(nextDefaults); setPinned(nextPinned);
    setCli(detected.filter((item) => item.kind === 'cli' && item.available));
  }
  useEffect(() => {
    void refresh();
    const again = () => void refresh();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <header className="dialog-head">
        <div><h2 id="setup-title">{copy.title}</h2><p>{copy.subtitle}</p></div>
        <div className="dialog-head-actions">
          <button className="icon-button quiet" onClick={() => void refresh(true)} aria-label={copy.recheck} title={copy.recheck}><RefreshCw size={16} /></button>
          <button className="icon-button quiet" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
      </header>
      <div className="setup-body">
        {platform === 'win32' && <section className={`setup-step ${defaults?.all ? 'done' : ''}`}>
          <span className="setup-step-icon"><FileText size={18} /></span>
          <div className="setup-step-copy">
            <h3>{copy.defaultTitle}</h3>
            <p>{copy.defaultBody}</p>
            {defaults?.extensions && <div className="setup-chips">{Object.entries(defaults.extensions).map(([ext, value]) =>
              <span key={ext} className={value.isRedline ? 'ok' : ''}>{value.isRedline && <Check size={12} />}{ext}</span>)}</div>}
          </div>
          {defaults?.all ? <span className="setup-ok"><Check size={14} />{copy.defaultDone}</span>
            : <button className="primary-button" onClick={() => void system.openDefaultApps()}>{copy.defaultButton}</button>}
        </section>}
        {platform === 'win32' && <section className={`setup-step ${pinned?.pinned ? 'done' : ''}`}>
          <span className="setup-step-icon"><Pin size={18} /></span>
          <div className="setup-step-copy"><h3>{copy.pinTitle}</h3><p>{copy.pinBody}</p></div>
          {pinned?.pinned ? <span className="setup-ok"><Check size={14} />{copy.pinDone}</span> : <button onClick={() => void refresh()}>{copy.recheck}</button>}
        </section>}
        <section className="setup-step ai">
          <span className="setup-step-icon"><Bot size={18} /></span>
          <div className="setup-step-copy">
            <h3>{copy.aiTitle}</h3>
            <p>{copy.aiBody}</p>
            {!cli ? <p className="setup-muted">{copy.checking}</p> : cli.length
              ? <div className="setup-chips">{cli.map((item) => <span key={item.id} className="ok" title={item.path}><Check size={12} />{item.name}<small>{item.version}</small></span>)}</div>
              : <p className="setup-muted">{copy.none}</p>}
          </div>
        </section>
      </div>
      <footer className="dialog-actions"><button className="primary-button" onClick={onClose}>{copy.done}</button></footer>
    </div>
  </div>;
}
