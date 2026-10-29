const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const documents = /\.(md|markdown|mdown|mkd|txt|html?|docx)$/i;
const images = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};

class NativeFiles {
  constructor(storePath, trashItem, dataStore = null) {
    this.storePath = storePath;
    this.trashItem = trashItem;
    this.records = new Map();
    this.recents = new Map();
    this.tokens = new Map();
    this.writes = new Map();
    this.persistence = Promise.resolve();
    this.dataStore = dataStore;
  }

  async init() {
    try {
      const data = JSON.parse(await fs.readFile(this.storePath, 'utf8'));
      for (const [key, filename] of Object.entries(data.recents || {})) {
        if (typeof filename === 'string' && path.isAbsolute(filename)) this.recents.set(key, filename);
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }

  async grant(filename, root = null) {
    const target = await fs.realpath(path.resolve(filename));
    const stat = await fs.stat(target);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported file type');
    if (root && !inside(root, target)) throw new Error('Path is outside the opened directory');
    const kind = stat.isDirectory() ? 'directory' : 'file';
    if (kind === 'file' && !documents.test(target)) throw new Error('Unsupported document format');
    const existing = [...this.records.values()].find((record) => record.path === target && record.root === root);
    if (existing) return existing;
    const record = { id: randomUUID(), kind, path: target, name: path.basename(target), root: root || (kind === 'directory' ? target : null) };
    this.records.set(record.id, record);
    return record;
  }

  async get(id, kind) {
    const record = this.records.get(id);
    if (!record || (kind && record.kind !== kind)) throw new Error('File access was not granted');
    const canonical = await fs.realpath(record.path);
    if (canonical !== record.path) throw new Error('The file location has changed; open it again');
    return record;
  }

  async read(id) {
    const record = await this.get(id, 'file');
    const [bytes, stat] = await Promise.all([fs.readFile(record.path), fs.stat(record.path)]);
    return { bytes: new Uint8Array(bytes), name: record.name, lastModified: stat.mtimeMs };
  }

  async metadata(id) {
    const record = await this.get(id, 'file');
    const stat = await fs.stat(record.path);
    return { size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs, identity: stat.ino };
  }

  write(id, source, expected) {
    if (typeof source !== 'string' || typeof expected !== 'string') throw new TypeError('A source and baseline are required');
    const record = this.records.get(id);
    if (!record || !/\.(md|markdown|mdown|mkd|txt)$/i.test(record.path)) throw new Error('This format cannot be saved to its source');
    const previous = this.writes.get(record.path) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      await this.get(id, 'file');
      const bytes = await fs.readFile(record.path);
      const current = new TextDecoder().decode(bytes);
      if (current !== expected) throw new Error('external-file-change');
      const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const temporary = path.join(path.dirname(record.path), `.${record.name}.${randomUUID()}.tmp`);
      let file;
      try {
        file = await fs.open(temporary, 'wx', (await fs.stat(record.path)).mode);
        await file.writeFile((hasBom ? '\ufeff' : '') + source, 'utf8');
        await file.sync();
        await file.close();
        file = null;
        // Check again after writing the temporary file, before replacing the source.
        if (new TextDecoder().decode(await fs.readFile(record.path)) !== expected) throw new Error('external-file-change');
        await fs.rename(temporary, record.path);
      } finally {
        await file?.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
      return { ok: true, path: record.path };
    });
    this.writes.set(record.path, task);
    task.finally(() => { if (this.writes.get(record.path) === task) this.writes.delete(record.path); }).catch(() => {});
    return task;
  }

  async list(id) {
    const record = await this.get(id, 'directory');
    const entries = await fs.readdir(record.path, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !(entry.isFile() && documents.test(entry.name)))) continue;
      try { result.push(await this.grant(path.join(record.path, entry.name), record.root)); }
      catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    }
    return result.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : a.kind === 'directory' ? -1 : 1));
  }

  async complete(filename) {
    if (typeof filename !== 'string' || filename.includes('\0') || !path.isAbsolute(filename)) return [];
    const normalized = path.resolve(filename);
    const trailing = /[\\/]$/.test(filename);
    const parent = trailing ? normalized : path.dirname(normalized);
    const prefix = trailing ? '' : path.basename(normalized).toLowerCase();
    const recent = [...new Set(this.recents.values())].filter((target) => target.toLowerCase().startsWith(normalized.toLowerCase()))
      .map((target) => ({ name: path.basename(target), path: target, kind: 'file' }));
    const roots = [...this.records.values()].filter((record) => record.kind === 'directory').map((record) => record.root);
    let canonical;
    try { canonical = await fs.realpath(parent); } catch { return recent.slice(0, 40); }
    if (!roots.some((root) => inside(root, canonical))) return recent.slice(0, 40);
    const entries = await fs.readdir(canonical, { withFileTypes: true });
    return entries.filter((entry) => !entry.isSymbolicLink() && entry.name.toLowerCase().startsWith(prefix) &&
      (entry.isDirectory() || (entry.isFile() && documents.test(entry.name))))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .slice(0, 40).map((entry) => ({ name: entry.name, path: path.join(canonical, entry.name), kind: entry.isDirectory() ? 'directory' : 'file' }));
  }

  async persist(key, id) {
    const record = await this.get(id, 'file');
    this.recents.set(key, record.path);
    await this.persistStore();
  }

  async restore(key) {
    const filename = this.recents.get(key);
    return filename ? this.grant(filename) : null;
  }

  async forget(key) {
    this.recents.delete(key);
    await this.persistStore();
  }

  persistStore() {
    this.persistence = this.persistence.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });
      const temporary = this.storePath + '.tmp';
      await fs.writeFile(temporary, JSON.stringify({ recents: Object.fromEntries(this.recents) }), 'utf8');
      await fs.rename(temporary, this.storePath);
    });
    return this.persistence;
  }

  async prepareTrash(id) {
    const record = await this.get(id, 'file');
    const token = randomUUID();
    this.tokens.set(token, { id, path: record.path, expires: Date.now() + 10 * 60 * 1000 });
    return { token };
  }

  async trash(id, token) {
    const confirmation = this.tokens.get(token);
    this.tokens.delete(token);
    const record = await this.get(id, 'file');
    if (!confirmation || confirmation.id !== id || confirmation.path !== record.path || confirmation.expires < Date.now()) throw new Error('confirmation-required');
    await this.writes.get(record.path);
    await this.trashItem(record.path);
    for (const [recordId, entry] of this.records) if (entry.path === record.path) this.records.delete(recordId);
    for (const [key, filename] of this.recents) if (filename === record.path) this.recents.delete(key);
    await this.persistStore();
    return { ok: true, recycled: true };
  }

  async readSidecar(id) {
    const record = await this.get(id, 'file');
    if (this.dataStore) return this.dataStore.marks(record);
    try { return await fs.readFile(`${record.path}.redline.json`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async writeSidecar(id, text) {
    const record = await this.get(id, 'file');
    if (this.dataStore) return this.dataStore.saveMarks(record, text);
    const target = `${record.path}.redline.json`;
    if (text === null || text === undefined) { await fs.rm(target, { force: true }); return { ok: true, removed: true }; }
    if (typeof text !== 'string' || text.length > 32 * 1024 * 1024) throw new TypeError('Invalid sidecar');
    JSON.parse(text);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, text, 'utf8'); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return { ok: true, path: target };
  }

  async saveImage(id, data) {
    const record = await this.get(id, 'file');
    const bytes = Buffer.from(data);
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('图片必须小于 16 MB');
    const head = bytes.subarray(0, 12), hex = head.toString('hex');
    const ext = hex.startsWith('89504e470d0a1a0a') ? 'png' : hex.startsWith('ffd8ff') ? 'jpg'
      : /^GIF8[79]a/.test(head.toString()) ? 'gif' : head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!ext) throw new Error('请使用 PNG、JPEG、GIF 或 WebP 图片');
    const name = require('node:crypto').createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '.' + ext;
    const dir = path.join(path.dirname(record.path), record.name + '.assets');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, name);
    try { await fs.writeFile(target, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { ok: true, path: target, source: encodeURIComponent(record.name + '.assets').replace(/[()]/g, (value) => '%' + value.charCodeAt(0).toString(16)) + '/' + name, bytes: bytes.length };
  }

  async handoff(id, task, marks) {
    const record = await this.get(id, 'file');
    if (!this.dataStore) throw new Error('Storage unavailable');
    const dir = path.join(this.dataStore.root, 'handoffs', randomUUID());
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(record.path, path.join(dir, record.name));
    await fs.writeFile(path.join(dir, 'TASK.md'), task, 'utf8');
    await fs.writeFile(path.join(dir, 'annotations.json'), marks, 'utf8');
    const assets = record.path + '.assets';
    try { await fs.cp(assets, path.join(dir, record.name + '.assets'), { recursive: true, dereference: false }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(path.join(dir, 'README.txt'), 'Proofline portable task\n1. Copy this entire folder to the other device.\n2. Install and log in to an AI CLI on that device, or open the document and TASK.md in your desktop AI.\n3. Ask it to follow TASK.md and edit the document.\n4. In Proofline, choose Other AI / device, then import the revised Markdown for review.\nCredentials and CLI executable paths are never transferred.\n', 'utf8');
    return { ok: true, path: dir };
  }

  async resource(id, source) {
    const record = await this.get(id, 'file');
    if (typeof source !== 'string' || source.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(source)) throw new Error('Invalid local image reference');
    const target = await fs.realpath(path.resolve(path.dirname(record.path), source.replaceAll('/', path.sep)));
    if (!images.test(target) || !(await fs.stat(target)).isFile()) throw new Error('Unsupported image');
    return target;
  }
}

module.exports = { NativeFiles, inside };
