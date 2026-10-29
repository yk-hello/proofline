// Desktop marks live in installation ProoflineData; legacy document sidecars are
// imported on first open. Web previews use browser storage.
// The reader keeps a synchronous in-memory cache and persists in the background.
import { ANNOTATIONS_KEY } from '../reading-annotations';

export const REDLINE_TYPES = ['fix', 'expand', 'delete', 'ask'];
export const PERSONAL_TYPES = ['highlight', 'underline', 'note', 'bookmark'];
export const MARK_TYPES = [...REDLINE_TYPES, ...PERSONAL_TYPES];
export const isRedline = (type) => REDLINE_TYPES.includes(type);
export const REDLINE_STATUS = ['open', 'sent', 'resolved', 'unchanged', 'answered', 'question'];
export const SIDECAR_VERSION = 1;
const BROWSER_KEY = 'redline-marks-v1';

export function sidecarName(name) { return `${name}.redline.json`; }

export function sortByPosition(items) {
  return [...items].sort((a, b) => (a.anchor?.sourceOffset ?? 0) - (b.anchor?.sourceOffset ?? 0));
}

/** Redlines numbered in document order, so prompts and the rail agree on #n. */
export function numberRedlines(items) {
  const numbers = new Map();
  sortByPosition(items.filter((item) => isRedline(item.type))).forEach((item, index) => numbers.set(item.id, index + 1));
  return numbers;
}

export function normalizeMark(item) {
  if (!item || typeof item !== 'object' || !MARK_TYPES.includes(item.type) || !item.anchor) return null;
  const mark = { ...item };
  mark.id = String(mark.id || crypto.randomUUID());
  mark.label = String(mark.label ?? mark.anchor.text ?? '').slice(0, 160);
  mark.note = String(mark.note ?? '').slice(0, 10000);
  mark.createdAt = Number(mark.createdAt) || Date.now();
  if (isRedline(mark.type)) mark.status = REDLINE_STATUS.includes(mark.status) ? mark.status : 'open';
  else delete mark.status;
  return mark;
}

export function serializeSidecar(name, items) {
  return JSON.stringify({ redline: SIDECAR_VERSION, document: name, updatedAt: new Date().toISOString(),
    marks: items.map(normalizeMark).filter(Boolean) }, null, 2) + '\n';
}

export function parseSidecar(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.marks;
  if (!Array.isArray(list)) throw new Error('Invalid Proofline sidecar');
  return list.map(normalizeMark).filter(Boolean);
}

function readJson(storage, key) {
  try { return JSON.parse(storage.getItem(key) || '{}') || {}; } catch { return {}; }
}

export class MarkStore {
  constructor({ storage = globalThis.localStorage, bridge = globalThis.window?.mengxDesktop } = {}) {
    this.storage = storage;
    this.bridge = bridge;
    this.cache = new Map();
    this.targets = new Map();
    this.timers = new Map();
    this.writes = new Map();
    this.listeners = new Set();
    this.states = new Map();
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(key) { for (const listener of this.listeners) listener(key); }

  get(key) { return this.cache.get(key) || []; }
  getSaveState(key) { return this.states.get(key) || { status: 'saved' }; }
  state(key, value) { this.states.set(key, value); this.emit(key); }

  /** Load marks for a document. `target` is { name, handle } where handle may be a desktop handle. */
  async load(key, target = {}) {
    this.targets.set(key, target);
    let items = null;
    let nativeMissing = false;
    if (target.handle?.desktop && this.bridge?.readSidecar) {
      try {
        const text = await this.bridge.readSidecar(target.handle.id);
        if (text) items = parseSidecar(text);
        else nativeMissing = true;
      } catch (error) { this.state(key, { status: 'error', error: error.message }); }
    }
    if (!items) {
      const browser = readJson(this.storage, BROWSER_KEY)[key];
      if (Array.isArray(browser)) items = browser.map(normalizeMark).filter(Boolean);
    }
    let migrated = nativeMissing && Boolean(items?.length);
    if (!items) {
      // Earlier versions stored reading marks in the app profile only.
      const legacy = readJson(this.storage, ANNOTATIONS_KEY)[key];
      if (Array.isArray(legacy) && legacy.length) { items = legacy.map(normalizeMark).filter(Boolean); migrated = true; }
    }
    // A load must not overwrite marks changed while it was in flight.
    if (this.timers.has(key) || this.writes.has(key) || (this.cache.has(key) && this.getSaveState(key).status === 'error')) return this.get(key);
    this.cache.set(key, items || []);
    if (migrated) this.schedule(key);
    this.emit(key);
    return this.get(key);
  }

  set(key, items) {
    this.cache.set(key, items.map(normalizeMark).filter(Boolean));
    this.schedule(key);
    this.emit(key);
  }

  schedule(key) {
    this.state(key, { status: 'saving' });
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.persist(key).catch(() => {}); }, 250));
  }

  async flush() {
    for (const [key, timer] of this.timers) { clearTimeout(timer); this.timers.delete(key); void this.persist(key).catch(() => {}); }
    await Promise.all([...this.writes.values()]);
    if ([...this.states.values()].some((state) => state.status === 'error')) throw new Error('有标记未保存，请检查数据目录权限');
  }

  persist(key) {
    const previous = this.writes.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const items = this.get(key), target = this.targets.get(key) || {};
      if (target.handle?.desktop && this.bridge?.writeSidecar) {
        const result = await this.bridge.writeSidecar(target.handle.id, serializeSidecar(target.name || target.handle.name, items));
        this.state(key, { status: 'saved', path: result.path, at: Date.now() });
        return;
      }
      const all = readJson(this.storage, BROWSER_KEY);
      if (items.length) all[key] = items; else delete all[key];
      this.storage.setItem(BROWSER_KEY, JSON.stringify(all));
      this.state(key, { status: 'saved', browser: true, at: Date.now() });
    }).catch((error) => { this.state(key, { status: 'error', error: error.message }); throw error; });
    this.writes.set(key, task);
    task.finally(() => { if (this.writes.get(key) === task) this.writes.delete(key); }).catch(() => {});
    return task;
  }

  /** Re-read a sidecar that an agent or another tool changed on disk. */
  async reload(key) {
    if (this.timers.has(key) || this.writes.has(key) || this.getSaveState(key).status === 'error') return this.get(key);
    const target = this.targets.get(key);
    if (!target?.handle?.desktop || !this.bridge?.readSidecar) return this.get(key);
    try {
      const text = await this.bridge.readSidecar(target.handle.id);
      const items = text ? parseSidecar(text) : [];
      if (JSON.stringify(items) !== JSON.stringify(this.get(key))) { this.cache.set(key, items); this.emit(key); }
    } catch { /* keep the in-memory copy */ }
    return this.get(key);
  }

  rename(fromKey, toKey) {
    if (!this.cache.has(fromKey)) return;
    this.cache.set(toKey, this.cache.get(fromKey));
    this.cache.delete(fromKey);
  }
}

export const markStore = new MarkStore();
