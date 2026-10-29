import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { t } from './copy';
import { readAgentSettings, writeAgentSettings } from './agents';

export default function AgentSettings({ language, onClose, onRecover }) {
  const [settings, setSettings] = useState(readAgentSettings);
  const [detected, setDetected] = useState([]);
  const bridge = window.mengxDesktop?.agents;
  const system = window.mengxDesktop?.system, zh = language === 'zh';
  const [storage, setStorage] = useState(null), [error, setError] = useState(''), [history, setHistory] = useState([]), [checking, setChecking] = useState(false);
  const [probes, setProbes] = useState({});
  async function probe(item) {
    setProbes((current) => ({ ...current, [item.id]: { pending: true } }));
    try { const result = await bridge.probe({ id: item.id, overrides: settings.overrides }); setProbes((current) => ({ ...current, [item.id]: result })); }
    catch (error) { setProbes((current) => ({ ...current, [item.id]: { ok: false, message: error.message } })); }
  }
  async function check() {
    setChecking(true);
    try {
      if (bridge) { setDetected(await bridge.detect(settings.overrides, true)); setHistory(await bridge.history()); }
      if (system) setStorage(await system.storageStatus());
    } catch (error) { setError(error.message); } finally { setChecking(false); }
  }
  useEffect(() => {
    if (!bridge) return;
    void check();
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));
  const setOverride = (id, value) => update({ overrides: { ...settings.overrides, [id]: { ...settings.overrides[id], args: value } } });
  const setCustom = (index, patch) => update({ customs: settings.customs.map((item, position) => position === index ? { ...item, ...patch } : item) });

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <header className="dialog-head"><h2 id="agent-settings-title">{t(language, 'agentSettings')}</h2><button className="icon-button quiet" onClick={onClose} aria-label={t(language, 'close')}><X size={16} /></button></header>
      <div className="settings-body">
        {error && <p role="alert" className="settings-error">{error}</p>}
        {system && <section className="storage-settings"><h3>{zh ? 'JSON 与任务保存位置' : 'JSON and task storage'}</h3><p>{storage?.path}</p>
          {storage?.error && <p role="alert" className="settings-error">{storage.error}</p>}
          <p className="settings-hint">{zh ? '默认在安装文件夹的 ProoflineData；Mac 在 .app 旁边。迁移时复制整个目录；CLI 账号需要在新设备登录。' : 'ProoflineData in the installation folder, beside .app on Mac. Copy this directory to move devices; CLI sign-in is required again.'}</p>
          <button onClick={() => void system.openStorage().catch((error) => setError(error.message))}>{zh ? '打开保存位置' : 'Open folder'}</button>
          <button onClick={() => void system.chooseStorage().then((value) => { if (value) setStorage(value); }).catch((error) => setError(error.message))}>{zh ? '迁移到其他位置' : 'Move storage'}</button>
        </section>}
        {bridge && <section>
          <h3>{t(language, 'groupCli')}</h3>
          <p className="settings-hint">{zh ? '找到程序不等于已登录。自动检测不到时填写完整可执行路径；路径只保留在本设备配置中。' : 'Found does not mean signed in. Enter a full executable path when needed; paths are saved for this device only.'}</p>
          <button disabled={checking} onClick={() => void check()}>{checking ? (zh ? '检测中…' : 'Checking…') : t(language, 'redetect')}</button>
          <button onClick={() => void bridge.diagnostics({ overrides: settings.overrides }).then((result) => setError((zh ? '诊断任务已保存：' : 'Diagnostic task saved: ') + result.path)).catch((error) => setError(error.message))}>{zh ? '生成 CLI 辅助诊断任务' : 'Create CLI diagnosis task'}</button>
          {detected.map((item) => <details key={item.id} className="settings-row" open={item.available || Boolean(settings.overrides[item.id]?.path)}>
            <summary><strong>{item.name}</strong> · {item.version || t(language, 'notInstalled')} · {item.auth === 'required' ? (zh ? '需要登录' : 'Sign in required') : item.auth === 'ready' ? (zh ? '已登录' : 'Signed in') : (zh ? '登录待确认' : 'Check sign-in')}</summary>
            <label>{t(language, 'path')}<input spellCheck={false} placeholder={item.path || (zh ? '自动查找或填写完整路径' : 'Auto-detect or full path')} value={settings.overrides[item.id]?.path || ''} onChange={(event) => update({ overrides: { ...settings.overrides, [item.id]: { ...settings.overrides[item.id], path: event.target.value } } })} /></label>
            <label>{t(language, 'override')}<input spellCheck={false} placeholder={item.defaultArgs.join(' ')} value={settings.overrides[item.id]?.args || ''} onChange={(event) => setOverride(item.id, event.target.value)} /></label>
            {item.compatibility?.ok === false && item.available && <p role="alert" className="settings-error">{item.compatibility.message}</p>}
            {item.available && <button onClick={() => void bridge.login(item.id, settings.overrides).catch((error) => setError(error.message))}>{zh ? '打开终端登录 / 初始化' : 'Open terminal: sign in / initialize'}</button>}
            {item.available && <button disabled={probes[item.id]?.pending} onClick={() => void probe(item)}>{probes[item.id]?.pending ? (zh ? '等待服务响应…' : 'Waiting for service…') : (zh ? '测试连接（会调用模型）' : 'Test connection (uses model)')}</button>}
            {probes[item.id] && <p role="status">{probes[item.id].pending ? '' : probes[item.id].message}</p>}
          </details>)}
          <label>{zh ? '任务最长运行时间（分钟，1–240）' : 'Task timeout (minutes, 1–240)'}<input type="number" min="1" max="240" value={settings.timeoutMinutes} onChange={(event) => update({ timeoutMinutes: Math.min(240, Math.max(1, Number(event.target.value) || 30)) })} /></label>
          <p className="settings-hint">{zh ? '每 3 秒检查进程。无输出显示等待，不代表服务端握手成功。到达时限才停止，失败与中断任务保留日志。' : 'Check the process every 3 seconds. Silence means waiting, not a server heartbeat. Interrupted runs keep their logs.'}</p>
        </section>}
        <section>
          <h3>{t(language, 'customAgents')}</h3>
          <p className="settings-hint">{t(language, 'templateHint')}</p>
          {settings.customs.map((item, index) => <div key={item.id} className="settings-row custom-row">
            <input aria-label={t(language, 'name')} placeholder={t(language, 'name')} value={item.name} onChange={(event) => setCustom(index, { name: event.target.value })} />
            <input aria-label={t(language, 'commandTemplate')} spellCheck={false} placeholder="mycli -p {prompt}" value={item.template} onChange={(event) => setCustom(index, { template: event.target.value })} />
            <button className="icon-button quiet" aria-label={t(language, 'remove')} onClick={() => update({ customs: settings.customs.filter((_, position) => position !== index) })}><Trash2 size={15} /></button>
          </div>)}
          <button className="text-button" onClick={() => update({ customs: [...settings.customs, { id: `custom-${crypto.randomUUID()}`, name: '', template: '' }] })}><Plus size={15} />{t(language, 'addCustom')}</button>
        </section>
        {history.length > 0 && <section><h3>{zh ? '最近任务 / 中断恢复' : 'Recent tasks / recovery'}</h3>{history.slice(0, 8).map((run) => <div className="settings-row" key={run.id}><strong>{run.agentName} · {run.status}</strong><small>{run.documentPath}</small>{run.diagnostic && <p>{run.diagnostic.message}</p>}<button disabled={run.status === 'running'} onClick={() => void onRecover(run.id).catch((error) => setError(error.message))}>{zh ? '恢复到审阅' : 'Recover for review'}</button></div>)}</section>}
      </div>
      <footer className="dialog-actions">
        <button onClick={onClose}>{t(language, 'cancel')}</button>
        <button className="primary-button" onClick={() => void writeAgentSettings(settings).then(onClose).catch((error) => setError(error.message))}>{t(language, 'save')}</button>
      </footer>
    </div>
  </div>;
}
