export class DocumentWriter {
  constructor(onChange) {
    this.onChange = onChange;
    this.handles = new Map();
    this.baselines = new Map();
    this.jobs = new Map();
    this.states = new Map();
    this.blocked = new Set();
  }

  register(key, handle, source) {
    this.handles.set(key, handle);
    this.baselines.set(key, source);
    this.blocked.delete(key);
    this.states.delete(key);
  }

  change(key, state) {
    this.states.set(key, state);
    this.onChange(key, state);
  }

  save(snapshot, { requestPermission = false } = {}) {
    const previous = this.jobs.get(snapshot.key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const { key, source, version } = snapshot;
      if (this.blocked.has(key)) {
        this.change(key, { status: 'session', version, error: 'file-deleted' });
        return { ok: false, error: 'file-deleted' };
      }
      const handle = this.handles.get(key);
      if (!['MD', 'TXT'].includes(snapshot.kind) || !handle?.createWritable) {
        this.change(key, { status: 'session', version });
        return { ok: false, error: handle ? 'format-not-supported' : 'file-handle-unavailable' };
      }
      let writable;
      try {
        let permission = await handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
        if (permission !== 'granted' && requestPermission && handle.requestPermission) permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          this.change(key, { status: 'permission', version, error: 'permission-required' });
          return { ok: false, error: 'permission-required' };
        }
        this.change(key, { status: 'saving', version });
        const disk = await (await handle.getFile()).text();
        if (this.baselines.has(key) && disk !== this.baselines.get(key)) {
          this.change(key, { status: 'conflict', version, error: 'external-file-change' });
          return { ok: false, error: 'external-file-change' };
        }
        writable = await handle.createWritable();
        await writable.write(source);
        await writable.close();
        this.baselines.set(key, source);
        this.change(key, { status: 'saved', version, source, at: Date.now() });
        return { ok: true, name: snapshot.name, path: snapshot.path, bytes: new Blob([source]).size };
      } catch (error) {
        try { await writable?.abort?.(); } catch { /* keep the original write error */ }
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('external-file-change')) {
          this.change(snapshot.key, { status: 'conflict', version: snapshot.version, error: 'external-file-change' });
          return { ok: false, error: 'external-file-change' };
        }
        this.change(snapshot.key, { status: 'error', version: snapshot.version, error: message });
        return { ok: false, error: 'write-failed', message };
      }
    });
    this.jobs.set(snapshot.key, task);
    task.finally(() => { if (this.jobs.get(snapshot.key) === task) this.jobs.delete(snapshot.key); });
    return task;
  }

  async block(key) {
    this.blocked.add(key);
    await this.jobs.get(key);
  }
}
