// Local AI agent adapters. Each adapter says how to find a tool and how to run it
// headlessly against a task file. Flags change between releases, so every
// template can be overridden from the settings panel without a new build.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readLoginEnvironment, macSearchDirectories, stopProcessTree } = require('./platform.cjs');

const SHORT_PROMPT = 'Read the file .redline/TASK.md in the current directory. First read the whole document it names, then carry out every instruction in it, edit that document directly, and reply in the format it asks for.';

// {prompt} is the short ASCII instruction above; {task} the task file; {file} the document; {dir} the working folder.
const CLI_ADAPTERS = [
  { id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', commands: ['claude'], args: ['-p', '{prompt}', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep'] },
  { id: 'codex', name: 'Codex CLI', vendor: 'OpenAI', commands: ['codex'], args: ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--json', '{prompt}'] },
  { id: 'gemini', name: 'Gemini CLI', vendor: 'Google', commands: ['gemini'], args: ['-p', '{prompt}', '--approval-mode', 'auto_edit', '--output-format', 'stream-json'] },
  { id: 'qwen', name: 'Qwen Code', vendor: '阿里通义', commands: ['qwen'], args: ['-p', '{prompt}', '--approval-mode', 'auto-edit'] },
  { id: 'kimi', name: 'Kimi CLI', vendor: '月之暗面', commands: ['kimi'], args: ['--print', '--prompt', '{prompt}'] },
  { id: 'iflow', name: 'iFlow CLI', vendor: '心流', commands: ['iflow'], args: ['-p', '{prompt}', '--yolo'] },
  { id: 'codebuddy', name: 'CodeBuddy Code', vendor: '腾讯', commands: ['codebuddy', 'cbc'], args: ['-p', '{prompt}', '-y', '--permission-mode', 'acceptEdits'] },
  { id: 'qoder-cli', name: 'Qoder CLI', vendor: '阿里', commands: ['qodercli', 'qoder'], args: ['-p', '{prompt}', '--permission-mode', 'accept_edits'] },
  { id: 'opencode', name: 'opencode', vendor: 'SST', commands: ['opencode'], args: ['run', '{prompt}'] },
  { id: 'cursor-agent', name: 'Cursor CLI', vendor: 'Cursor', commands: ['cursor-agent', 'agent'], args: ['-p', '{prompt}', '--force'] },
  { id: 'copilot', name: 'Copilot CLI', vendor: 'GitHub', commands: ['copilot'], args: ['-p', '{prompt}', '--allow-all-tools'] },
  { id: 'aider', name: 'Aider', vendor: 'Aider', commands: ['aider'], args: ['--message-file', '{task}', '--yes', '--no-git', '--no-auto-commits', '{file}'] },
];

const local = (...parts) => path.join(process.env.LOCALAPPDATA || '', ...parts);
const IDE_ADAPTERS = [
  { id: 'antigravity', name: 'Antigravity', vendor: 'Google', commands: ['antigravity'], win: [local('Programs', 'Antigravity', 'Antigravity.exe')], mac: 'Antigravity' },
  { id: 'trae', name: 'Trae', vendor: '字节跳动', commands: ['trae'], win: [local('Programs', 'Trae', 'Trae.exe')], mac: 'Trae' },
  { id: 'trae-cn', name: 'Trae CN', vendor: '字节跳动', commands: ['trae-cn'], win: [local('Programs', 'Trae CN', 'Trae CN.exe')], mac: 'Trae CN' },
  { id: 'cursor', name: 'Cursor', vendor: 'Cursor', commands: ['cursor'], win: [local('Programs', 'cursor', 'Cursor.exe')], mac: 'Cursor' },
  { id: 'vscode', name: 'VS Code', vendor: 'Microsoft', commands: ['code'], win: [local('Programs', 'Microsoft VS Code', 'Code.exe')], mac: 'Visual Studio Code' },
  { id: 'windsurf', name: 'Windsurf', vendor: 'Windsurf', commands: ['windsurf'], win: [local('Programs', 'Windsurf', 'Windsurf.exe')], mac: 'Windsurf' },
  { id: 'kiro', name: 'Kiro', vendor: 'AWS', commands: ['kiro'], win: [local('Programs', 'Kiro', 'Kiro.exe')], mac: 'Kiro' },
  { id: 'qoder', name: 'Qoder', vendor: '阿里', commands: [], win: [local('Programs', 'Qoder', 'Qoder.exe')], mac: 'Qoder' },
  { id: 'codebuddy-ide', name: 'CodeBuddy IDE', vendor: '腾讯', commands: ['codebuddy-ide'], win: [local('Programs', 'CodeBuddy', 'CodeBuddy.exe')], mac: 'CodeBuddy' },
];

