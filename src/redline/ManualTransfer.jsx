import React, { useState } from 'react';
import { X, FolderOpen, FileUp } from 'lucide-react';

export default function ManualTransfer({ language, onClose, onPackage, onImport }) {
  const zh = language === 'zh', [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function act(action) { setBusy(true); try { const result = await action(); setMessage(result?.path || (zh ? '已完成' : 'Done')); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><div className="settings-dialog transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
    <header className="dialog-head"><h2 id="transfer-title">{zh ? '其他 AI / 跨设备交接' : 'Other AI / device'}</h2><button className="icon-button quiet" aria-label={zh ? '关闭' : 'Close'} onClick={onClose}><X size={16} /></button></header>
    <div className="settings-body"><p>{zh ? '把任务打包成一个文件夹，带到另一台电脑，或交给任何能读写文件的 AI（编辑器、桌面 AI）处理。改好后把文档导入回来，在 Proofline 里逐处审阅。' : 'Package the task as a folder for another computer, or for any AI that can read and edit files (an editor or desktop AI). Import the revised document here and review each change.'}</p>
      <div className="transfer-actions"><button disabled={busy} onClick={() => void act(onPackage)}><FolderOpen size={15} />{zh ? '生成并打开任务文件夹' : 'Create and open task folder'}</button></div>
      <p className="settings-hint">{zh ? '任务包包含文档副本、TASK.md、标记 JSON 和应用保存的图片。不会复制登录凭据；另一台设备需自行安装并登录 AI。可在任意桌面 AI 中打开 TASK.md 和文档副本，再导回修改后的 Markdown。' : 'The package contains a document copy, TASK.md, marks JSON and saved images. Credentials are excluded. Install and sign in to an AI on the other device; bring back the revised Markdown.'}</p>
      <label className="transfer-file"><FileUp size={15} />{zh ? '导入修改后的 Markdown / TXT' : 'Import revised Markdown / TXT'}<input type="file" accept=".md,.markdown,.txt" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void act(async () => { if (file.size > 64 * 1024 * 1024) throw new Error('File is too large'); onImport(await file.text()); }); }} /></label>
      {message && <p role="status" className="transfer-message">{message}</p>}
    </div><footer className="dialog-actions"><button className="primary-button" onClick={onClose}>{zh ? '完成' : 'Done'}</button></footer>
  </div></div>;
}
