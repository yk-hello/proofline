import { useEffect, useLayoutEffect, useRef } from 'react';

export const API_VERSION = '1.1.0';

export function readerErrorCode(error) {
  if (typeof error?.code === 'string') return error.code;
  const aliases = { 'external-file-change': 'file-conflict', 'permission-required': 'permission-denied' };
  if (aliases[error?.error]) return aliases[error.error];
  if (/^[a-z][a-z0-9-]+$/.test(error?.error || '')) return error.error;
  return ({ TypeError: 'invalid-argument', RangeError: 'out-of-range', AbortError: 'cancelled',
    TimeoutError: 'timeout', NotAllowedError: 'permission-denied', NotFoundError: 'file-not-found' })[error?.name] || 'operation-failed';
}

// A stable facade lets callers keep an API reference across React renders.
export function useReaderApi(handlers, state) {
  const latest = useRef(handlers);
  const currentState = useRef(state);
  useLayoutEffect(() => { latest.current = handlers; currentState.current = state; });
  useEffect(() => {
    const names = Object.keys(latest.current);
    const fail = (error) => { Object.defineProperty(error, 'code', { value: readerErrorCode(error), configurable: true }); throw error; };
    const normalize = (result) => result?.ok === false ? { ...result, code: result.cancelled ? 'cancelled' : readerErrorCode(result), revision: result.revision ?? currentState.current.document.revision } : result;
    const api = Object.fromEntries(names.map((name) => [name, (...args) => {
      try {
        const result = latest.current[name](...args);
        return result?.then ? result.then(normalize).catch(fail) : normalize(result);
      } catch (error) { return fail(error); }
    }]));
    api.version = API_VERSION;
    api.describe = () => ({ version: API_VERSION, methods: [...names, 'describe', 'invoke'],
      capabilities: ['documents', 'navigation', 'search', 'annotations', 'annotation-history', 'source-view', 'document-links', 'recovery', 'split-reading', 'pdf-export', 'preferences', 'diagnostics'],
      offsets: 'utf16', revision: 'session-monotonic', localFiles: 'explicit-grants',
      errors: ['unknown-command', 'invalid-argument', 'out-of-range', 'reading-locked', 'revision-conflict', 'file-conflict', 'file-not-found',
        'permission-denied', 'file-handle-unavailable', 'format-not-supported', 'write-failed', 'recovery-unavailable',
        'invalid-search', 'invalid-regex', 'unsafe-regex', 'nothing-to-undo', 'nothing-to-redo', 'annotation-orphaned', 'history-empty',
        'busy', 'cancelled', 'timeout', 'operation-failed'] });
    api.invoke = (method, args = []) => {
      if (!Object.hasOwn(api, method) || typeof api[method] !== 'function' || method === 'invoke') {
        throw Object.assign(new TypeError(`Unknown reader command: ${method}`), { code: 'unknown-command' });
      }
      if (!Array.isArray(args)) throw Object.assign(new TypeError('Command args must be an array'), { code: 'invalid-argument' });
      return api[method](...args);
    };
    window.prooflineReader = api;
    window.mengxReader = api;
    const onCommand = async ({ detail = {} }) => {
      try {
        const result = await api.invoke(detail.method || detail.command, detail.args ?? []);
        window.dispatchEvent(new CustomEvent('mengx-reader:result', {
          detail: { id: detail.id, ok: result?.ok !== false, result, ...(result?.ok === false ? { error: result.error || result.code, code: result.code } : {}) },
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('mengx-reader:result', {
          detail: { id: detail.id, ok: false, error: error.message, code: readerErrorCode(error) },
        }));
      }
    };
    window.addEventListener('mengx-reader:command', onCommand);
    return () => {
      window.removeEventListener('mengx-reader:command', onCommand);
      if (window.prooflineReader === api) delete window.prooflineReader;
      if (window.mengxReader === api) delete window.mengxReader;
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mengx-reader:changed', { detail: state }));
  }, [state]);
}

export async function waitForReader(test, { timeoutMs = 30000 } = {}) {
  const deadline = performance.now() + timeoutMs;
  do {
    // Give state updates and worker results a chance to commit before observing.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const result = test(window.mengxReader);
    if (result) return result;
  } while (performance.now() < deadline);
  throw new DOMException('Reader operation timed out', 'TimeoutError');
}

export function pageOf(items, { offset = 0, limit = 100 } = {}) {
  offset = Math.max(0, Math.trunc(Number(offset) || 0));
  limit = Math.min(1000, Math.max(1, Math.trunc(Number(limit) || 100)));
  return { total: items.length, offset, items: items.slice(offset, offset + limit) };
}