let shellPath = null, shellVariablesCache = null, loginEnvironmentCache = null;
const PROVIDER_VARIABLES = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GEMINI_MODEL', 'GEMINI_CLI_HOME', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_GENAI_USE_VERTEXAI', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
function loginEnvironment() { return loginEnvironmentCache ||= readLoginEnvironment({ shell: process.env.SHELL || '/bin/zsh', keys: PROVIDER_VARIABLES }); }
async function shellVariables() {
  if (shellVariablesCache) return shellVariablesCache;
  shellVariablesCache = new Promise((resolve) => {
    if (process.platform === 'win32') {
      const command = '$v=@{}; ' + PROVIDER_VARIABLES.map((key) => '$v["' + key + '"]=[Environment]::GetEnvironmentVariable("' + key + '")').join('; ') + '; [Console]::Out.Write(($v|ConvertTo-Json -Compress))';
      execFile('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', command], { timeout: 8000, windowsHide: true }, (error, stdout) => {
        try { resolve(error ? {} : Object.fromEntries(Object.entries(JSON.parse(stdout)).filter(([, value]) => value))); } catch { resolve({}); }
      });
    } else {
      loginEnvironment().then(resolve, () => resolve({}));
    }
  });
  return shellVariablesCache;
}
function windowsExtraDirs() {
  const home = os.homedir(), appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), localData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [path.join(home, '.local', 'bin'), path.join(appData, 'npm'), path.join(localData, 'pnpm'), path.join(home, '.bun', 'bin'),
    path.join(home, 'scoop', 'shims'), path.join(localData, 'Volta', 'bin'), path.join(home, '.cargo', 'bin'), path.join(localData, 'Programs', 'Python', 'Scripts')];
  // fnm/nvm keep Node (and every npm -g tool) outside the system PATH; only shells see them.
  for (const root of [process.env.FNM_DIR, path.join(appData, 'fnm'), path.join(localData, 'fnm'), path.join(home, '.fnm')].filter(Boolean)) {
    dirs.push(path.join(root, 'aliases', 'default'));
    try { for (const version of require('node:fs').readdirSync(path.join(root, 'node-versions'))) dirs.push(path.join(root, 'node-versions', version, 'installation')); } catch { /* no fnm here */ }
  }
  if (process.env.NVM_SYMLINK) dirs.push(process.env.NVM_SYMLINK);
  if (process.env.NVM_HOME) dirs.push(process.env.NVM_HOME);
  dirs.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'));
  return dirs;
}
async function searchPath() {
  if (shellPath) return shellPath;
  if (process.platform === 'win32') {
    // A PowerShell with the user's profile sees what their terminal sees (fnm env, conda, etc.).
    const profilePath = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', '[Console]::Out.Write($env:PATH)'], { timeout: 8000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout)));
    });
    shellPath = [...new Set([...(process.env.PATH || '').split(';'), ...profilePath.split(';'), ...windowsExtraDirs()])].filter(Boolean).join(';');
    return shellPath;
  }
  // Apps launched from Finder do not inherit the login shell environment.
  const login = await loginEnvironment();
  const extra = await macSearchDirectories(os.homedir());
  shellPath = [...new Set([...(login.PATH || '').split(':'), ...(process.env.PATH || '').split(':'), ...extra])].filter(Boolean).join(':');
  return shellPath;
}

// Windows spells it Path; a second PATH key would make the child's value unpredictable.
async function envWithPath(extra = {}) {
  const env = { ...await shellVariables() };
  for (const [key, value] of Object.entries(process.env)) if (key.toUpperCase() !== 'PATH') env[key] = value;
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = await searchPath();
  return { ...env, ...extra };
}

