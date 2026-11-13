import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Terminal, Wrench, Settings2, RefreshCw, Check } from 'lucide-react';
import { t, modifierKey } from './copy';
import { customAgents, readAgentSettings, writeAgentSettings } from './agents';

const GROUP_ICONS = { cli: Terminal, custom: Wrench };

export default function SendDialog({ language, taskCount, canRunLocal, onClose, onStart, onSettings, onSaveAs = null, hidden = [], quick = false, mixedScope = false }) {
  const [settings, setSettings] = useState(readAgentSettings);
  const [detected, setDetected] = useState(null);
  const [selected, setSelected] = useState(settings.lastAgent);
  const [scope, setScope] = useState(settings.lastScope || 'file');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const bridge = window.mengxDesktop?.agents;
  // Keyboard focus moves into the dialog, so Esc and Ctrl Enter work right away.
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

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
  // Tools that were looked for but not found stay visible, so a missing one can be fixed here.
  // Shown by name, the first six only: the ones a reader of this language is most likely to use come first.
  const LIKELY = language === 'zh'
    ? ['claude-code', 'codex', 'gemini', 'qwen', 'kimi', 'iflow', 'codebuddy', 'qoder-cli', 'cursor-agent', 'copilot', 'opencode', 'aider']
    : ['claude-code', 'codex', 'gemini', 'cursor-agent', 'copilot', 'opencode', 'aider', 'qwen', 'kimi', 'iflow', 'codebuddy', 'qoder-cli'];
  const rank = (item) => { const at = LIKELY.indexOf(item.id); return at < 0 ? LIKELY.length : at; };
  const missing = (detected || []).filter((item) => item.kind === 'cli' && !item.available).sort((a, b) => rank(a) - rank(b));
  const agent = all.find((item) => item.id === selected && item.available) || null;
  useEffect(() => {
    if (agent || !detected) return;
    const first = all.find((item) => item.available && (item.kind === 'cli' || item.kind === 'custom'));
    if (first) setSelected(first.id);
  }, [detected]);

  // Quick send: with the AI and scope used last time, and nothing here the user should read
  // first, the run starts without the dialog. Anything else shows the dialog as usual.
  const [quickPending, setQuickPending] = useState(() => Boolean(quick && settings.lastAgent && settings.lastAgent !== 'manual' && canRunLocal && !hidden.length && !mixedScope));
  useEffect(() => {
    if (!quickPending || !detected) return;
    const remembered = all.find((item) => item.id === settings.lastAgent && item.available && ['cli', 'custom'].includes(item.kind));
    if (remembered && remembered.auth !== 'required' && remembered.compatibility?.ok !== false) onStart({ agent: remembered, scope: settings.lastScope || 'file', note: '', quick: true });
    else setQuickPending(false);
  }, [quickPending, detected]);

  const localKind = agent && ['cli', 'custom'].includes(agent.kind);
  const blocked = !agent || (localKind && !canRunLocal) || agent.auth === 'required' || agent.compatibility?.ok === false;

  async function start() {
    if (blocked) return;
    try {
      const next = await writeAgentSettings({ ...settings, lastAgent: agent.id, lastScope: scope });
      setSettings(next); onStart({ agent, scope: localKind ? scope : 'file', note });
    } catch (error) { setError(error.message); }
  }

  if (quickPending) return <div className="send-quick" role="status" aria-live="polite">
    <span>{language === 'zh' ? '正在交给上次用的 AI…' : 'Sending to the AI you used last time…'}</span>
    <button onClick={() => setQuickPending(false)}>{t(language, 'sendOptions')}</button>
    <button onClick={onClose}>{t(language, 'cancel')}</button>
  </div>;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} className="send-dialog" role="dialog" aria-modal="true" aria-labelledby="send-title" onKeyDown={(event) => {
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
                  <span className="agent-vendor">{item.version ? `${item.vendor} · ${item.version}` : item.vendor}{item.bundled ? (language === 'zh' ? ' · Claude 桌面版自带' : ' · bundled with Claude desktop') : ''}{item.auth === 'required' ? (language === 'zh' ? ' · 需要登录' : ' · Sign in required') : item.auth === 'ready' ? (language === 'zh' ? ' · 已登录' : ' · Signed in') : ''}</span>
                  {selected === item.id && <Check size={14} className="agent-check" />}
                </button>)}
              </div>}
            {group.kind === 'cli' && detected && missing.length > 0 && <div className="agent-missing">
              <span>{language === 'zh' ? `没找到（${missing.length}）：` : `Not found (${missing.length}): `}{missing.slice(0, 6).map((item) => item.name).join(language === 'zh' ? '、' : ', ')}{missing.length > 6 ? (language === 'zh' ? ' 等' : ' and more') : ''}</span>
              <button onClick={onSettings}>{language === 'zh' ? '填写路径' : 'Set a path'}</button>
            </div>}
          </section>;
        })}
      </div>
      {agent?.auth === 'required' && <div className="agent-note" role="alert"><p>{language === 'zh' ? 'CLI 尚未登录。桌面应用的登录不能代替 CLI 登录，完成后点重新检测。' : 'The CLI is not signed in. Desktop sign-in does not replace CLI sign-in. Detect again after logging in.'}</p><button onClick={() => void bridge.login(agent.id, settings.overrides).catch((error) => setError(error.message))}>{language === 'zh' ? '打开终端登录' : 'Open sign-in terminal'}</button></div>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {agent?.compatibility?.ok === false && <p className="settings-error" role="alert">{agent.compatibility.messages?.[language === 'zh' ? 'zh' : 'en'] || agent.compatibility.message}</p>}
      {localKind && <fieldset className="scope-picker">
        <legend>{t(language, 'scope')}</legend>
        {['file', 'folder'].map((value) => <label key={value} className={scope === value ? 'selected' : ''}>
          <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
          <span><strong>{t(language, value === 'file' ? 'scopeFile' : 'scopeFolder')}</strong><small>{t(language, value === 'file' ? 'scopeFileHint' : 'scopeFolderHint')}</small></span>
        </label>)}
      </fieldset>}
      {mixedScope && <div className="send-hidden" role="note">
        <strong>{language === 'zh' ? '这一轮里有一条全文指令' : 'This round includes a whole-document instruction'}</strong>
        <p>{language === 'zh' ? '全文指令可以改文档的任何地方，所以这一轮不会把「选区之外的改动」单独排除，每处改动都会列出来让你审。想让其他指令只动选中的字，请把全文指令单独发一次。' : 'It may change any part of the document, so changes outside your selections are not set aside this round; every change is still listed for review. To keep the other instructions to exactly what you selected, send the whole-document one on its own.'}</p>
      </div>}
      {hidden.length > 0 && <div className="send-hidden" role="alert">
        <strong>{t(language, 'hiddenTitle', hidden.length)}</strong>
        <p>{t(language, 'hiddenHint')}</p>
        <ul>{hidden.slice(0, 4).map((item, index) => <li key={index}><span>{t(language, 'lineNo', item.line)} · {t(language, `hidden.${item.kind}`)}</span><code>{item.text}</code></li>)}</ul>
      </div>}
      {localKind && <label className="send-note">
        <span>{t(language, 'extraNote')}</span>
        <textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t(language, 'extraNoteHint')} />
      </label>}
      <footer className="dialog-actions">
        {bridge && localKind && !canRunLocal && <p className="dialog-actions-note" role="status">{t(language, 'localNeedsFile')}{onSaveAs && <button className="text-button" onClick={onSaveAs}>{language === 'zh' ? '另存为 .md 并继续' : 'Save as .md and continue'}</button>}</p>}
        <button onClick={onClose}>{t(language, 'cancel')}</button>
        <button className="primary-button" disabled={blocked} onClick={start}>{t(language, 'start')} <kbd>{modifierKey()} ↵</kbd></button>
      </footer>
    </div>
  </div>;
}
