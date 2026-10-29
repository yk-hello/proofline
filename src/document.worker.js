import { analyzeDocument, searchDocument } from './document-model';
let source = '', model = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'analyze') {
      source = data.source;
      model = analyzeDocument(source, (value) => self.postMessage({ type: 'progress', value }));
      self.postMessage({ type: 'model', model });
    } else if (data.type === 'search' && model) {
      self.postMessage({ type: 'results', query: data.query, signature: data.signature, results: searchDocument(source, data.query, model, data.options) });
    }
  } catch (error) { self.postMessage({ type: data.type === 'search' ? 'search-error' : 'error', query: data.query, signature: data.signature, code: error.code, message: error.message }); }
};