function parseEnvironment(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    result[match[1]] = value;
  }
  return result;
}

async function launcherHome(executable) {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable || '')) return null;
  try { const text = await fs.readFile(executable, 'utf8');
    const home = /^\s*set\s+"?GEMINI_CLI_HOME=([^"\r\n]+)"?\s*$/im.exec(text)?.[1];
    return home && path.isAbsolute(home) ? home : null;
  } catch { return null; }
}

async function geminiLaunchers() {
  if (process.platform !== 'win32') return [];
  const roots = [process.env.GEMINI_CLI_HOME, path.join(os.homedir(), 'GeminiCLI')].filter(Boolean);
  for (let code = 67; code <= 90; code++) roots.push(String.fromCharCode(code) + ':\\GeminiCLI');
  const found = [];
  for (const root of roots) {
    const file = path.join(root, 'Start-Gemini.cmd');
    try { const text = await fs.readFile(file, 'utf8');
      // Only headless-capable wrappers that forward arguments, without pause or cmd /k.
      if (/%\*/.test(text) && !/^\s*pause\b|cmd(?:\.exe)?\s+.*\/k\b/im.test(text)) found.push(file);
    } catch { /* not installed here */ }
  }
  return [...new Set(found)];
}

async function adapterEnvironment(id, executable) {
  if (id !== 'gemini') return {};
  const allowed = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GEMINI_MODEL', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']);
  let values = {};
  const home = await geminiHome(executable);
  try { values = parseEnvironment(await fs.readFile(path.join(home, '.env'), 'utf8')); } catch { /* no user env file */ }
  // Gemini's interactive startup may load this file after workspace trust; the
  // headless child needs the same user-level provider config without copying it.
  const inherited = { ...await shellVariables(), ...process.env };
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key) && inherited[key] === undefined));
}

async function geminiHome(executable) {
  return await launcherHome(executable) || process.env.GEMINI_CLI_HOME || (await shellVariables()).GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
}

function redactOutput(text, env) {
  for (const [key, value] of Object.entries(env)) if (/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 6) text = text.split(value).join('[redacted]');
  return text;
}

async function which(command) {
  if (path.isAbsolute(command)) { try { if ((await fs.stat(command)).isFile()) { if (process.platform !== 'win32') await fs.access(command, require('node:fs').constants.X_OK); return command; } } catch { /* keep searching */ } return null; }
  const dirs = (await searchPath()).split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try { const stat = await fs.stat(candidate); if (stat.isFile()) { if (process.platform !== 'win32') await fs.access(candidate, require('node:fs').constants.X_OK); return candidate; } } catch { /* keep looking */ }
    }
  }
  return null;
}

// A tool counts as installed only if it actually answers: run `<tool> --version`
// and require a clean exit with some output. Leftover folders or broken shims fail.
async function handshake(executable) {
  try {
    const result = await runCommand(executable, ['--version'], { timeout: 15000 });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (!result.ok || !text) return null;
    return (/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(text)?.[0]) || text.split('\n')[0].slice(0, 40);
  } catch { return null; }
}

