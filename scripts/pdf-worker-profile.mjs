import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the bundled browser Worker under Node's CPU profiler without modifying input.
const output = path.resolve(process.env.PDF_PROFILE_OUTPUT || 'test-fixtures/results/native/pdf-profile');
await mkdir(output, { recursive: true });
const source = await readFile(process.argv[2] || 'test-fixtures/ai-report.md', 'utf8');
const assets = path.resolve('dist/assets');
const worker = (await readdir(assets)).find((file) => file.startsWith('pdf.worker-'));
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => String(url).startsWith('profile-font:')
  ? new Response(await readFile(process.env.PDF_PROFILE_FONT || 'public/fonts/NotoSansSC-Regular.ttf')) : nativeFetch(url, options);
const start = performance.now();
let complete;
const done = new Promise((resolve) => { complete = resolve; });
globalThis.self = { postMessage: async (data) => {
  if (data.type === 'progress') console.log(JSON.stringify({ ...data, elapsedMs: Math.round(performance.now() - start) }));
  if (data.type === 'diagram') setTimeout(() => self.onmessage({ data: { type: 'diagram-result', id: data.id, error: 'Profiler runs without a browser' } }), 0);
  if (data.type === 'error') { console.error(data); complete(); process.exitCode = 1; }
  if (data.type === 'done') {
    await writeFile(path.join(output, 'profile.pdf'), new Uint8Array(data.buffer));
    console.log(JSON.stringify({ pages: data.pages, stats: data.stats, elapsedMs: Math.round(performance.now() - start) })); complete();
  }
} };
await import(pathToFileURL(path.join(assets, worker)));
self.onmessage({ data: { source, title: 'PDF performance test', fontUrl: 'profile-font:', assets: [] } });
await done;
