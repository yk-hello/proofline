const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, Menu, clipboard, ClipboardItem, nativeImage, screen } = require('electron');
// Electron 44 has the asynchronous W3C-style clipboard only (read / write / readText / writeText).
async function readClipboardHtml() {
  try {
    for (const item of await clipboard.read()) if (item.types.includes('text/html')) return await (await item.getType('text/html')).text();
  } catch { /* no HTML on the clipboard */ }
  return '';
}
const fs = require('node:fs/promises');
const { statSync, existsSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { NativeFiles, inside } = require('./native-files.cjs');
const { AgentRunner, detect: detectAgents } = require('./agents.cjs');
const connect = require('./connect.cjs');
const { DataStore, installationDirectory } = require('./data-store.cjs');
const { openMacTerminal } = require('./platform.cjs');

app.setName('Stetwise');
app.setAppUserModelId('app.stetwise.desktop');
protocol.registerSchemesAsPrivileged([
  { scheme: 'mengx', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'mengx-resource', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const args = process.argv.slice(app.isPackaged ? 1 : 2);
const automation = args.includes('--automation');
const userDataIndex = args.indexOf('--user-data');
if (userDataIndex >= 0) app.setPath('userData', path.resolve(args[userDataIndex + 1]));
else {
  // Renaming the product must preserve existing documents, grants and reading state.
  const current = app.getPath('userData');
  if (!existsSync(current)) {
    const previous = ['Proofline', 'Redline', 'MENG X'].map((name) => path.join(app.getPath('appData'), name)).find((folder) => existsSync(folder));
    if (previous) {
      // If an older copy is still running and holds the folder, keep using it where it is.
      try { require('node:fs').renameSync(previous, current); } catch { app.setPath('userData', previous); }
    }
  }
}
const devUrl = !app.isPackaged && (process.env.STETWISE_DEV_URL || process.env.MENGX_DEV_URL);
const exportIndex = args.indexOf('--export-directory');
const exportDirectory = automation && exportIndex >= 0 ? path.resolve(args[exportIndex + 1]) : null;
let window, files, agents, dataStore, canClose = false, awaitingClose = false, detectedAgents = [];
// Files this session exported; only these can be shown in Explorer / Finder from the renderer.
const exportedFiles = new Set();
const isMac = process.platform === 'darwin';
function requestedPaths(argv) {
  const paths = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--user-data', '--export-directory', '--review-request', '--language'].includes(arg)) { index++; continue; }
    if (arg.startsWith('-') || arg === '.') continue;
    if (/\.(md|markdown|mdown|mkd|txt|html?|docx)$/i.test(arg)) paths.push(path.resolve(arg));
    else { try { if (statSync(arg).isDirectory()) paths.push(path.resolve(arg)); } catch { /* not a document argument */ } }
  }
  return paths;
}
let pendingOpen = requestedPaths(args), openingFile = false;
let rendererReady = false;
// An AI in a terminal asking for a review: stetwise-review <file> (electron/review-cli.cjs)
// starts or reaches the app with --review-request <folder>. The page shows a bar on that
// document; the user's instructions are written into the folder, where the command waits.
const reviewRequests = new Map();   // folder -> file
let reviewQueue = [];                // requests the page has not been told about yet
function takeReviewRequest(argv) {
  const at = argv.indexOf('--review-request');
  if (at < 0 || !argv[at + 1]) return;
  const folder = path.resolve(String(argv[at + 1])), file = requestedPaths(argv)[0];
  // Only a folder the command just made in the system temp folder, holding its request file.
  try {
    if (!file || !inside(path.resolve(os.tmpdir()), folder) || !/^stetwise-review-/.test(path.basename(folder)) || !statSync(path.join(folder, 'request.json')).isFile()) return;
  } catch { return; }
  reviewRequests.set(folder, file); reviewQueue.push({ folder, path: file });
}
function finishReview(folder, status, text = '') {
  if (!reviewRequests.delete(folder)) return false;
  reviewQueue = reviewQueue.filter((request) => request.folder !== folder);
  // done.json is written last: the command reads reply.md once it sees it.
  try { writeFileSync(path.join(folder, 'reply.md'), text, 'utf8'); writeFileSync(path.join(folder, 'done.json'), JSON.stringify({ status }), 'utf8'); }
  catch { /* the command stopped waiting and removed its folder */ }
  return true;
}
function deliverReviews() {
  if (!rendererReady || openingFile || pendingOpen.length) return;
  for (const request of reviewQueue.splice(0)) window.webContents.send('mengx:review-request', request);
}
takeReviewRequest(args);
// Finder delivers open-file both during launch and to an already running app.
app.on('open-file', (event, filename) => {
  event.preventDefault();
  pendingOpen.push(path.resolve(filename));
  if (window?.isMinimized()) window.restore();
  window?.focus();
  void deliverOpen();
});
const filters = [{ name: 'Documents', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt', 'html', 'htm', 'docx'] }];
const trusted = (event) => {
  const url = event.senderFrame?.url;
  return event.sender === window?.webContents && event.senderFrame === event.sender.mainFrame &&
    (url?.startsWith('mengx://app/') || (devUrl && new URL(url).origin === new URL(devUrl).origin));
};

async function deliverOpen() {
  if (!pendingOpen.length) deliverReviews();
  if (!rendererReady || openingFile || !pendingOpen.length) return;
  openingFile = true;
  const filename = pendingOpen.shift();
  try { window.webContents.send('mengx:open', await files.grant(filename)); }
  catch (error) {
    await dialog.showMessageBox(window, { type: 'error', message: '无法打开文件', detail: error.message });
    openingFile = false; void deliverOpen();
  }
}

if (!automation && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    pendingOpen.push(...requestedPaths(argv.slice(app.isPackaged ? 1 : 2)));
    takeReviewRequest(argv.slice(app.isPackaged ? 1 : 2));
    if (window?.isMinimized()) window.restore();
    window?.focus();
    void deliverOpen();
  });
  app.whenReady().then(async () => {
    let savedStorage;
    try { savedStorage = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'storage-location.json'), 'utf8')).path; } catch { /* installation default */ }
    const defaultStorage = installationDirectory({ packaged: app.isPackaged, executable: app.getPath('exe'), appPath: app.getAppPath() });
    // The data folder was ProoflineData (and RedlineData before that); in development .redline-data.
    // Carry the newest one over once: rename when possible, otherwise copy and leave the original.
    for (const root of [defaultStorage, path.join(app.getPath('userData'), 'StetwiseData')]) {
      const names = path.basename(root).startsWith('.') ? ['.redline-data'] : ['ProoflineData', 'RedlineData'];
      const legacy = names.map((name) => path.join(path.dirname(root), name)).find((folder) => existsSync(folder));
      if (!savedStorage && !existsSync(root) && legacy) {
        try { await fs.rename(legacy, root); }
        catch { try { await fs.cp(legacy, root, { recursive: true, errorOnExist: true, force: false }); } catch { /* the store reports it */ } }
      }
    }
    dataStore = new DataStore(automation ? path.join(app.getPath('userData'), 'StetwiseData') : savedStorage || defaultStorage);
    await dataStore.init();
    // An installation under Program Files (or a removed drive) cannot be written by a normal
    // user. Keep marks working by falling back to the per-user data folder, and say so.
    if (!dataStore.status().writable && !automation) {
      const fallback = new DataStore(path.join(app.getPath('userData'), 'StetwiseData'));
      if ((await fallback.init()).writable) { fallback.fallbackFrom = dataStore.root; dataStore = fallback; }
    }
    files = new NativeFiles(path.join(app.getPath('userData'), 'file-access.json'), (filename) => shell.trashItem(filename), dataStore);
    await files.init();
    if (automation) globalThis.mengxAutomation = { grant: (filename) => files.grant(filename) };
    const dist = path.resolve(__dirname, '../dist');
    protocol.handle('mengx', async (request) => {
      const url = new URL(request.url);
      const target = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (url.hostname !== 'app' || !inside(dist, target)) return new Response('Forbidden', { status: 403 });
      try {
        const response = await net.fetch(pathToFileURL(target).href);
        const headers = new Headers(response.headers);
        if (target.endsWith('.html')) headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: mengx-resource: https: http:; font-src 'self' data:; connect-src 'self' blob: mengx-resource: https: http:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'");
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    protocol.handle('mengx-resource', async (request) => {
      try {
        const url = new URL(request.url);
        const target = await files.resource(url.hostname, decodeURIComponent(url.pathname.slice(1)));
        const response = await net.fetch(pathToFileURL(target).href);
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        // Local SVG is displayed only as an image, never as an active document.
        headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Image unavailable', { status: 404 }); }
    });
    // macOS needs an application menu for Cmd+C/V/Z/Q to work; Windows uses the custom title bar only.
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
    let windowState = {};
    try { windowState = JSON.parse(await fs.readFile(windowStatePath, 'utf8')); } catch { /* first launch */ }
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = { width: Math.min(area.width, Math.max(720, Number(windowState.width) || 1440)), height: Math.min(area.height, Math.max(520, Number(windowState.height) || 940)) };
    if (Number.isFinite(windowState.x) && Number.isFinite(windowState.y) && screen.getAllDisplays().some(({ workArea }) => windowState.x + bounds.width > workArea.x && windowState.x < workArea.x + workArea.width && windowState.y + bounds.height > workArea.y && windowState.y < workArea.y + workArea.height)) Object.assign(bounds, { x: windowState.x, y: windowState.y });
    window = new BrowserWindow({ title: 'Stetwise', ...bounds, minWidth: 760, minHeight: 520,
      ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 19 } } : { frame: false }),
      backgroundColor: '#ffffff', icon: path.join(__dirname, '..', 'build', isMac ? 'icon.png' : 'icon.ico'), show: !args.includes('--hidden'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false } });
    if (windowState.maximized) window.maximize();
    let windowStateTimer, windowStateWrite = Promise.resolve();
    const saveWindowState = () => {
      const state = { ...window.getNormalBounds(), maximized: window.isMaximized() };
      windowStateWrite = windowStateWrite.catch(() => {}).then(() => fs.writeFile(windowStatePath, JSON.stringify(state))).catch(() => {});
    };
    const queueWindowState = () => { clearTimeout(windowStateTimer); windowStateTimer = setTimeout(saveWindowState, 200); };
    for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, queueWindowState);
    ipcMain.handle('mengx:window', (event, operation, payload) => {
      if (!trusted(event)) throw new Error('Untrusted renderer');
      if (operation === 'attention') {
        // Long AI runs finish while the user is elsewhere: flash the taskbar and notify.
        // Scripted sessions and tests never pop system notifications.
        if (automation || window.isFocused()) return { ok: true, shown: false };
        window.flashFrame(true);
        window.once('focus', () => window.flashFrame(false));
        try {
          const { Notification } = require('electron');
          if (Notification.isSupported()) {
            // Our own logo in the toast. The header name and icon come from the executable:
            // packaged builds say Stetwise; running from source shows Electron.
            const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
            const note = new Notification({ title: String(payload?.title || 'Stetwise').slice(0, 80), body: String(payload?.body || '').slice(0, 240), ...(icon.isEmpty() ? {} : { icon }) });
            note.on('click', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
            note.show();
          }
        } catch { /* notifications unavailable */ }
        return { ok: true, shown: true };
      }
      if (operation === 'theme') {
        // Native parts (scrollbars, the window behind the page) follow the app's theme.
        const { nativeTheme } = require('electron');
        nativeTheme.themeSource = ['light', 'dark'].includes(payload?.theme) ? payload.theme : 'system';
        window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#161616' : '#ffffff');
        return { ok: true, dark: nativeTheme.shouldUseDarkColors };
      }
      if (operation === 'minimize') { window.minimize(); return { ok: true }; }
      if (operation === 'toggleMaximize') { const maximized = !window.isMaximized(); if (maximized) window.maximize(); else window.restore(); return { ok: true, maximized }; }
      if (operation === 'isMaximized') return window.isMaximized();
      if (operation === 'close') { window.close(); return { ok: true }; }
      if (operation === 'accentColor') {
        // Returns the system accent color as a CSS hex string, or null on platforms that don't expose it.
        try {
          const { systemPreferences } = require('electron');
          const raw = systemPreferences.getAccentColor?.(); // 'RRGGBBAA' on Windows
          if (raw && raw.length >= 6) return '#' + raw.slice(0, 6);
        } catch { /* not available */ }
        return null;
      }
      throw new Error('Unknown window operation');
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (/^https?:\/\//i.test(url) && !(devUrl && new URL(url).origin === new URL(devUrl).origin)) void shell.openExternal(url);
    });
    agents = new AgentRunner((channel, payload) => { if (!window.isDestroyed()) window.webContents.send(channel, payload); }, { store: dataStore });
    ipcMain.handle('redline:agents', async (event, operation, ...parameters) => {
      if (!trusted(event)) throw new Error('Untrusted renderer');
      if (operation === 'detect') { detectedAgents = await detectAgents(parameters[0] || {}, { refresh: Boolean(parameters[1]) }); return detectedAgents; }
      if (operation === 'diagnostics') {
        const options = parameters[0] || {}, detected = await detectAgents(options.overrides || {}, { refresh: true });
        const id = require('node:crypto').randomUUID(), dir = path.join(dataStore.root, 'diagnostics', id);
        await fs.mkdir(dir, { recursive: true });
        const run = options.runId ? await dataStore.read('runs', String(options.runId)) : null;
        const flags = ['GEMINI_CLI_HOME', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS'];
        const report = { version: app.getVersion(), at: new Date().toISOString(), platform: process.platform, arch: process.arch, os: require('node:os').release(),
          storage: dataStore.status(), environmentPresent: Object.fromEntries(flags.map((key) => [key, Boolean(process.env[key])])),
          tools: detected.map(({ id, name, path, version, available, auth, defaultArgs }) => ({ id, name, path, version, available, auth, defaultArgs })),
          lastRun: run ? { id: run.id, adapterId: run.adapterId, executable: run.executable, scope: run.scope, status: run.status, code: run.code, diagnostic: run.diagnostic, timedOut: run.timedOut } : null };
        await fs.writeFile(path.join(dir, 'diagnostics.json'), JSON.stringify(report, null, 2), 'utf8');
        const task = '# Stetwise CLI connection diagnosis\n\nRead diagnostics.json. Diagnose why Stetwise cannot start the user’s existing AI CLI. Do not read user documents or print credentials.\n\n1. Identify the actual working command or launcher. Compare executable path, wrapper variables (especially GEMINI_CLI_HOME), Node runtime and current directory with Stetwise. Do not dump a full environment, auth file or .env. Check presence of needed variables without printing values.\n2. Run the exact launcher with --version and --help. Check the installed version’s non-interactive mode and supported arguments. For Codex, run codex login status; --full-auto is obsolete in current versions. Gemini uses -p and, when supported, --output-format stream-json and --skip-trust for the explicitly chosen temporary task directory.\n3. For Gemini, inspect only the selected authentication method. Reuse the user’s existing launcher and home; never replace a working provider configuration or request a new API key unless that setup actually requires one.\n4. Check inherited proxy and certificate configuration, npm/fnm/nvm/Homebrew paths, and workspace trust. Do not disable TLS checks or use unrestricted permission modes as a workaround.\n5. Test in an empty folder: ask the CLI to reply exactly STETWISE_READY, without tools or files. A version response alone is not a successful service connection. State the exit code and whether the exact response arrived.\n6. Give one tested executable path and a non-interactive command template using {prompt}, {task}, {file}, {dir}, plus any necessary environment presence requirements. Do not include secret values. These can be entered in Stetwise AI settings.\n7. Verify with a disposable Markdown copy. The original document must not change before the user accepts review.\n\nReport verified findings separately from guesses. Explain any remaining login or external service action. Ask before editing external tool configs. The JSON deliberately excludes credentials, task prompts and document contents.\n';
        await fs.writeFile(path.join(dir, 'TASK.md'), task, 'utf8');
        await shell.openPath(dir); return { ok: true, path: dir };
      }
      if (operation === 'probe') {
        const options = parameters[0] || {};
        const item = (await detectAgents(options.overrides || {}, { refresh: true })).find((item) => item.id === options.id);
        if (!item?.available) return { ok: false, code: 'not-found', message: '未找到可运行的程序，请先安装或检查路径', messages: { zh: '未找到可运行的程序，请先安装或检查路径', en: 'No runnable program was found. Install it or check its path.' } };
        if (item.auth === 'required') return { ok: false, code: 'login-required', message: '需要先登录或配置 CLI 的身份认证', messages: { zh: '需要先登录或配置 CLI 的身份认证。点「打开终端登录」，完成后重新检测。', en: 'Sign in to this CLI first (or set up its credentials): use "Open sign-in terminal", then detect again.' } };
        if (item.probeCompatibility?.ok === false) return { ok: false, code: 'arguments', message: item.probeCompatibility.message, messages: item.probeCompatibility.messages };
        const { runCommand, connectionArgs, connectionResult } = require('./agents.cjs');
        const probeArgs = connectionArgs(item);
        if (!probeArgs) return { ok: false, code: 'manual-test', message: '此工具请在终端完成登录与连接检查，或直接发送文档副本测试', messages: { zh: '此工具请在终端完成登录与连接检查，或直接发送文档副本测试', en: 'Check sign-in and the connection for this tool in a terminal, or send a copy of a document to test it.' } };
        const probeDir = path.join(dataStore.root, 'connection-check'); await fs.mkdir(probeDir, { recursive: true });
        // Some providers take a while to answer the first request; a real task waits much longer.
        const result = await runCommand(item.path, probeArgs, { timeout: 90000, cwd: probeDir });
        const verdict = connectionResult(result);
        if (result.timedOut && verdict.code === 'timeout') return { ...verdict, code: 'probe-timeout', message: '90 秒内没有收到测试回复。服务可能很慢或没有响应；可以直接发送一篇短文档试试，正式任务会等更久。', messages: { zh: '90 秒内没有收到测试回复。服务可能很慢或没有响应；可以直接发送一篇短文档试试，正式任务会等更久。', en: 'No answer to the test within 90 seconds. The service may be slow or not responding; try sending a short document, as a real task waits much longer.' } };
        return verdict;
      }
      if (operation === 'run') {
        const options = parameters[0] || {};
        const record = await files.get(options.documentId, 'file');
        if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(record.path)) throw new Error('Only Markdown and text documents can be edited by an agent');
        return agents.run({ adapterId: options.adapterId, documentPath: record.path, scope: options.scope === 'folder' ? 'folder' : 'file',
          task: String(options.task || ''), tasks: options.tasks || [], copyText: typeof options.copyText === 'string' ? options.copyText : null, anchors: Array.isArray(options.anchors) ? options.anchors : null, custom: options.custom || null, overrides: options.overrides || {}, timeoutMinutes: options.timeoutMinutes });
      }
      if (operation === 'history') return (await dataStore.list('runs')).slice(0, 30).map((run) => ({ id: run.id, documentPath: run.documentPath, agentName: run.agentName, startedAt: run.startedAt, status: agents.runs.has(run.id) ? 'running' : ['running', 'starting'].includes(run.status) ? 'interrupted' : run.status, diagnostic: run.diagnostic }));
      if (operation === 'recover') {
        const run = await dataStore.read('runs', String(parameters[0]));
        if (!run || agents.runs.has(run.id)) throw new Error('Run not available');
        if (typeof run.proposed !== 'string') { try { run.proposed = await fs.readFile(run.file, 'utf8'); } catch { /* no result */ } }
        return { ...run, record: await files.grant(run.documentPath) };
      }
      if (operation === 'login') {
        const id = String(parameters[0]), item = (await detectAgents(parameters[1] || {}, { refresh: true })).find((item) => item.id === id);
        if (!item?.path) throw new Error('CLI not found');
        const loginArgs = id === 'codex' ? ['login'] : id === 'claude-code' ? ['auth', 'login'] : [];
        const { spawn } = require('node:child_process');
        if (isMac) {
          await openMacTerminal(item.path, loginArgs, { directory: require('node:os').homedir() });
        } else if (process.platform === 'win32') {
          const command = '& ' + "'" + item.path.replaceAll("'", "''") + "' " + loginArgs.join(' ');
          spawn('powershell.exe', ['-NoLogo', '-NoExit', '-Command', command], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        } else throw new Error('Please run the login command in your terminal');
        return { ok: true };
      }
      if (operation === 'cancel') return agents.cancel(parameters[0]);
      if (operation === 'clipboard') { await clipboard.writeText(String(parameters[0] ?? '')); return { ok: true }; }
      if (operation === 'readClipboard') return { text: await clipboard.readText(), html: await readClipboardHtml() };
      throw new Error('Unknown agent operation');
    });
    // Look for local AI tools in the background so the send dialog opens instantly.
    setTimeout(() => { void detectAgents().catch(() => {}); }, 3000);
    // Never edit another AI application's configuration during startup.
    ipcMain.handle('redline:system', async (event, operation, ...parameters) => {
      if (!trusted(event)) throw new Error('Untrusted renderer');
      if (operation === 'defaultStatus') return connect.defaultStatus();
      if (operation === 'pinnedStatus') return connect.pinnedStatus();
      if (operation === 'storageStatus') return dataStore.status();
      if (operation === 'readAgentSettings') {
        const device = require('node:crypto').createHash('sha256').update(require('node:os').hostname() + process.platform).digest('hex').slice(0, 16);
        const common = await dataStore.read('settings', 'agents'), local = await dataStore.read('settings', 'device-' + device);
        if (!common && !local) return null;
        const overrides = { ...(common?.overrides || {}) };
        for (const [id, location] of Object.entries(local?.paths || {})) overrides[id] = { ...overrides[id], path: location };
        return { ...common, overrides, customs: local?.customs || [] };
      }
      if (operation === 'writeAgentSettings') {
        const value = parameters[0];
        if (!value || JSON.stringify(value).length > 1000000) throw new Error('Invalid settings');
        const device = require('node:crypto').createHash('sha256').update(require('node:os').hostname() + process.platform).digest('hex').slice(0, 16);
        const paths = {}, overrides = {};
        for (const [id, item] of Object.entries(value.overrides || {})) { if (!item) continue; const { path: location, ...rest } = item; overrides[id] = rest; if (location) paths[id] = location; }
        await dataStore.write('settings', 'device-' + device, { paths, customs: value.customs || [] });
        return dataStore.write('settings', 'agents', { ...value, overrides, customs: [] });
      }
      if (operation === 'openStorage') { await fs.mkdir(dataStore.root, { recursive: true }); return shell.openPath(dataStore.root); }
      if (operation === 'chooseStorage') {
        if (agents.starting || agents.runs.size || dataStore.jobs.size) throw new Error('请等当前任务或保存完成');
        const choice = await dialog.showOpenDialog(window, { title: '选择 Stetwise 数据目录', properties: ['openDirectory', 'createDirectory'] });
        if (choice.canceled) return null;
        const root = path.join(choice.filePaths[0], 'StetwiseData');
        if (root === dataStore.root) return dataStore.status();
        if (inside(dataStore.root, root) || inside(root, dataStore.root)) throw new Error('请选择当前数据目录之外的文件夹');
        const next = new DataStore(root);
        if (!(await next.init()).writable) throw new Error(next.error);
        // Copy, never remove the previous directory. Existing destination data is preserved.
        await dataStore.copyInto(root);
        await fs.writeFile(path.join(app.getPath('userData'), 'storage-location.json'), JSON.stringify({ path: root }), 'utf8');
        dataStore = next; files.dataStore = next; agents.store = next; return next.status();
      }
      if (operation === 'openDefaultApps') {
        if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Stetwise');
        return { ok: true };
      }
      throw new Error('Unknown system operation');
    });
    window.on('close', (event) => {
      clearTimeout(windowStateTimer); saveWindowState();
      if (canClose || !rendererReady) return;
      event.preventDefault();
      if (awaitingClose) return;
      awaitingClose = true;
      window.webContents.send('mengx:before-close');
    });
    ipcMain.on('mengx:ready', (event) => { if (trusted(event)) { rendererReady = true; void deliverOpen(); } });
    ipcMain.on('mengx:open-finished', async (event, error) => {
      if (!trusted(event)) return;
      if (error) await dialog.showMessageBox(window, { type: 'error', message: '无法打开文档', detail: error });
      openingFile = false; void deliverOpen();
    });
    ipcMain.on('mengx:finish-close', async (event, result) => {
      if (!trusted(event) || !awaitingClose) return;
      if (result?.unsaved) {
        const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Stetwise', message: '还有修改未写入原文件',
          detail: '修改尚未写入原文件。可继续阅读并处理保存问题，或先导出副本。应用会尝试保留本机恢复草稿，但存储失败时无法保证恢复。', buttons: ['继续阅读', '仍然关闭'], defaultId: 0, cancelId: 0 });
        if (choice.response !== 1) { awaitingClose = false; return; }
      }
      canClose = true;
      agents?.cancelAll();
      window.close();
    });
    ipcMain.handle('mengx:files', async (event, operation, ...parameters) => {
      if (!trusted(event)) throw new Error('Untrusted renderer');
      switch (operation) {
        case 'chooseFile': {
          let defaultPath = app.getPath('documents');
          if (parameters[0]) {
            try { defaultPath = path.dirname((await files.get(parameters[0], 'file')).path); } catch { /* default to Documents */ }
          }
          const choice = await dialog.showOpenDialog(window, { title: '打开文档', defaultPath, properties: ['openFile'], filters });
          return choice.canceled ? null : files.grant(choice.filePaths[0]);
        }
        case 'chooseDirectory': {
          const choice = await dialog.showOpenDialog(window, { title: '打开文件夹', properties: ['openDirectory'] });
          return choice.canceled ? null : files.grant(choice.filePaths[0]);
        }
        case 'read': return files.read(...parameters);
        case 'readSidecar': return files.readSidecar(...parameters);
        case 'writeSidecar': return files.writeSidecar(...parameters);
        case 'saveImage': return files.saveImage(...parameters);
        case 'handoff': { const result = await files.handoff(parameters[0], String(parameters[1]), String(parameters[2]), typeof parameters[3] === 'string' ? parameters[3] : null); await shell.openPath(result.path); return result; }
        case 'metadata': return files.metadata(...parameters);
        case 'write': return files.write(...parameters);
        case 'list': return files.list(...parameters);
        case 'completePath': return files.complete(...parameters);
        case 'remember': return files.persist(...parameters);
        case 'restore': return files.restore(...parameters);
        case 'forget': return files.forget(...parameters);
        case 'prepareTrash': return files.prepareTrash(...parameters);
        case 'trash': return files.trash(...parameters);
        case 'openGrantedPath': {
          const target = path.resolve(parameters[0]);
          const record = [...files.records.values()].find((item) => item.path === target);
          if (record) return files.get(record.id);
          const root = [...files.records.values()].find((item) => item.kind === 'directory' && inside(item.root, target));
          if (root) return files.grant(target, root.root);
          if ([...files.recents.values()].includes(target)) return files.grant(target);
          throw new Error('Open this file or its folder first');
        }
        case 'openDroppedFile': {
          // Called only with a path supplied by Electron webUtils for a user drop.
          return files.grant(parameters[0]);
        }
        case 'openExternal': {
          const value = String(parameters[0] || '').trim();
          let target;
          try { target = new URL(value); } catch { throw new Error('Invalid external URL'); }
          if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) throw new Error('Unsupported external URL');
          await shell.openExternal(target.href);
          return { ok: true, url: target.href };
        }
        case 'openLinkedFile': {
          const record = await files.get(parameters[0], 'file');
          let source;
          try { source = decodeURIComponent(String(parameters[1] || '')); } catch { throw new Error('Invalid local document reference'); }
          if (!source || source.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(source) || path.isAbsolute(source)) throw new Error('Invalid local document reference');
          return files.grant(path.resolve(path.dirname(record.path), source.replaceAll('/', path.sep)), record.root);
        }
        case 'copyImage': {
          await files.resource(parameters[0], parameters[1]);
          const bytes = Buffer.from(parameters[2]);
          if (bytes.length > 64 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid image data');
          const bitmap = nativeImage.createFromBuffer(bytes);
          if (bitmap.isEmpty()) throw new Error('Image unavailable');
          await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bitmap.toPNG()], { type: 'image/png' }) })]);
          return { ok: true };
        }
        case 'revealResource': {
          shell.showItemInFolder(await files.resource(parameters[0], parameters[1]));
          return { ok: true };
        }
        case 'saveExport': {
          const name = path.basename(parameters[0]), options = parameters[2] || {};
          if (!/\.(md|pdf|docx)$/i.test(name) && !/\.annotations\.json$/i.test(name)) throw new Error('Unsupported export format');
          let filename;
          if (exportDirectory) { await fs.mkdir(exportDirectory, { recursive: true }); filename = path.join(exportDirectory, name); }
          else {
            // Start next to the document, titled in the interface language.
            const near = options.documentId ? files.records.get(String(options.documentId))?.path : null;
            const choice = await dialog.showSaveDialog(window, { title: String(options.title || '保存导出副本').slice(0, 80), defaultPath: near ? path.join(path.dirname(near), name) : name,
              filters: [{ name: name.endsWith('.pdf') ? 'PDF' : name.endsWith('.docx') ? 'Word' : name.endsWith('.json') ? 'Annotations' : 'Markdown', extensions: [name.endsWith('.pdf') ? 'pdf' : name.endsWith('.docx') ? 'docx' : name.endsWith('.json') ? 'json' : 'md'] }] });
            if (choice.canceled) return { ok: false, cancelled: true };
            filename = choice.filePath;
          }
          const bytes = new Uint8Array(parameters[1]);
          await fs.writeFile(filename, bytes);
          exportedFiles.add(filename);
          return { ok: true, path: filename, bytes: bytes.length, name };
        }
        case 'revealExport': {
          const target = String(parameters[0] || '');
          if (!exportedFiles.has(target)) throw new Error('Only files exported in this session can be shown');
          shell.showItemInFolder(target);
          return { ok: true };
        }
        case 'openExported': {
          // A file the user just saved through our dialog may be opened as a document.
          const target = String(parameters[0] || '');
          if (!exportedFiles.has(target) || !/\.(md|txt)$/i.test(target)) throw new Error('Only a document exported in this session can be opened this way');
          return files.grant(target);
        }
        case 'reviewReply': {
          const status = parameters[1] === 'notes' ? 'notes' : 'none';
          if (!finishReview(path.resolve(String(parameters[0] || '')), status, String(parameters[2] || '').slice(0, 2_000_000))) throw new Error('No review is waiting for this document');
          return { ok: true };
        }
        // Where the stetwise-review launcher is, for the user to hand to their terminal AI.
        case 'reviewCommand': {
          const launcher = process.platform === 'win32' ? path.join(path.dirname(app.getPath('exe')), 'stetwise-review.cmd') : path.join(process.resourcesPath || '', 'stetwise-review');
          return app.isPackaged && existsSync(launcher) ? { ok: true, command: launcher } : { ok: false };
        }
        // Plain text, written here because the page may not hold the focus the web clipboard asks for.
        case 'copyText': {
          await clipboard.write([new ClipboardItem({ 'text/plain': String(parameters[0] || '').slice(0, 2_000_000) })]);
          return { ok: true };
        }
                case 'copyRich': {
          await clipboard.write([new ClipboardItem({ 'text/html': String(parameters[0] || ''), 'text/plain': String(parameters[1] || '') })]);
          return { ok: true };
        }
        default: throw new Error('Unknown desktop operation');
      }
    });
    // --language zh|en sets the interface language for a profile that has not chosen one (tests use it).
    const asked = args[args.indexOf('--language') + 1], startQuery = args.includes('--language') && ['zh', 'en'].includes(asked) ? `?lang=${asked}` : '';
    await (devUrl ? window.loadURL(devUrl + startQuery) : window.loadURL('mengx://app/index.html' + startQuery));
  }).catch((error) => { console.error(error); app.exit(1); });
}
app.on('window-all-closed', () => {
  agents?.cancelAll();
  // A command still waiting for a review is told the app has gone, so it does not wait for ever.
  for (const folder of [...reviewRequests.keys()]) finishReview(folder, 'closed');
  app.quit();
});
