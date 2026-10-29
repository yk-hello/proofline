import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Fallback for hosts where npm install scripts or the default download route are unavailable.
const require = createRequire(import.meta.url);
const { version } = require('electron/package.json');
const checksums = require('electron/checksums.json');
const filename = `electron-v${version}-win32-x64.zip`;
const zip = path.resolve(process.argv[2]);
const digest = createHash('sha256').update(await readFile(zip)).digest('hex');
if (digest !== checksums[filename]) throw new Error('Electron runtime checksum mismatch');
const { extract } = require('@electron-internal/extract-zip');
const packageDirectory = path.dirname(require.resolve('electron/package.json'));
await extract(zip, { dir: path.join(packageDirectory, 'dist') });
await writeFile(path.join(packageDirectory, 'path.txt'), 'electron.exe');
console.log(`Verified and installed Electron ${version}`);
