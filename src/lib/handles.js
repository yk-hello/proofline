import { restoreDesktopFile } from '../desktop-files';

const HANDLE_DB_NAME = 'mengx-reader';
const HANDLE_STORE_NAME = 'file-handles';

export function persistFileHandle(key, handle) {
  if (handle?.desktop) { void window.mengxDesktop.remember(key, handle.id).catch(console.error); return; }
  if (!window.indexedDB || !handle) return;
  try {
    const request = window.indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
    request.onsuccess = () => {
      try {
        const transaction = request.result.transaction(HANDLE_STORE_NAME, 'readwrite');
        transaction.objectStore(HANDLE_STORE_NAME).put(handle, key);
      } catch { /* some browsers do not allow file handles in IndexedDB */ }
    };
  } catch { /* handle persistence is an enhancement; session access still works */ }
}

export function restoreFileHandle(key) {
  if (window.mengxDesktop) return restoreDesktopFile(key).catch(() => null);
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(HANDLE_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        try {
          const transaction = request.result.transaction(HANDLE_STORE_NAME, 'readonly');
          const getRequest = transaction.objectStore(HANDLE_STORE_NAME).get(key);
          getRequest.onsuccess = () => resolve(getRequest.result || null);
          getRequest.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}

export function forgetFileHandle(key) {
  if (window.mengxDesktop) { void window.mengxDesktop.forget(key).catch(console.error); return; }
  if (!window.indexedDB) return;
  const request = window.indexedDB.open(HANDLE_DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readwrite');
    transaction.objectStore(HANDLE_STORE_NAME).delete(key);
    transaction.oncomplete = () => database.close();
  };
}
