const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = (value) => createHash('sha256').update(value).digest('hex');

function installationDirectory({ packaged, executable, appPath, platform = process.platform, env = process.env }) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.REDLINE_DATA_DIR) return paths.resolve(env.REDLINE_DATA_DIR);
  if (!packaged) return paths.join(appPath, '.redline-data');
  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_DIR) return paths.join(env.PORTABLE_EXECUTABLE_DIR, 'ProoflineData');
  if (platform === 'darwin') {
    const bundle = executable.toLowerCase().lastIndexOf('.app/contents/');
    if (bundle >= 0) return paths.join(paths.dirname(executable.slice(0, bundle + 4)), 'ProoflineData');
  }
  return paths.join(paths.dirname(env.APPIMAGE || executable), 'ProoflineData');
}

class DataStore {
  constructor(root) { this.root = root; this.jobs = new Map(); this.error = null; }
  async init() {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, '.write-test-' + randomUUID());
      await fs.writeFile(probe, '', { flag: 'wx' }); await fs.unlink(probe);
      this.error = null;
    } catch (error) { this.error = error.message; }
    return this.status();
  }
  status() { return { path: this.root, writable: !this.error, error: this.error, fallbackFrom: this.fallbackFrom || null }; }
  async copyInto(root) {
    try { await fs.stat(this.root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    try { await fs.cp(this.root, root, { recursive: true, force: false, errorOnExist: true }); }
    catch (error) { throw new Error('无法迁移数据，请选择空目录: ' + error.message); }
  }
  target(group, id) {
    if (!/^[a-z-]+$/.test(group) || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('Invalid storage key');
    return path.join(this.root, group, id + '.json');
  }
  async read(group, id) {
    try { return JSON.parse(await fs.readFile(this.target(group, id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  write(group, id, value) {
    const target = this.target(group, id), previous = this.jobs.get(target) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const temporary = target + '.' + randomUUID() + '.tmp';
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const file = await fs.open(temporary, 'wx');
        try { await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await file.sync(); } finally { await file.close(); }
        try { await fs.copyFile(target, target + '.bak'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fs.rename(temporary, target); this.error = null;
        return { ok: true, path: target };
      } catch (error) { this.error = error.message; throw new Error('Cannot save to ' + this.root + ': ' + error.message); }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    });
    this.jobs.set(target, job);
    job.finally(() => { if (this.jobs.get(target) === job) this.jobs.delete(target); }).catch(() => {});
    return job;
  }
  key(filename) { return hash(process.platform === 'win32' ? filename.toLowerCase() : filename).slice(0, 32); }
  async marks(record) {
    const existing = await this.read('annotations', this.key(record.path));
    if (existing) return JSON.stringify(existing);
    // Match a document moved from another computer only when both name and bytes agree.
    const sourceHash = hash(await fs.readFile(record.path));
    const matches = (await this.list('annotations')).filter((item) => item.document === record.name && item.sourceHash === sourceHash);
    if (matches.length === 1) { await this.saveMarks(record, JSON.stringify(matches[0])); return JSON.stringify(matches[0]); }
    try { const legacy = await fs.readFile(record.path + '.redline.json', 'utf8'); await this.saveMarks(record, legacy); return legacy; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async saveMarks(record, text) {
    const data = text == null ? { redline: 1, marks: [] } : JSON.parse(text);
    const marks = Array.isArray(data) ? data : data.marks || data.annotations;
    if (!Array.isArray(marks)) throw new Error('Invalid marks JSON');
    return this.write('annotations', this.key(record.path), { redline: 1, document: record.name, sourcePath: record.path,
      sourceHash: hash(await fs.readFile(record.path)), updatedAt: new Date().toISOString(), marks });
  }
  async list(group) {
    let entries;
    try { entries = await fs.readdir(path.join(this.root, group)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const values = await Promise.all(entries.filter((entry) => entry.endsWith('.json')).map((entry) => this.read(group, entry.slice(0, -5)).catch(() => null)));
    return values.filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }
}
module.exports = { DataStore, installationDirectory, hash };
