// First-run setup checks: default app and taskbar pin status, plus cleanup of the
// MCP entries an earlier version wrote into other AI tools' config files.
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { runCommand, which } = require('./agents.cjs');

const home = os.homedir();
const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const macSupport = path.join(home, 'Library', 'Application Support');
const platformPath = (win, mac) => (process.platform === 'win32' ? win : mac);

// Config files that Proofline 0.3.0's "connect AI" step may have written to. That
// step was removed: it reported apps as installed from leftover folders and gave
// users nothing they could see. On first start we take our entries back out.
const LEGACY_FILES = [
  platformPath(path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(macSupport, 'Claude', 'claude_desktop_config.json')),
  path.join(home, '.gemini', 'config', 'mcp_config.json'), path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
  path.join(home, '.gemini', 'settings.json'), path.join(home, '.cursor', 'mcp.json'), path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
  platformPath(path.join(appData, 'Trae', 'User', 'mcp.json'), path.join(macSupport, 'Trae', 'User', 'mcp.json')),
  platformPath(path.join(appData, 'Trae CN', 'User', 'mcp.json'), path.join(macSupport, 'Trae CN', 'User', 'mcp.json')),
  path.join(home, '.qwen', 'settings.json'), path.join(home, '.kimi-code', 'mcp.json'),
];
const LEGACY_TOML = path.join(home, '.codex', 'config.toml');
const TOML_SECTION = /\n?\[mcp_servers\.redline\][\s\S]*?(?=\n\[|$)/;

async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text, 'utf8');
  await fs.rename(temporary, file);
}

async function removeLegacyConnections(marker) {
  if (existsSync(marker)) return { skipped: true };
  const cleaned = [];
  for (const file of LEGACY_FILES) {
    if (!existsSync(file)) continue;
    const backup = `${file}.redline-backup`;
    let data;
    try { data = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '') || '{}'); } catch { continue; }
    if (data?.mcpServers?.redline) {
      delete data.mcpServers.redline;
      if (!Object.keys(data.mcpServers).length) delete data.mcpServers;
      // A file Proofline created from nothing (no backup) is removed entirely.
      if (!existsSync(backup) && !Object.keys(data).length) await fs.rm(file, { force: true });
      else await writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
      cleaned.push(file);
    }
    await fs.rm(backup, { force: true });
  }
  if (existsSync(LEGACY_TOML)) {
    const text = await fs.readFile(LEGACY_TOML, 'utf8');
    if (TOML_SECTION.test(text)) {
      const next = text.replace(TOML_SECTION, '').replace(/\s*$/, '\n');
      if (!existsSync(`${LEGACY_TOML}.redline-backup`) && !next.trim()) await fs.rm(LEGACY_TOML, { force: true });
      else await writeAtomic(LEGACY_TOML, next);
      cleaned.push(LEGACY_TOML);
    }
    await fs.rm(`${LEGACY_TOML}.redline-backup`, { force: true });
  }
  try {
    const claudeConfig = JSON.parse(await fs.readFile(path.join(home, '.claude.json'), 'utf8'));
    if (claudeConfig?.mcpServers?.redline) {
      const claude = await which('claude');
      if (claude) { await runCommand(claude, ['mcp', 'remove', '--scope', 'user', 'redline']); cleaned.push('claude mcp'); }
    }
  } catch { /* no Claude Code config */ }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ at: new Date().toISOString(), cleaned }, null, 2));
  return { cleaned };
}

// ---------- Default app and taskbar ----------
const EXTENSIONS = ['.md', '.markdown', '.txt'];
async function defaultStatus() {
  if (process.platform !== 'win32') return { supported: false, extensions: {} };
  const extensions = {};
  for (const ext of EXTENSIONS) {
    const result = await runCommand('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`, '/v', 'ProgId']);
    const progId = /ProgId\s+REG_SZ\s+(\S+)/i.exec(result.stdout)?.[1] || '';
    let isRedline = /^Proofline\./i.test(progId);
    if (!progId) {
      // Without a user choice Windows falls back to the class registered for the extension.
      const fallback = await runCommand('reg', ['query', `HKCU\\Software\\Classes\\${ext}`, '/ve']);
      isRedline = /Proofline\./i.test(fallback.stdout);
    }
    extensions[ext] = { progId, isRedline };
  }
  return { supported: true, extensions, all: Object.values(extensions).every((item) => item.isRedline) };
}

function pinnedStatus() {
  if (process.platform !== 'win32') return { supported: false };
  const folder = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  try {
    return { supported: true, pinned: require('node:fs').readdirSync(folder).some((name) => /^Proofline.*\.lnk$/i.test(name)) };
  } catch { return { supported: true, pinned: false }; }
}

module.exports = { defaultStatus, pinnedStatus, removeLegacyConnections };
