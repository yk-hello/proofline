// Continuing a Codex conversation: which conversations are offered, and the command that continues one.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { codexConversations, codexResumeArgs } = require('../electron/agents.cjs');

const home = await mkdtemp(path.join(os.tmpdir(), 'sw-codex-home-'));
const day = path.join(home, 'sessions', '2026', '11', '14');
await mkdir(day, { recursive: true });
const ids = { named: '01a1d404-8c54-70a0-b09b-c73a9a8ac7b3', untitled: '01a1d404-8c54-70a0-b09b-c73a9a8ac7b4', exec: '01a1d404-8c54-70a0-b09b-c73a9a8ac7b5', busy: '01a1d404-8c54-70a0-b09b-c73a9a8ac7b6' };
const line = (value) => JSON.stringify(value) + '\n';
const conversation = async (id, { source = 'vscode', originator = 'codex_work_desktop', cwd = 'D:\\work\\report', asked = 'Help me plan the Q3 letter', ageMinutes }) => {
  const file = path.join(day, `rollout-2026-11-14T10-00-00-${id}.jsonl`);
  await writeFile(file, line({ type: 'session_meta', payload: { id, cwd, originator, source } })
    + line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [] } })
    + line({ type: 'event_msg', payload: { type: 'user_message', message: asked } }));
  const time = new Date(Date.now() - ageMinutes * 60000);
  await utimes(file, time, time);
};
await conversation(ids.named, { ageMinutes: 30 });
await conversation(ids.untitled, { asked: 'What does this   error mean?', ageMinutes: 60 });
await conversation(ids.exec, { source: 'exec', originator: 'codex_exec', cwd: 'C:\\Data\\StetwiseData\\work\\0b5e', asked: 'Read the file .stetwise/TASK.md in the current directory.', ageMinutes: 5 });
// Runs from before the rename (Redline, Proofline) are Stetwise's own too.
await conversation('01a1d404-8c54-70a0-b09b-c73a9a8ac7c1', { cwd: 'D:\\x', asked: 'Read the file .redline/TASK.md in the current directory.', ageMinutes: 120 });
await conversation('01a1d404-8c54-70a0-b09b-c73a9a8ac7c2', { cwd: 'D:\\y', asked: '# Stetwise revision task: Note.md\n\nDo this.', ageMinutes: 121 });
const own = '01a1d404-8c54-70a0-b09b-c73a9a8ac7b7';
// codex exec writes the person's words only as a user message item, after an <environment_context> one.
{
  const file = path.join(day, `rollout-2026-11-14T08-00-00-${own}.jsonl`);
  await writeFile(file, line({ type: 'session_meta', payload: { id: own, cwd: 'D:\\notes', originator: 'codex_exec', source: 'exec' } })
    + line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>D:\\notes</cwd>' }] } })
    + line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Remember that the cat is called Pebble.' }] } }));
  const time = new Date(Date.now() - 90 * 60000); await utimes(file, time, time);
}
await conversation(ids.busy, { ageMinutes: 1 });
await writeFile(path.join(home, 'session_index.jsonl'), line({ id: ids.named, thread_name: 'Q3 investor letter', updated_at: '2026-11-14T10:30:00Z' }) + 'not json\n');

const list = await codexConversations({ home });
assert.deepEqual(list.map((item) => item.id), [ids.busy, ids.named, ids.untitled, own], 'newest first; Stetwise\'s own runs are left out, a person\'s codex exec chat is kept');
assert.equal(list[1].title, 'Q3 investor letter', 'the title Codex shows');
assert.equal(list[2].title, 'What does this error mean?', 'else the first thing asked');
assert.equal(list[3].title, 'Remember that the cat is called Pebble.', 'codex exec: the first thing the person said, not the environment');
assert.equal(list[1].folder, 'D:\\work\\report');
assert.equal(list[0].active, true, 'written to a minute ago: may still be open');
assert.equal(list[1].active, false);
assert.deepEqual(await codexConversations({ home: path.join(home, 'nowhere') }), [], 'no Codex yet: nothing to offer');

assert.deepEqual(codexResumeArgs(ids.named.toUpperCase()), ['exec', 'resume', '--skip-git-repo-check', '--json', '-c', 'sandbox_mode="workspace-write"', ids.named, '{prompt}']);
for (const bad of ['', 'latest', '--last', '../x', ids.named + ' --dangerously-bypass-approvals-and-sandbox']) assert.throws(() => codexResumeArgs(bad));
console.log(JSON.stringify({ ok: true, checks: ['newest-first', 'stetwise-runs-left-out', 'own-exec-kept', 'titles', 'active-flag', 'no-codex-home', 'resume-args', 'id-validated'] }));
