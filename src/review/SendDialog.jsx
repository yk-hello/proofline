import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Terminal, Wrench, Settings2, RefreshCw, Check } from 'lucide-react';
import { t, modifierKey } from './copy';
import { customAgents, readAgentSettings, writeAgentSettings } from './agents';

const GROUP_ICONS = { cli: Terminal, custom: Wrench };

// Folder paths compared without case or slash differences.
const folderKey = (value) => String(value || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
/** Does the conversation's folder hold the document, or sit inside the document's folder? Then it is the same project. */
const sameProject = (conversationFolder, documentFolder) => {
  const a = folderKey(conversationFolder), b = folderKey(documentFolder);
  return Boolean(a && b) && (a === b || b.startsWith(a + '/') || a.startsWith(b + '/'));
};
const lastParts = (folder, count = 2) => String(folder || '').split(/[\\/]/).filter(Boolean).slice(-count).join('/');

export default function SendDialog({ language, documentPath = '', taskCount, canRunLocal, onClose, onStart, onSettings, onSaveAs = null, hidden = [], quick = false, mixedScope = false }) {
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

  // Codex only: send the task into a conversation the user already had with it, instead of a new one.
  // A new conversation stays the default every time; continuing is a choice made in this dialog.
  const canContinue = agent?.id === 'codex' && Boolean(bridge?.conversations);
  const [continuing, setContinuing] = useState(false);
  const [conversations, setConversations] = useState(null);
  const [conversationId, setConversationId] = useState('');
  useEffect(() => {
    if (!canContinue || !continuing || conversations) return;
    bridge.conversations('codex').then((list) => { setConversations(list); setConversationId((current) => current || list.find((item) => !item.active && sameProject(item.folder, documentPath.replace(/[\\/][^\\/]*$/, '')))?.id || ''); })
      .catch((error) => { setConversations([]); setError(error.message); });
  }, [canContinue, continuing, conversations]);
  const conversation = canContinue && continuing ? (conversations || []).find((item) => item.id === conversationId) || null : null;
  // Conversations from this document's project first, then the rest by folder; a search narrows both.
  const [conversationQuery, setConversationQuery] = useState('');
  const documentFolder = documentPath.replace(/[\\/][^\\/]*$/, '');
  const conversationGroups = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    const shown = (conversations || []).filter((item) => !query || `${item.title} ${item.folder}`.toLowerCase().includes(query));
    const here = shown.filter((item) => sameProject(item.folder, documentFolder));
    const groups = here.length ? [{ key: 'here', here: true, folder: documentFolder, items: here }] : [];
    for (const item of shown.filter((entry) => !here.includes(entry))) {
      const key = folderKey(item.folder);
      let group = groups.find((entry) => !entry.here && entry.key === key);
      if (!group) groups.push(group = { key, here: false, folder: item.folder, items: [] });
      group.items.push(item);
    }
    return groups;
  }, [conversations, conversationQuery, documentFolder]);
  const when = (time) => new Date(time).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const localKind = agent && ['cli', 'custom'].includes(agent.kind);
  const blocked = !agent || (localKind && !canRunLocal) || agent.auth === 'required' || agent.compatibility?.ok === false || (canContinue && continuing && !conversation);

  async function start() {
    if (blocked) return;
    try {
      const next = await writeAgentSettings({ ...settings, lastAgent: agent.id, lastScope: scope });
      setSettings(next); onStart({ agent, scope: localKind ? scope : 'file', note, conversation });
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
      {canContinue && <fieldset className="scope-picker conversation-picker">
        <legend>{language === 'zh' ? '对话' : 'Conversation'}</legend>
        <label className={!continuing ? 'selected' : ''}>
          <input type="radio" name="conversation" checked={!continuing} onChange={() => setContinuing(false)} />
          <span><strong>{language === 'zh' ? '新对话' : 'A new conversation'}</strong><small>{language === 'zh' ? '最稳妥。AI 只看这次的任务和文档。' : 'The safest. The AI sees only this task and the document.'}</small></span>
        </label>
        <label className={continuing ? 'selected' : ''}>
          <input type="radio" name="conversation" checked={continuing} onChange={() => setContinuing(true)} />
          <span><strong>{language === 'zh' ? '接着之前的 Codex 对话' : 'Continue an earlier Codex conversation'}</strong><small>{language === 'zh' ? 'AI 记得那次聊过的内容。任务照样只改副本，改动照样逐处让你审。' : 'The AI remembers what you discussed there. It still edits a copy, and you still review every change.'}</small></span>
        </label>
        {continuing && (conversations === null ? <p className="agent-note">{language === 'zh' ? '正在读取 Codex 的对话…' : 'Reading your Codex conversations…'}</p>
          : !conversations.length ? <p className="agent-note">{language === 'zh' ? '没找到可以接着的 Codex 对话。先在 Codex 里聊过，这里才会列出来。' : 'No Codex conversation to continue yet. Conversations you have in Codex show up here.'}</p>
          : <>
            {conversations.length > 5 && <input className="conversation-search" type="search" value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)}
              placeholder={language === 'zh' ? '按标题或文件夹查找' : 'Find by title or folder'} aria-label={language === 'zh' ? '查找对话' : 'Find a conversation'} />}
            <div className="conversation-list" role="radiogroup" aria-label={language === 'zh' ? '选择对话' : 'Choose a conversation'}>
              {!conversationGroups.length && <p className="agent-note">{language === 'zh' ? '没有符合的对话。' : 'No conversation matches.'}</p>}
              {conversationGroups.map((group) => <React.Fragment key={group.key}>
                <div className={`conversation-group ${group.here ? 'here' : ''}`} title={group.folder}>{group.here ? (language === 'zh' ? '这个项目' : 'This project') : (lastParts(group.folder) || (language === 'zh' ? '未知文件夹' : 'Unknown folder'))}</div>
                {group.items.map((item) => <button key={item.id} role="radio" aria-checked={conversationId === item.id} title={item.folder} className={`conversation-option ${conversationId === item.id ? 'selected' : ''}`} onClick={() => setConversationId(item.id)}>
                  <span className="conversation-title">{item.title || (language === 'zh' ? '（无标题）' : '(untitled)')}</span>
                  <span className="conversation-meta">{when(item.updatedAt)}{item.folder ? ` · ${lastParts(item.folder)}` : ''}{item.active ? (language === 'zh' ? ' · 刚刚还在用' : ' · in use just now') : ''}</span>
                </button>)}
              </React.Fragment>)}
            </div>
          </>)}
        {continuing && conversations?.length > 0 && !conversation && <p className="agent-note">{language === 'zh' ? '选一个对话再开始。这个项目里还没有对话时，不会替你默认选别的项目。' : 'Choose a conversation to start. When this project has none, none from another project is chosen for you.'}</p>}
        {conversation?.active && <p className="settings-error" role="alert">{language === 'zh' ? '这个对话两分钟内还有动静，可能还开在 Codex 里。先在那边停下来再发，否则两边会同时往一个对话里写。' : 'This conversation changed in the last two minutes and may still be open in Codex. Stop it there first, or both sides will write into it at once.'}</p>}
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