let detectCache = null, detectedAt = 0, detectedSignature = '';
async function detect(overrides = {}, { refresh = false } = {}) {
  const signature = JSON.stringify(overrides);
  if (refresh || signature !== detectedSignature || Date.now() - detectedAt > 60000) { detectCache = null; shellPath = null; shellVariablesCache = null; loginEnvironmentCache = null; }
  detectedSignature = signature; detectedAt = Date.now();
  detectCache ||= Promise.all(CLI_ADAPTERS.map(async (adapter) => {
    const commands = overrides[adapter.id]?.path ? [overrides[adapter.id].path] : adapter.id === 'gemini' ? [...await geminiLaunchers(), ...adapter.commands] : adapter.commands;
    for (const command of commands) {
      const found = await which(command);
      if (!found) continue;
      const version = await handshake(found);
      if (version) {
        const help = await runCommand(found, adapter.id === 'codex' ? ['exec', '--help'] : adapter.id === 'opencode' ? ['run', '--help'] : ['--help'], { timeout: 15000 });
        let auth = 'unknown';
        if (adapter.id === 'codex') { const login = await runCommand(found, ['login', 'status'], { timeout: 10000 }); auth = login.ok ? 'ready' : /not logged|log in|login/i.test(login.stdout + login.stderr) ? 'required' : 'unknown'; }
        if (adapter.id === 'gemini') {
          try { const settings = JSON.parse(await fs.readFile(path.join(await geminiHome(found), 'settings.json'), 'utf8'));
            const extra = await adapterEnvironment('gemini', found);
            if (settings.security?.auth?.selectedType === 'gemini-api-key') auth = process.env.GEMINI_API_KEY || (await shellVariables()).GEMINI_API_KEY || extra.GEMINI_API_KEY ? 'configured' : 'required';
          } catch { /* Let the explicit connection test explain missing initialization. */ }
        }
        return { id: adapter.id, path: found, version, auth, help: help.stdout + help.stderr };
      }
    }
    return { id: adapter.id, path: null, version: null };
  }));
  const found = await detectCache;
  return CLI_ADAPTERS.map((adapter, index) => ({ id: adapter.id, kind: 'cli', name: adapter.name, vendor: adapter.vendor, auth: found[index].auth || 'unknown',
    available: Boolean(found[index].version), path: found[index].path, version: found[index].version,
    defaultArgs: compatibleArgs(adapter, found[index].help), args: overrides[adapter.id]?.args || compatibleArgs(adapter, found[index].help),
    compatibility: validateArgs(overrides[adapter.id]?.args || compatibleArgs(adapter, found[index].help), found[index].help),
    probeCompatibility: validateArgs(connectionArgs({ id: adapter.id, defaultArgs: compatibleArgs(adapter, found[index].help) }), found[index].help) }));
}

function validateArgs(args, help = '') {
  if (!help.trim()) return { ok: false, unsupported: [], message: '未能读取此版本的参数说明，请在终端检查 --help 或使用手动交接' };
  const declared = helpFlags(help);
  const flags = splitTemplate(args).filter((arg) => /^--?[a-zA-Z]/.test(arg)).map((arg) => arg.split('=')[0]);
  const unsupported = [...new Set(flags.filter((flag) => !declared.has(flag)))];
  return { ok: unsupported.length === 0, unsupported, message: unsupported.length ? '此版本未声明支持参数：' + unsupported.join(', ') + '。请更新 CLI、覆盖参数或手动交接。' : '' };
}

