#!/usr/bin/env node
// stetwise-review <file.md> [--timeout <minutes>]
//
// For an AI working in a terminal. It opens the file in Stetwise and waits. The user marks
// what should change and sends the instructions back; this command prints them and ends.
// The AI then edits the file, and Stetwise shows each change next to what was asked for.
//
// The request travels as a folder in the system temp directory: this command writes
// request.json into it and starts (or reaches) the app with --review-request <folder>; the
// app writes reply.md and then done.json. Nothing listens on a port.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EXIT = { ok: 0, usage: 64, timeout: 2, closed: 3 };
const args = process.argv.slice(2);
function fail(message, code) { process.stderr.write(`stetwise-review: ${message}\n`); process.exit(code); }

let file = null, minutes = 60;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--timeout') minutes = Number(args[++index]);
  else if (args[index] === '--help' || args[index] === '-h') { process.stdout.write('Usage: stetwise-review <file.md> [--timeout <minutes>]\nOpens the file in Stetwise, waits for the review, and prints the instructions.\n'); process.exit(EXIT.ok); }
  else if (!file) file = args[index];
}
if (!file) fail('give the Markdown file to review, for example: stetwise-review plan.md', EXIT.usage);
if (!(minutes > 0)) fail('--timeout takes a number of minutes', EXIT.usage);
file = path.resolve(file);
if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`no such file: ${file}`, EXIT.usage);
if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(file)) fail('Stetwise reviews Markdown and text files (.md, .markdown, .txt)', EXIT.usage);

// Started by the launcher next to the app, this runs inside the app's own executable.
// STETWISE_APP (and STETWISE_APP_ARGS, a JSON array) name another one, for development and tests.
const executable = process.env.STETWISE_APP || (process.versions.electron ? process.execPath : null);
if (!executable) fail('Stetwise was not found. Run the stetwise-review launcher that is installed next to the app, or set STETWISE_APP to its executable.', EXIT.usage);
let extra = [];
try { extra = process.env.STETWISE_APP_ARGS ? JSON.parse(process.env.STETWISE_APP_ARGS) : []; } catch { fail('STETWISE_APP_ARGS must be a JSON array', EXIT.usage); }

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stetwise-review-'));
const cleanUp = () => { try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* left for the system to clear */ } };
fs.writeFileSync(path.join(folder, 'request.json'), JSON.stringify({ file, pid: process.pid, created: new Date().toISOString() }));

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;   // the app must start as the app
try {
  spawn(executable, [...extra, file, '--review-request', folder], { detached: true, stdio: 'ignore', env: environment, windowsHide: false }).unref();
} catch (error) { cleanUp(); fail(`could not start Stetwise: ${error.message}`, EXIT.usage); }
process.stderr.write(`Opened ${file} in Stetwise. Waiting for the review (up to ${minutes} min)...\n`);

const deadline = Date.now() + minutes * 60 * 1000;
const done = path.join(folder, 'done.json');
const timer = setInterval(() => {
  if (fs.existsSync(done)) {
    clearInterval(timer);
    let status = 'none', reply = '';
    try { status = JSON.parse(fs.readFileSync(done, 'utf8')).status; } catch { /* treated as nothing asked */ }
    try { reply = fs.readFileSync(path.join(folder, 'reply.md'), 'utf8'); } catch { /* no notes */ }
    cleanUp();
    if (status === 'closed') fail('Stetwise was closed before the review was sent. Ask the user whether to try again.', EXIT.closed);
    process.stdout.write(reply.endsWith('\n') ? reply : reply + '\n');
    process.exit(EXIT.ok);
  }
  if (Date.now() > deadline) { clearInterval(timer); cleanUp(); fail(`no review after ${minutes} minutes. The file is still open in Stetwise; run the command again to keep waiting.`, EXIT.timeout); }
}, 400);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); cleanUp(); process.exit(130); });
