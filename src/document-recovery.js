// IndexedDB keeps full drafts out of synchronous localStorage and out of source files.
// Per-document saved history is bounded; a pending draft is never evicted to meet a quota.
let database;
let queue = Promise.resolve();
function open() {
  if (!globalThis.indexedDB) return Promise.reject(Object.assign(new Error('Recovery storage unavailable'), { code: 'recovery-unavailable' }));
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('mengx-recovery-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function getRecovery(key) {
  await queue.catch(() => {});
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(key);
    request.onsuccess = () => resolve(request.result || { key, versions: [], draft: null });
    request.onerror = () => reject(request.error);
  });
}
export function storeRecovery(key, source, { saved = false, reason = 'autosave' } = {}) {
  const operation = queue.catch(() => {}).then(async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result || { key, versions: [], draft: null };
        if (saved) {
          if (record.versions.at(-1)?.source !== source) record.versions.push({ id: crypto.randomUUID(), source, at: Date.now(), reason });
          let bytes = record.versions.reduce((n, v) => n + v.source.length * 2, 0);
          while (record.versions.length > 1 && (record.versions.length > 8 || bytes > 32 * 1024 * 1024)) bytes -= record.versions.shift().source.length * 2;
          if (record.draft?.source === source) record.draft = null;
        } else record.draft = { source, at: Date.now(), reason };
        record.updatedAt = Date.now();
        store.put(record);
      };
      transaction.oncomplete = () => resolve({ ok: true });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Draft recovery storage unavailable'));
    });
  });
  queue = operation;
  return operation;
}

export async function recoveryVersions(key) {
  const record = await getRecovery(key);
  return { key, draft: record.draft ? { at: record.draft.at, length: record.draft.source.length } : null,
    versions: [...record.versions].reverse().map(({ id, at, reason, source }) => ({ id, at, reason, length: source.length })) };
}
