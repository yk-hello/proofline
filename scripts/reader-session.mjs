import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { invokePage } from './page-command.mjs';

export async function runSession(options = []) {
  if (options.includes('--desktop')) return (await import('./desktop-session.mjs')).runDesktopSession(options);
  const option = (name, fallback) => { const index = options.indexOf(name); return index >= 0 ? options[index + 1] : fallback; };
  const output = path.resolve(option('--output', 'test-fixtures/results/automation'));
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: !options.includes('--visible'),
    executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 }, acceptDownloads: true });
  const granted = new Set();
  const downloads = [];
  const downloadTasks = new WeakMap();
  const downloaded = [];
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    await page.exposeFunction('__mengxReadFile', async (filename) => {
      const target = path.resolve(filename);
      if (!granted.has(target)) throw new Error('Path was not explicitly opened by this session');
      return (await readFile(target)).toString('base64');
    });
    await page.exposeFunction('__mengxWriteFile', async (filename, source) => {
      const target = path.resolve(filename);
      if (!granted.has(target)) throw new Error('Path was not explicitly opened by this session');
      await writeFile(target, source, 'utf8');
    });
    await page.exposeFunction('__mengxDeleteFile', async (filename) => {
      const target = path.resolve(filename);
      if (!granted.has(target)) throw new Error('Path was not explicitly opened by this session');
      await unlink(target);
      granted.delete(target);
    });
    await page.addInitScript(() => {
      window.__mengxLocalFileHandle = (payload) => ({
        name: payload.name,
        __mengxPath: payload.path,
        isSameEntry: async (other) => payload.path === other?.__mengxPath,
        remove: async () => window.__mengxDeleteFile(payload.path),
        getFile: async () => {
          const base64 = await window.__mengxReadFile(payload.path);
          return new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], payload.name);
        },
        queryPermission: async () => 'granted',
        createWritable: async () => {
          let source;
          return { write: async (value) => { source = value; }, close: async () => window.__mengxWriteFile(payload.path, source) };
        },
      });
    });
    page.on('download', (download) => {
      const target = path.join(output, path.basename(download.suggestedFilename()));
      const task = download.saveAs(target).then(() => { downloaded.push(target); return target; });
      downloads.push(task);
      downloadTasks.set(download, task);
      task.catch((error) => send({ event: 'error', error: error.message }));
    });
    page.on('pageerror', (error) => send({ event: 'error', error: error.message }));
    await page.goto(process.env.READER_URL || 'http://127.0.0.1:5173/');
    await page.waitForFunction(() => Boolean(window.mengxReader));
    async function filePayload(filename) {
      const target = path.resolve(filename);
      const bytes = await readFile(target);
      granted.add(target);
      return { path: target, name: path.basename(target), base64: bytes.toString('base64') };
    }
    async function invoke(method, args = []) {
      if (method === 'openPath' || method === 'openReferencePath') {
        const payload = await filePayload(args[0]);
        return page.evaluate(async ({ payload, reference }) => {
          const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
          const file = new File([bytes], payload.name);
          if (reference) return window.mengxReader.openReference(file);
          const handle = window.__mengxLocalFileHandle(payload);
          return window.mengxReader.openFile({ file, path: payload.path, handle });
        }, { payload, reference: method === 'openReferencePath' });
      }
      if (method === 'openFolderPath') {
        const root = path.resolve(args[0]);
        const entries = [];
        async function visit(directory) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(filename);
            else if (entry.isFile() && /\.(md|markdown|mdown|mkd|txt|html?|docx|png|jpe?g|gif|svg|webp|avif)$/i.test(filename)) {
              entries.push({ ...(await filePayload(filename)), relative: path.relative(root, filename).replaceAll('\\', '/') });
            }
          }
        }
        await visit(root);
        return page.evaluate(({ entries, name }) => window.mengxReader.importWorkspace(entries.map((entry) => {
          const file = new File([Uint8Array.from(atob(entry.base64), (char) => char.charCodeAt(0))], entry.name);
          const handle = window.__mengxLocalFileHandle(entry);
          return { file, path: entry.relative, handle };
        }), { name }), { entries, name: path.basename(root) });
      }
      if (method === 'capture') {
        const filename = path.basename(args[0] || 'reader.png');
        const target = path.join(output, filename);
        await page.screenshot({ path: target });
        return { ok: true, path: target };
      }
      return invokePage(page, method, args);
    }
    send({ event: 'ready', version: await page.evaluate(() => window.mengxReader.version), output });
    function waitForDownload() {
      let listener, timer;
      const cleanup = () => { clearTimeout(timer); page.off('download', listener); };
      const promise = new Promise((resolve, reject) => {
        listener = (download) => { cleanup(); resolve(download); };
        page.on('download', listener);
        timer = setTimeout(() => { cleanup(); reject(new Error('Export download timed out')); }, 120000);
      });
      promise.catch(() => {});
      return { promise, cancel: cleanup };
    }
    const pending = new Set();
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      let command;
      try { command = JSON.parse(line); } catch (error) { send({ ok: false, error: error.message }); continue; }
      // Requests may overlap so cancelPdf and diagnostics stay usable during export.
      const task = (async () => {
        const download = command.method?.startsWith('export') ? waitForDownload() : null;
        try {
          const result = await invoke(command.method, command.args || []);
          if (download && result?.ok !== false) await downloadTasks.get(await download.promise);
          send({ id: command.id, ok: result?.ok !== false, result,
            ...(result?.ok === false ? { error: result.error, code: result.code } : {}),
            ...(command.method?.startsWith('export') ? { downloads: [...downloaded] } : {}) });
        } catch (error) { send({ id: command.id, ok: false, error: error.message, code: error.code || 'operation-failed' }); }
        finally { download?.cancel(); }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    await Promise.all(pending);
    await Promise.all(downloads);
  } finally { await browser.close(); }
}
