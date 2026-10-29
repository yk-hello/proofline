// Keep platform boundaries small enough to exercise their real code off-host.
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');

function posixQuote(value) { return "'" + String(value).replaceAll("'", "'\"'\"'") + "'"; }
function appleScriptString(value) {
  return '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n') + '"';
}
function macLoginScript(executable, args = [], directory) {
  if (![executable, ...args, ...(directory ? [directory] : [])].every(value => typeof value === 'string' && !/[\x00-\x1f]/.test(value))) throw new Error('Invalid terminal command');
  const command = (directory ? 'cd ' + posixQuote(directory) + ' && ' : '') + [executable, ...args].map(posixQuote).join(' ');
  return 'tell application "Terminal" to do script ' + appleScriptString(command);
}
function openMacTerminal(executable, args = [], { directory, execute = execFile } = {}) {
  const script = macLoginScript(executable, args, directory);
  return new Promise((resolve, reject) => execute('/usr/bin/osascript', ['-e', script], { timeout: 10000 }, error => {
    if (error) reject(new Error('无法打开 Mac 终端：' + error.message)); else resolve({ ok: true });
  }));
}

const ENV_BEGIN = '__REDLINE_ENV_V1__', ENV_END = '__REDLINE_ENV_END__';
function loginEnvironmentCommand(keys) {
  const allowed = [...new Set(['PATH', ...keys])];
  if (allowed.some(key => !/^[A-Z_][A-Z0-9_]*$/.test(key))) throw new Error('Invalid environment variable');
  // /bin/sh after the login shell also supports users of fish. Markers exclude banners.
  const fields = allowed.flatMap(key => [posixQuote(key), '"$' + key + '"']);
  const script = "printf '\\000'; printf '%s\\000' " + [posixQuote(ENV_BEGIN), ...fields, posixQuote(ENV_END)].join(' ');
  return '/bin/sh -c ' + posixQuote(script);
}
function parseLoginEnvironment(output, keys) {
  const parts = String(output).split('\0'), begin = parts.indexOf(ENV_BEGIN), end = parts.indexOf(ENV_END, begin + 1);
  if (begin < 0 || end < 0 || (end - begin - 1) % 2) return {};
  const allowed = new Set(['PATH', ...keys]), values = {};
  for (let index = begin + 1; index < end; index += 2) if (allowed.has(parts[index]) && parts[index + 1]) values[parts[index]] = parts[index + 1];
  return values;
}
function readLoginEnvironment({ shell = '/bin/zsh', keys = [], execute = execFile } = {}) {
  return new Promise(resolve => execute(shell, ['-ilc', loginEnvironmentCommand(keys)], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    resolve(error ? {} : parseLoginEnvironment(stdout, keys));
  }));
}
async function macSearchDirectories(home, { readDirectory = fs.readdir } = {}) {
  const join = path.posix.join;
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'), join(home, '.npm-global/bin'), join(home, '.bun/bin'), join(home, '.volta/bin'), join(home, 'Library/pnpm'), join(home, '.local/share/pnpm'), join(home, '.cargo/bin')];
  for (const root of [join(home, '.nvm/versions/node'), join(home, '.local/share/fnm/node-versions'), join(home, 'Library/Application Support/fnm/node-versions')]) {
    try {
      const versions = (await readDirectory(root)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) extra.push(join(root, version, 'bin'), join(root, version, 'installation/bin'));
    } catch { /* Optional version manager. */ }
  }
  return extra;
}

const stopping = new WeakSet();
function stopProcessTree(child, { platform = process.platform, spawnProcess = spawn, signal = process.kill.bind(process), delay = setTimeout } = {}) {
  if (!child || child.exitCode !== null || !Number.isInteger(child.pid) || child.pid <= 0 || stopping.has(child)) return;
  stopping.add(child);
  if (platform === 'win32') { spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); return; }
  try { signal(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = delay(() => { try { signal(-child.pid, 'SIGKILL'); } catch { /* Group already exited. */ } }, 1500);
  timer.unref?.();
}
module.exports = { posixQuote, appleScriptString, macLoginScript, openMacTerminal, loginEnvironmentCommand, parseLoginEnvironment, readLoginEnvironment, macSearchDirectories, stopProcessTree };