function helpFlags(help = '') {
  // --yes-always does not imply --yes; --prompt does not imply -p.
  return new Set([...String(help).matchAll(/(?:^|[\s,[|])(--?[a-zA-Z][a-zA-Z0-9-]*)(?=[\s=,[|]|$)/gm)].map((match) => match[1]));
}

function compatibleArgs(adapter, help = '') {
  if (adapter.id === 'gemini') {
    const declared = helpFlags(help);
    const args = ['-p', '{prompt}', '--approval-mode', 'auto_edit'];
    if (declared.has('--output-format')) args.push('--output-format', 'stream-json');
    if (declared.has('--skip-trust')) args.push('--skip-trust');
    return args;
  }
  return adapter.args;
}

function connectionArgs(item) {
  const prompt = 'Reply with exactly REDLINE_READY. Do not call tools, read files, or change files.';
  const args = {
    codex: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', prompt],
    'claude-code': ['-p', prompt],
    gemini: ['-p', prompt, ...(item.defaultArgs.includes('--output-format') ? ['--output-format', 'stream-json'] : []), ...(item.defaultArgs.includes('--skip-trust') ? ['--skip-trust'] : [])],
    qwen: ['-p', prompt], kimi: ['--print', '--prompt', prompt], iflow: ['-p', prompt], codebuddy: ['-p', prompt],
    'qoder-cli': ['-p', prompt], opencode: ['run', prompt], 'cursor-agent': ['-p', prompt], copilot: ['-p', prompt],
    aider: ['--message', prompt, '--yes', '--no-git', '--no-auto-commits'],
  }[item.id];
  return args || null;
}

function diagnose(output, { timedOut = false, code = null, spawnError = false } = {}) {
  if (/must specify.*(?:GEMINI_API_KEY|GOOGLE_API_KEY)|(?:GEMINI_API_KEY|GOOGLE_API_KEY).*not set|select.*auth.*method|please.*set.*auth/i.test(output)) return { code: 'login-required', message: 'Gemini CLI 当前登录方式缺少 API 环境变量。打开终端运行 gemini，选择 Google 登录或配置 API key，再重新测试；不要把密钥填进任务或日志。' };
  if (timedOut) return { code: 'timeout', message: '任务超过所设时限。检查日志后可重新发送，或在设置里延长时限。' };
  if (spawnError) return { code: 'launch-failed', message: '进程未能启动。检查可执行路径、Node 环境和文件权限。' };
  if (/not logged|not authenticated|authentication required|login required|please (?:log|sign) in|401|unauthorized/i.test(output)) return { code: 'login-required', message: 'CLI 尚未登录。点击“打开终端登录”，完成后重新检测。桌面应用的登录不会自动等同于 CLI 登录。' };
  if (/unknown (?:argument|option)|unrecognized (?:argument|option)|unexpected argument|invalid (?:option|choice)/i.test(output)) return { code: 'arguments', message: '此 CLI 版本不接受启动参数。重新检测版本，或在 AI 工具设置里覆盖参数。' };
  if (/ENOTFOUND|ECONN|ETIMEDOUT|fetch failed|network|proxy|certificate|TLS/i.test(output)) return { code: 'network', message: '连接服务失败。检查此终端的网络、代理和证书设置后重试。' };
  if (/quota|rate.limit|429|insufficient|billing/i.test(output)) return { code: 'quota', message: '服务端额度或限流问题。检查 CLI 账号的额度与模型权限。' };
  if (/permission denied|EACCES|EPERM|workspace.*trust|untrusted/i.test(output)) return { code: 'permission', message: 'CLI 或目录权限受限。请在终端中完成工作区信任或修正目录权限。' };
  return code === 0 ? null : { code: 'cli-exit', message: 'CLI 异常退出。展开日志查看具体原因，然后重新发送。' };
}

function readableOutput(output) {
  return output.split(/\r?\n/).map((line) => {
    try { const event = JSON.parse(line); if (event.type === 'item.completed' && event.item?.type === 'agent_message') return event.item.text || '';
      if (event.type === 'message') return event.role === 'assistant' ? event.content || event.message?.content || '' : '';
      if (event.type === 'result') return typeof event.result === 'string' ? event.result : '';
      if (event.type === 'error' || event.type === 'turn.failed') return event.message || event.error?.message || line; return '';
    } catch { return line; }
  }).filter(Boolean).join('\n');
}

function responseReady(output) {
  return readableOutput(output).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).some((line) => line.trim() === 'REDLINE_READY');
}

function connectionResult(result) {
  const output = (result.stdout || '') + '\n' + (result.stderr || '');
  if (result.ok && !result.timedOut && responseReady(output)) return { ok: true, message: '服务已返回连接测试响应', checkedAt: Date.now() };
  const diagnostic = diagnose(output, { timedOut: Boolean(result.timedOut), code: 1 });
  return { ok: false, ...diagnostic, message: diagnostic?.message || '未收到测试响应', checkedAt: Date.now() };
}

function quoteWindows(value) {
  if (value === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function launch(executable, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const line = [quoteWindows(executable), ...args.map(quoteWindows)].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true });
  }
  if (process.platform === 'win32' && /\.ps1$/i.test(executable)) {
    return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], options);
  }
  return spawn(executable, args, options);
}

function killTree(child) { stopProcessTree(child); }

function splitTemplate(template) {
  if (Array.isArray(template)) return template;
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(template)))) parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}

class AgentRunner {
  constructor(send, { store } = {}) { this.send = send; this.runs = new Map(); this.store = store; }

  async persist(record) {
    if (!this.store) return;
    const { child, cleanup, heartbeat, ...snapshot } = record;
    await this.store.write('runs', record.id, snapshot);
  }

