// Renderer-side agent settings. Command-line AIs are detected (with a real
// --version handshake) by the desktop main process.

const SETTINGS_KEY = 'redline-agent-settings-v1';
const DEFAULTS = { lastAgent: null, lastScope: 'file', overrides: {}, customs: [], timeoutMinutes: 30 };

export function readAgentSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export async function writeAgentSettings(settings) {
  if (window.mengxDesktop?.system?.writeAgentSettings) await window.mengxDesktop.system.writeAgentSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function restoreAgentSettings() {
  if (!window.mengxDesktop?.system?.readAgentSettings) return;
  const stored = await window.mengxDesktop.system.readAgentSettings();
  if (stored) localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  else await writeAgentSettings(readAgentSettings());
}

export function customAgents(settings) {
  return (settings.customs || []).map((item) => ({ ...item, kind: 'custom', available: Boolean(item.template?.trim()), vendor: '' }));
}

export function agentLabel(agent) { return agent ? agent.name : ''; }
