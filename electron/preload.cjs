const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (operation, ...args) => ipcRenderer.invoke('mengx:files', operation, ...args);
const windowInvoke = (operation) => ipcRenderer.invoke('mengx:window', operation);
contextBridge.exposeInMainWorld('mengxDesktop', {
  platform: process.platform,
  minimizeWindow: () => windowInvoke('minimize'),
  toggleMaximize: () => windowInvoke('toggleMaximize'),
  isMaximized: () => windowInvoke('isMaximized'),
  closeWindow: () => windowInvoke('close'),
  getAccentColor: () => windowInvoke('accentColor'),
  chooseFile: (currentId) => invoke('chooseFile', currentId),
  chooseDirectory: () => invoke('chooseDirectory'),
  read: (id) => invoke('read', id),
  metadata: (id) => invoke('metadata', id),
  write: (id, source, expected) => invoke('write', id, source, expected),
  list: (id) => invoke('list', id),
  completePath: (filename) => invoke('completePath', filename),
  remember: (key, id) => invoke('remember', key, id),
  restore: (key) => invoke('restore', key),
  forget: (key) => invoke('forget', key),
  prepareTrash: (id) => invoke('prepareTrash', id),
  trash: (id, token) => invoke('trash', id, token),
  openGrantedPath: (filename) => invoke('openGrantedPath', filename),
  openDroppedFile: (file) => invoke('openDroppedFile', webUtils.getPathForFile(file)),
  openExternal: (url) => invoke('openExternal', url),
  openLinkedFile: (id, source) => invoke('openLinkedFile', id, source),
  saveExport: (name, bytes) => invoke('saveExport', name, bytes),
  copyImage: (id, source, bytes) => invoke('copyImage', id, source, bytes),
  revealResource: (id, source) => invoke('revealResource', id, source),
  finishClose: (result) => ipcRenderer.send('mengx:finish-close', result),
  onClose: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('mengx:before-close', listener);
    return () => ipcRenderer.removeListener('mengx:before-close', listener);
  },
  onOpen: (handler) => {
    const listener = (_event, record) => Promise.resolve().then(() => handler(record))
      .then(() => ipcRenderer.send('mengx:open-finished'))
      .catch((error) => ipcRenderer.send('mengx:open-finished', error.message));
    ipcRenderer.on('mengx:open', listener);
    return () => ipcRenderer.removeListener('mengx:open', listener);
  },
  ready: () => ipcRenderer.send('mengx:ready'),
  readSidecar: (id) => invoke('readSidecar', id),
  writeSidecar: (id, text) => invoke('writeSidecar', id, text),
  saveImage: (id, bytes) => invoke('saveImage', id, bytes),
  handoff: (id, task, marks) => invoke('handoff', id, task, marks),
  system: {
    defaultStatus: () => ipcRenderer.invoke('redline:system', 'defaultStatus'),
    pinnedStatus: () => ipcRenderer.invoke('redline:system', 'pinnedStatus'),
    openDefaultApps: () => ipcRenderer.invoke('redline:system', 'openDefaultApps'),
    storageStatus: () => ipcRenderer.invoke('redline:system', 'storageStatus'),
    openStorage: () => ipcRenderer.invoke('redline:system', 'openStorage'),
    chooseStorage: () => ipcRenderer.invoke('redline:system', 'chooseStorage'),
    readAgentSettings: () => ipcRenderer.invoke('redline:system', 'readAgentSettings'),
    writeAgentSettings: (value) => ipcRenderer.invoke('redline:system', 'writeAgentSettings', value),
  },
  agents: {
    detect: (overrides, refresh = false) => ipcRenderer.invoke('redline:agents', 'detect', overrides, refresh),
    probe: (options) => ipcRenderer.invoke('redline:agents', 'probe', options),
    run: (options) => ipcRenderer.invoke('redline:agents', 'run', options),
    cancel: (id) => ipcRenderer.invoke('redline:agents', 'cancel', id),
    login: (id, overrides) => ipcRenderer.invoke('redline:agents', 'login', id, overrides),
    history: () => ipcRenderer.invoke('redline:agents', 'history'),
    diagnostics: (options) => ipcRenderer.invoke('redline:agents', 'diagnostics', options),
    recover: (id) => ipcRenderer.invoke('redline:agents', 'recover', id),
    onStatus: (handler) => { const listener = (_event, data) => handler(data); ipcRenderer.on('agents:status', listener); return () => ipcRenderer.removeListener('agents:status', listener); },
    openIde: (options) => ipcRenderer.invoke('redline:agents', 'openIde', options),
    writeClipboard: (text) => ipcRenderer.invoke('redline:agents', 'clipboard', text),
    readClipboard: () => ipcRenderer.invoke('redline:agents', 'readClipboard'),
    onOutput: (handler) => { const listener = (_event, data) => handler(data); ipcRenderer.on('agents:output', listener); return () => ipcRenderer.removeListener('agents:output', listener); },
    onDone: (handler) => { const listener = (_event, data) => handler(data); ipcRenderer.on('agents:done', listener); return () => ipcRenderer.removeListener('agents:done', listener); },
  },
});