  async run(options) {
    if (this.starting || this.runs.size) throw new Error('已有任务正在运行。请先停止或完成当前任务。');
    this.starting = true;
    try { return await this.start(options); } finally { this.starting = false; }
  }

  async start({ adapterId, documentPath, scope = 'file', task, tasks = [], custom, overrides = {}, timeoutMinutes = 30 }) {
    const adapter = CLI_ADAPTERS.find((item) => item.id === adapterId);
    let executable, args;
    if (custom) {
      const parts = splitTemplate(custom.template);
      if (!parts.length) throw new Error('The custom command is empty');
      executable = await which(parts[0]);
      if (!executable) throw new Error('Command not found: ' + parts[0]);
      args = parts.slice(1);
    } else {
      if (!adapter) throw new Error('Unknown agent');
      const detected = (await detect(overrides)).find((item) => item.id === adapterId);
      if (!detected?.available) throw new Error(adapter.name + ' 未能运行。请在设置中检查路径并重新检测。');
      if (!detected.compatibility.ok) throw new Error(detected.compatibility.message);
      if (detected.auth === 'required') throw Object.assign(new Error(adapter.name + ' 尚未登录。请先打开终端登录，然后重新检测。'), { code: 'login-required' });
      executable = detected.path;
      args = splitTemplate(overrides[adapter.id]?.args || detected.args);
    }
    const id = randomUUID(), name = path.basename(documentPath);
    const original = (await fs.readFile(documentPath, 'utf8')).replace(/^\uFEFF/, '');
    let cwd, file, cleanup, taskFile;
    if (scope === 'folder') {
      cwd = path.dirname(documentPath); file = documentPath;
      const dir = path.join(cwd, '.redline'), existed = existsSync(dir);
      await fs.mkdir(dir, { recursive: true });
      taskFile = path.join(dir, 'TASK-' + id + '.md');
      cleanup = async () => { await fs.rm(taskFile, { force: true }); if (!existed) await fs.rmdir(dir).catch(() => {}); };
    } else {
      cwd = this.store ? path.join(this.store.root, 'work', id) : await fs.mkdtemp(path.join(os.tmpdir(), 'redline-'));
      await fs.mkdir(cwd, { recursive: true }); file = path.join(cwd, name);
      await fs.copyFile(documentPath, file); await fs.mkdir(path.join(cwd, '.redline'));
      taskFile = path.join(cwd, '.redline', 'TASK.md');
      // Retain the proposed copy and task so interrupted runs can be recovered.
      cleanup = async () => {};
    }
    await fs.writeFile(taskFile, task, 'utf8');
    const relativeTask = path.relative(cwd, taskFile).replaceAll(path.sep, '/');
    const values = { prompt: 'Read the file ' + relativeTask + ' in the current directory. First read the whole document it names, then carry out every instruction in it, edit that document directly, and reply in the format it asks for.', task: taskFile, file, dir: cwd };
    args = args.map((arg) => arg.replace(/\{(prompt|task|file|dir)\}/g, (_, key) => values[key]));
    const env = await envWithPath({ ...(await adapterEnvironment(adapterId, executable)), FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' });
    if (scope !== 'folder') { try { await fs.cp(documentPath + '.assets', file + '.assets', { recursive: true, dereference: false, force: false }); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    const record = { id, output: '', cwd, file, scope, cleanup, documentPath, base: original, task, tasks, adapterId,
      agentName: adapter?.name || custom?.name || 'Custom', executable, args, startedAt: Date.now(), lastOutputAt: null, status: 'starting', cancelled: false };
    await this.persist(record);
    let child;
    try { child = launch(executable, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { record.status = 'failed'; record.diagnostic = diagnose(error.message, { spawnError: true }); await this.persist(record); await cleanup(); throw error; }
    record.child = child; record.pid = child.pid; record.status = 'running'; this.runs.set(id, record);
    const append = (chunk) => {
      const text = redactOutput(String(chunk), env); record.output = (record.output + text).slice(-400000); record.lastOutputAt = Date.now();
      const lines = ((record.jsonBuffer || '') + text).split(/\r?\n/); record.jsonBuffer = lines.pop().slice(-100000);
      for (const line of lines) { try { const event = JSON.parse(line); if (event.type === 'init' && typeof event.model === 'string') { record.model = event.model; this.send('agents:status', { id, model: record.model }); } } catch { /* plain output */ } }
      this.send('agents:output', { id, text });
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', append); child.stderr.on('data', append);
    record.heartbeat = setInterval(() => {
      const silenceMs = Date.now() - (record.lastOutputAt || record.startedAt);
      this.send('agents:status', { id, pid: child.pid, alive: child.exitCode === null, silenceMs, lastOutputAt: record.lastOutputAt, phase: silenceMs > 60000 ? 'waiting' : 'running' });
      void this.persist(record).catch((error) => this.send('agents:status', { id, storageError: error.message }));
    }, 3000);
    const timeout = setTimeout(() => { record.timedOut = true; killTree(child); }, Math.min(240, Math.max(1, Number(timeoutMinutes) || 30)) * 60000);
    child.on('error', (error) => { record.spawnError = true; append('\n[Proofline] ' + error.message + '\n'); });
    child.on('close', async (code) => {
      clearTimeout(timeout); clearInterval(record.heartbeat);
      let proposed = null;
      try { proposed = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''); } catch { /* Agent may have deleted the file. */ }
      record.proposed = proposed; record.code = code; record.finishedAt = Date.now();
      record.diagnostic = diagnose(record.output, { code, timedOut: record.timedOut, spawnError: record.spawnError });
      record.reply = readableOutput(record.output);
      record.status = record.cancelled ? 'cancelled' : record.timedOut ? 'timeout' : code === 0 ? 'done' : 'failed';
      let storageError;
      try { await this.persist(record); } catch (error) { storageError = error.message; }
      await cleanup().catch(() => {}); this.runs.delete(id);
      this.send('agents:done', { id, code, cancelled: record.cancelled, timedOut: Boolean(record.timedOut), output: record.output,
        reply: record.reply, model: record.model, diagnostic: record.diagnostic, storageError, proposed, durationMs: Date.now() - record.startedAt });
    });
    return { id, executable, args, cwd, scope, pid: child.pid };
  }

  cancel(id) { const record = this.runs.get(id); if (!record) return { ok: false }; record.cancelled = true; killTree(record.child); return { ok: true }; }
  cancelAll() { for (const id of this.runs.keys()) this.cancel(id); }
}

async function openInIde({ adapterId, documentPath, detected }) {
  const adapter = IDE_ADAPTERS.find((item) => item.id === adapterId);
  if (!adapter) throw new Error('Unknown editor');
  const target = detected?.path;
  if (!target) throw new Error(`${adapter.name} was not found`);
  const folder = path.dirname(documentPath);
  if (process.platform === 'darwin' && target.endsWith('.app')) {
    spawn('open', ['-a', target, folder, documentPath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    const child = launch(target, [folder, documentPath], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  }
  return { ok: true };
}

async function runCommand(executable, args, { timeout = 20000, cwd } = {}) {
  // npm shims need node on PATH, which GUI apps often lack (fnm, nvm, Homebrew).
  const adapterId = /gemini(?:\.(?:exe|cmd|bat|ps1))?$/i.test(executable) ? 'gemini' : '';
  const env = await envWithPath({ ...(await adapterEnvironment(adapterId, executable)), NO_COLOR: '1' });
  return new Promise((resolve) => {
    let child;
    try { child = launch(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd, detached: process.platform !== 'win32' }); }
    catch (error) { resolve({ ok: false, stdout: '', stderr: error.message }); return; }
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + redactOutput(chunk, env)).slice(-400000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + redactOutput(chunk, env)).slice(-400000); });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, stdout, stderr: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut }); });
  });
}

module.exports = { runCommand, which, AgentRunner, detect, diagnose, readableOutput, responseReady, connectionResult, compatibleArgs, validateArgs, helpFlags, connectionArgs, parseEnvironment, redactOutput, openInIde, CLI_ADAPTERS, IDE_ADAPTERS, SHORT_PROMPT, splitTemplate, launch };
