// Simulated CLI processes verify our contracts, not vendor login/model access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { CLI_ADAPTERS, AgentRunner, detect, runCommand, validateArgs, connectionArgs, responseReady, diagnose, redactOutput } = require('../electron/agents.cjs');
const { DataStore } = require('../electron/data-store.cjs');
const root = path.resolve('test-fixtures/results/cli-matrix-' + Date.now());
await mkdir(root, { recursive: true });
const store = new DataStore(path.join(root, 'ProoflineData')); await store.init();
// Independent fixture option spellings, including deliberate prefix traps.
const contracts = {
  'claude-code': '-p --permission-mode --allowedTools',
  codex: '--skip-git-repo-check --sandbox --json',
  gemini: '-p --approval-mode --output-format --skip-trust',
  qwen: '-p --approval-mode', kimi: '--print --prompt', iflow: '-p --yolo',
  codebuddy: '-p -y --permission-mode', 'qoder-cli': '-p --permission-mode',
  opencode: '', 'cursor-agent': '-p --force', copilot: '-p --allow-all-tools',
  aider: '--message --message-file --yes --no-git --no-auto-commits',
};
await writeFile(path.join(root, 'contracts.json'), JSON.stringify(contracts));
function simulated() {
  const fs = require('node:fs'), path = require('node:path');
  const contracts = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts.json'), 'utf8'));
  const [id, ...args] = process.argv.slice(2);
  if (args.includes('--version')) { console.log(id + ' 9.9.9-simulated'); process.exit(0); }
  if (args.includes('--help')) { console.log('Options: --version --help ' + contracts[id]); process.exit(0); }
  if (id === 'codex' && args[0] === 'login') { console.log('Logged in (simulation)'); process.exit(0); }
  const flags = new Set((contracts[id] || '').split(' '));
  for (const arg of args) if (/^--?[A-Za-z]/.test(arg) && !flags.has(arg)) { console.error('Unknown option ' + arg); process.exit(2); }
  if (args.some(arg => arg.startsWith('Reply with exactly REDLINE_READY.'))) {
    console.log(id === 'gemini' ? JSON.stringify({type:'message', role:'assistant', content:'REDLINE_READY'}) : 'REDLINE_READY'); process.exit(0);
  }
  const prompt = args.find(arg => arg.startsWith('Read the file '));
  const taskIndex = args.indexOf('--message-file');
  const taskPath = taskIndex >= 0 ? args[taskIndex+1] : path.resolve(prompt.match(/^Read the file (.+?) in the current directory/)[1]);
  const task = fs.readFileSync(taskPath, 'utf8');
  const filename = task.match(/^Document: (.+)$/m)[1];
  const file = path.resolve(filename);
  if (!fs.existsSync(file) || !task.includes('Change 10 to 20.')) throw Error('Invalid task handoff');
  if (id === 'aider' && !args.includes(file)) throw Error('Aider missing document argument');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('cost is 10', 'cost is 20'));
  fs.writeFileSync('.argv.json', JSON.stringify({args,taskPath,file,cwd:process.cwd()}));
  const bytes = Buffer.from('中文完成 ✓\n'); process.stdout.write(bytes.subarray(0,2)); setTimeout(()=>process.stdout.write(bytes.subarray(2)),20);
}
const program = path.join(root, 'simulated-cli.cjs');
await writeFile(program, '(' + simulated.toString() + ')();');
const overrides = {};
for (const id of Object.keys(contracts)) {
  const file = path.join(root, id + (process.platform === 'win32' ? '.cmd' : ''));
  if (process.platform === 'win32') await writeFile(file, '@echo off\r\n' + '"' + process.execPath + '" "' + program + '" ' + id + ' %*\r\n');
  else await writeFile(file, '#!/bin/sh\nexec "' + process.execPath + '" "' + program + '" ' + id + ' "$@"\n', { mode: 0o755 });
  overrides[id] = { path: file };
}
assert.equal(validateArgs(['--yes'], '--yes-always').ok, false);
assert.equal(validateArgs(['-p'], '--prompt').ok, false);
assert.equal(validateArgs(['--sandbox=workspace-write'], '--sandbox <MODE>').ok, true);
assert.equal(validateArgs(['--json'], '').ok, false);
assert.equal(responseReady(JSON.stringify({type:'message', role:'user', content:'REDLINE_READY'})), false);
assert.equal(responseReady('Error: expected REDLINE_READY, got nothing'), false);
assert.equal(redactOutput('sample-secret', { TEST_API_KEY: 'sample-secret' }), '[redacted]');
const items = await detect(overrides, { refresh: true });
const matrix = [];
for (const adapter of CLI_ADAPTERS) {
  const item = items.find(item => item.id === adapter.id);
  assert.ok(item.available && item.compatibility.ok && item.probeCompatibility.ok, JSON.stringify(item));
  const probe = await runCommand(item.path, connectionArgs(item), { cwd: root });
  assert.ok(probe.ok && responseReady(probe.stdout), adapter.id + ': connection contract');
  const documentPath = path.join(root, 'matrix 中文 document.md'), source = '# Matrix\n\nThe cost is 10.\n';
  await writeFile(documentPath, source);
  let runner;
  const done = new Promise(resolve => { runner = new AgentRunner((event, data) => { if (event === 'agents:done') resolve(data); }, {store}); });
  const options = { adapterId: adapter.id, documentPath, task: '# Task\n\nDocument: ' + path.basename(documentPath) + '\n\nChange 10 to 20.\n', overrides };
  const starting = runner.run(options);
  await assert.rejects(runner.run(options), /已有任务/);
  const started = await starting, result = await done;
  assert.equal(result.code, 0, result.output);
  assert.equal(result.proposed, source.replace('10', '20'));
  assert.equal(await readFile(documentPath, 'utf8'), source);
  assert.match(result.output, /中文完成 ✓/);
  const argv = JSON.parse(await readFile(path.join(started.cwd, '.argv.json'), 'utf8'));
  assert.ok(argv.taskPath && argv.args.every(arg => !/\{(?:file|task|prompt|dir)\}/.test(arg)));
  assert.equal((await store.read('runs', started.id)).status, 'done');
  matrix.push({id:adapter.id, evidence:'simulated-process', version:item.version, probe:true, task:true, utf8:true, originalUnchanged:true});
}
for (const [text, code] of [['Not logged in','login-required'], ['unknown option --old','arguments'], ['fetch failed ECONNRESET','network'], ['429 rate limit quota','quota'], ['EACCES permission denied','permission']]) assert.equal(diagnose(text, {code:1}).code, code);
const missing = await runCommand(path.join(root, 'missing.exe'), [], {timeout:1000}); assert.equal(missing.ok, false);
const noSource = new DataStore(path.join(root, 'does-not-exist')); await noSource.copyInto(path.join(root, 'new-storage'));
const silent = path.join(root, 'silent.cjs'); await writeFile(silent, 'setInterval(()=>{},1000);');
async function lifecycle({ timeoutMinutes, cancelOnWaiting }) {
  const events = []; let runner;
  const done = new Promise(resolve => { runner = new AgentRunner((event,data) => { events.push({event,data}); if (cancelOnWaiting && event === 'agents:status' && data.phase === 'waiting') runner.cancel(data.id); if(event === 'agents:done') resolve(data); }, {store}); });
  const documentPath = path.join(root, cancelOnWaiting ? 'cancel.md' : 'timeout.md'); await writeFile(documentPath, '# Original\n');
  const started = await runner.run({ documentPath, task:'No changes', timeoutMinutes, custom:{template:[process.execPath,silent]} });
  const result = await done;
  assert.ok(events.some(item => item.event === 'agents:status' && item.data.alive));
  if (cancelOnWaiting) { assert.equal(result.cancelled,true); assert.ok(events.some(item=>item.data.phase==='waiting')); }
  else { assert.equal(result.timedOut,true); assert.equal(result.diagnostic.code,'timeout'); }
  assert.equal((await store.read('runs',started.id)).status, cancelOnWaiting ? 'cancelled' : 'timeout');
  assert.equal(await readFile(documentPath,'utf8'), '# Original\n');
  return {status:cancelOnWaiting?'cancelled-after-60s-silence':'timeout-at-1m', originalUnchanged:true};
}
console.log(JSON.stringify({phase:'adapter-contracts-passed',matrix,root}));
const lifecycleResults = await Promise.all([lifecycle({timeoutMinutes:2,cancelOnWaiting:true}),lifecycle({timeoutMinutes:1})]);
const report = {ok:true,evidence:'simulated programs; no vendor services called',matrix,lifecycle:lifecycleResults,checks:['exact-flags','no-prompt-echo-success','credentials-redaction','startup-lock','missing-launcher','missing-storage-migration','login-network-quota-permission-errors'],root};
await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
