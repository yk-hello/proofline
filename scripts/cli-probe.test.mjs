import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { connectionResult } = require('../electron/agents.cjs');
// A successful final model response overrides earlier recoverable auth warnings.
const success = connectionResult({ ok: true, stdout: 'REDLINE_READY\n', stderr: 'Previous request: 401 unauthorized, retrying' });
assert.equal(success.ok, true);
assert.equal(success.code, undefined);
assert.equal(connectionResult({ ok: false, stdout: 'REDLINE_READY', stderr: 'Not logged in' }).code, 'login-required');
assert.equal(connectionResult({ ok: true, timedOut: true, stdout: 'REDLINE_READY' }).code, 'timeout');
assert.equal(connectionResult({ ok: true, stdout: JSON.stringify({type:'message',role:'user',content:'REDLINE_READY'}) }).ok, false);
assert.equal(connectionResult({ ok: true, stdout: JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'REDLINE_READY'}}) }).ok, true);
assert.equal(connectionResult({ ok: false, stderr: 'fetch failed ECONNRESET' }).code, 'network');
console.log(JSON.stringify({ ok: true, checks: 7 }));
