import React, { useEffect, useMemo, useState } from 'react';
import { X, Terminal, Wrench, Settings2, RefreshCw, Check } from 'lucide-react';
import { t, modifierKey } from './copy';
import { customAgents, readAgentSettings, writeAgentSettings } from './agents';

const GROUP_ICONS = { cli: Terminal, custom: Wrench };

export default function SendDialog({ language, taskCount, canRunLocal, onClose, onStart, onSettings }) {
  const [settings, setSettings] = useState(readAgentSettings);
  const [detected, setDetected] = useState(null);
  const [selected, setSelected] = useState(settings.lastAgent);
  const [scope, setScope] = useState(settings.lastScope || 'file');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const bridge = window.mengxDesktop?.agents;

  async function detect(refresh = false) {
    if (!bridge) { setDetected([]); return; }
    setDetected(null);
    try { setDetected(await bridge.detect(settings.overrides, refresh)); setError(''); } catch (error) { setDetected([]); setError(error.message); }
  }
  useEffect(() => { void detect(); }, []);

  const groups = useMemo(() => {
    const local = detected || [];
    return [
      // Only tools that answered a real --version handshake are offered.
      { kind: 'cli', items: local.filter((item) => item.kind === 'cli' && item.available) },
      { kind: 'custom', items: customAgents(settings) },
      { kind: 'manual', items: [{ id: 'manual', kind: 'manual', available: true, name: language === 'zh' ? '其他 AI / 其他设备' : 'Other AI / device', vendor: language === 'zh' ? '导出任务文件夹，改好后导入' : 'Export a task folder, import the result' }] },
    ].filter((group) => group.items.length || (group.kind === 'cli' && bridge));
  }, [detected, settings, bridge, language]);

  const all = groups.flatMap((group) => group.items);
  const agent = all.find((item) => item.id === selected && item.available) || null;
  useEffect(() => {
    if (agent || !detected) return;
    const first = all.find((item) => item.available && (item.kind === 'cli' || item.kind === 'custom'));
    if (first) setSelected(first.id);
  }, [detected]);

  const localKind = agent && ['cli', 'custom'].includes(agent.kind);
  const blocked = !agent || (localKind && !canRunLocal) || agent.auth === 'required' || agent.compatibility?.ok === false;

  async function start() {
    if (blocked) return;
    try {
      const next = await writeAgentSettings({ ...settings, lastAgent: agent.id, lastScope: scope });
      setSettings(next); onStart({ agent, scope: localKind ? scope : 'file', note });
    } catch (error) { setError(error.message); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="send-dialog" role="dialog" aria-modal="true" aria-labelledby="send-title" onKeyDown={(event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) start();
    }}>
      <header className="dialog-head">
        <div><h2 id="send-title">{t(language, 'sendTitle')}</h2><p>{t(language, 'tasksSummary', taskCount)}</p></div>
        <div className="dialog-head-actions">
          {bridge && <button className="icon-button quiet" onClick={() => void detect(true)} aria-label={t(language, 'redetect')} title={t(language, 'redetect')}><RefreshCw size={16} /></button>}
          <button className="icon-button quiet" onClick={onSettings} aria-label={t(language, 'settings')} title={t(language, 'settings')}><Settings2 size={16} /></button>
          <button className="icon-button quiet" onClick={onClose} aria-label={t(language, 'close')}><X size={16} /></button>
        </div>
      </header>
      <div className="agent-groups">
        {!bridge && <p className="agent-note">{t(language, 'desktopOnly')}</p>}
        {groups.map((group) => {
          const Icon = GROUP_ICONS[group.kind] || Wrench;
          return <section key={group.kind} className="agent-group">
            <h3><Icon size={14} />{group.kind === 'manual' ? (language === 'zh' ? '网页版、桌面版或跨设备交接' : 'Web, desktop or another device') : t(language, { cli: 'groupCli', custom: 'groupCustom' }[group.kind])}</h3>
            {group.kind === 'cli' && bridge && !detected ? <p className="agent-note">{t(language, 'detecting')}</p> :
              group.kind === 'cli' && !group.items.length ? <p className="agent-note">{t(language, 'noCli')}</p> :
              <div className="agent-grid" role="radiogroup" aria-label={t(language, 'chooseAgent')}>
                {group.items.map((item) => <button key={item.id} role="radio" aria-checked={selected === item.id} disabled={!item.available}
                  className={`agent-option ${selected === item.id ? 'selected' : ''}`} title={item.path || ''}
                  onClick={() => setSelected(item.id)} onDoubleClick={() => { setSelected(item.id); }}>
                  <span className="agent-name">{item.name}</span>
                  <span className="agent-vendor">{item.version ? `${item.vendor} · ${item.version}` : item.vendor}{item.auth === 'required' ? (language === 'zh' ? ' · 需要登录' : ' · Sign in required') : item.auth === 'ready' ? (language === 'zh' ? ' · 已登录' : ' · Signed in') : ''}</span>
                  {selected === item.id && <Check size={14} className="agent-check" />}
                </button>)}
              </div>}
          </section>;
        })}
      </div>
      {agent?.auth === 'required' && <div className="agent-note" role="alert"><p>{language === 'zh' ? 'CLI 尚未登录。桌面应用的登录不能代替 CLI 登录，完成后点重新检测。' : 'The CLI is not signed in. Desktop sign-in does not replace CLI sign-in. Detect again after logging in.'}</p><button onClick={() => void bridge.login(agent.id, settings.overrides).catch((error) => setError(error.message))}>{language === 'zh' ? '打开终端登录' : 'Open sign-in terminal'}</button></div>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {agent?.compatibility?.ok === false && <p className="settings-error" role="alert">{agent.compatibility.message}</p>}
      {localKind && <fieldset className="scope-picker">
        <legend>{t(language, 'scope')}</legend>
        {['file', 'folder'].map((value) => <label key={value} className={scope === value ? 'selected' : ''}>
          <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
          <span><strong>{t(language, value === 'file' ? 'scopeFile' : 'scopeFolder')}</strong><small>{t(language, value === 'file' ? 'scopeFileHint' : 'scopeFolderHint')}</small></span>
        </label>)}
      </fieldset>}
      {localKind && <label className="send-note">
        <span>{t(language, 'extraNote')}</span>
        <textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t(language, 'extraNoteHint')} />
      </label>}
      <footer className="dialog-actions">
        <button onClick={onClose}>{t(language, 'cancel')}</button>
        <button className="primary-button" disabled={blocked} onClick={start}>{t(language, 'start')} <kbd>{modifierKey()} ↵</kbd></button>
      </footer>
    </div>
  </div>;
}
