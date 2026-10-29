import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeDocument, searchDocument } from './document-model';

const cache = new Map();
const EMPTY = { outline: [], chunks: [], summary: '', wordCount: 0, title: '', lines: 0 };
const EMPTY_RESULTS = [];
export const needsProgressiveReading = (source) => source.length > 30000;

export function useDocumentPreparation(source, query = '', options = {}) {
  const large = needsProgressiveReading(source);
  const small = useMemo(() => large ? null : analyzeDocument(source), [source, large]);
  const [prepared, setPrepared] = useState(null);
  const [progress, setProgress] = useState(0);
  const [found, setFound] = useState(null);
  const [degraded, setDegraded] = useState(null);
  const [retry, setRetry] = useState(0);
  const workerRef = useRef(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const signature = JSON.stringify(options);
  const smallResults = useMemo(() => !large && query ? searchDocument(source, query, small, options) : [], [source, query, small, signature, large]);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const model = small || (prepared?.source === source ? prepared.model : cache.get(source)?.model) || null;

  useEffect(() => {
    if (!large) return;
    const cached = cache.get(source);
    setProgress(cached ? 100 : 0);
    setDegraded(null);
    const worker = cached?.worker || new Worker(new URL('./document.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    let disposed = false;
    let failed = false;
    function remember(model) {
      cache.delete(source);
      cache.set(source, { model, worker });
      while (cache.size > 2) {
        const oldest = cache.keys().next().value;
        cache.get(oldest).worker.terminate();
        cache.delete(oldest);
      }
    }
    function fallback(error) {
      if (disposed || failed) return;
      failed = true;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      const chunks = [];
      for (let start = 0; start < source.length; start += 12000) chunks.push({ start, end: Math.min(source.length, start + 12000), plain: true, height: 2000, headings: [] });
      setPrepared({ source, model: { ...EMPTY, chunks } });
      setDegraded({ source, message: error instanceof Error ? error.message : String(error || 'Document worker unavailable') });
      setFound(null);
      setProgress(100);
    }
    worker.onmessage = ({ data }) => {
      if (disposed || failed) return;
      if (data.type === 'progress') setProgress(data.value);
      if (data.type === 'model') {
        remember(data.model);
        setPrepared({ source, model: data.model });
        setProgress(100);
      }
      if (data.type === 'results' && data.query === queryRef.current && data.signature === signatureRef.current) setFound({ source, query: data.query, signature: data.signature, results: data.results });
      if (data.type === 'search-error' && data.query === queryRef.current && data.signature === signatureRef.current) setFound({ source, query: data.query, signature: data.signature, results: [], error: data.message });
      if (data.type === 'error') fallback(data.message);
    };
    worker.onerror = (event) => fallback(event.error || event.message);
    if (cached) remember(cached.model);
    else worker.postMessage({ type: 'analyze', source });
    return () => {
      disposed = true;
      worker.onmessage = null;
      worker.onerror = null;
      if (!cache.has(source)) worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [source, large, retry]);

  useEffect(() => {
    if (large && model && query && workerRef.current && !degraded) workerRef.current.postMessage({ type: 'search', query, options, signature });
  }, [large, model, query, signature, degraded]);
  return { ...model || EMPTY, ready: Boolean(model), progress, large,
    results: !large ? smallResults : found?.source === source && found.query === query && found.signature === signature ? found.results : EMPTY_RESULTS,
    searchError: degraded?.source === source ? 'document-index-unavailable' : found?.source === source && found.query === query && found.signature === signature ? found.error : null,
    degraded: degraded?.source === source ? degraded : null,
    retryPreparation: () => { cache.get(source)?.worker.terminate(); cache.delete(source); setPrepared(null); setRetry((value) => value + 1); },
    searching: Boolean(large && query && !degraded && (!found || found.source !== source || found.query !== query || found.signature !== signature)) };
}
