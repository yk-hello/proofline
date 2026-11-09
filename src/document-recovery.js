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
export const MAX_VERSIONS = 30;
export function storeRecovery(key, source, { saved = false, reason = 'autosave', coalesceMs = 0 } = {}) {
  const operation = queue.catch(() => {}).then(async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result || { key, versions: [], draft: null };
        if (saved) {
          const last = record.versions.at(-1);
          // A burst of outside writes (an AI saving after every edit) becomes one version.
          if (last && coalesceMs && last.reason === reason && Date.now() - last.at < coalesceMs) {
            Object.assign(last, { source, at: Date.now() });
            // Undo then redo can land back on the version before: keep one copy.
            if (record.versions.at(-2)?.source === source) record.versions.pop();
          }
          else if (last?.source !== source) record.versions.push({ id: crypto.randomUUID(), source, at: Date.now(), reason });
          let bytes = record.versions.reduce((n, v) => n + v.source.length * 2, 0);
          while (record.versions.length > 1 && (record.versions.length > MAX_VERSIONS || bytes > 32 * 1024 * 1024)) bytes -= record.versions.shift().source.length * 2;
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

/** Keep an unfinished review (decisions included) so it survives closing the window. */
export function storePendingReview(key, review) {
  const operation = queue.catch(() => {}).then(async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result || { key, versions: [], draft: null };
        if (review) record.review = { ...review, at: Date.now() }; else delete record.review;
        store.put(record);
      };
      transaction.oncomplete = () => resolve({ ok: true });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Review storage unavailable'));
    });
  });
  queue = operation;
  return operation;
}

export async function getPendingReview(key) {
  return (await getRecovery(key)).review || null;
}

export async function versionSource(key, id) {
  const record = await getRecovery(key);
  return (id === 'draft' ? record.draft : record.versions.find((entry) => entry.id === id))?.source ?? null;
}

export async function recoveryVersions(key) {
  const record = await getRecovery(key);
  return { key, draft: record.draft ? { at: record.draft.at, length: record.draft.source.length } : null,
    versions: [...record.versions].reverse().map(({ id, at, reason, source }) => ({ id, at, reason, length: source.length })) };
}
