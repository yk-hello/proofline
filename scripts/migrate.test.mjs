// Upgrades from earlier names (Proofline, Redline, MENG X) keep the user's data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { adoptUserData, adoptDataFolder, legacyDataFolders } = require('../electron/migrate.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'stetwise-migrate-'));
const put = async (file, text = '{}') => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };

try {
  // 1. A first start of the new version already created an empty Stetwise folder:
  //    the used Proofline profile still wins, and the unused Redline one is left alone.
  {
    const appData = path.join(root, 'appdata-1');
    await put(path.join(appData, 'Proofline', 'file-access.json'), '{"recent":1}');
    await put(path.join(appData, 'Proofline', 'IndexedDB', 'x.leveldb'));
    await put(path.join(appData, 'Redline', 'file-access.json'), '{"old":1}');
    await put(path.join(appData, 'Stetwise', 'Local Storage', 'fresh'));
    assert.equal(adoptUserData(appData, 'Stetwise'), null);
    const chosen = path.join(appData, 'Stetwise');
    assert.equal(await readFile(path.join(chosen, 'file-access.json'), 'utf8'), '{"recent":1}');
    assert.ok(!existsSync(path.join(appData, 'Proofline')));
    assert.ok(!existsSync(path.join(chosen, 'Local Storage', 'fresh')));
    assert.ok(existsSync(path.join(appData, 'Redline')));
  }
  // 2. A used Stetwise profile is never replaced.
  {
    const appData = path.join(root, 'appdata-2');
    await put(path.join(appData, 'Stetwise', 'file-access.json'), '{"mine":1}');
    await put(path.join(appData, 'Proofline', 'file-access.json'), '{"old":1}');
    assert.equal(adoptUserData(appData, 'Stetwise'), null);
    assert.equal(await readFile(path.join(appData, 'Stetwise', 'file-access.json'), 'utf8'), '{"mine":1}');
    assert.ok(existsSync(path.join(appData, 'Proofline')));
  }
  // 3. Nothing earlier: a clean start.
  {
    const appData = path.join(root, 'appdata-3');
    assert.equal(adoptUserData(appData, 'Stetwise'), null);
  }
  // 4. Proofline installed inside Redline's folder: settings from ProoflineData (newer),
  //    marks and runs from RedlineData one level up.
  {
    const programs = path.join(root, 'Programs');
    const install = path.join(programs, 'Redline', 'Proofline');
    await put(path.join(install, 'ProoflineData', 'settings', 'agents.json'), '{"new":true}');
    await put(path.join(programs, 'Redline', 'RedlineData', 'settings', 'agents.json'), '{"new":false}');
    await put(path.join(programs, 'Redline', 'RedlineData', 'annotations', 'a.json'), '{"marks":1}');
    const target = path.join(install, 'StetwiseData');
    assert.equal(legacyDataFolders(target).length, 2);
    await adoptDataFolder(target);
    assert.equal(await readFile(path.join(target, 'settings', 'agents.json'), 'utf8'), '{"new":true}');
    assert.equal(await readFile(path.join(target, 'annotations', 'a.json'), 'utf8'), '{"marks":1}');
    // Already there: nothing changes on later starts.
    await put(path.join(programs, 'Redline', 'RedlineData', 'annotations', 'b.json'));
    await adoptDataFolder(target);
    assert.ok(!existsSync(path.join(target, 'annotations', 'b.json')));
  }
  // 5. Development data folder.
  {
    const repo = path.join(root, 'repo');
    await put(path.join(repo, '.redline-data', 'settings', 'agents.json'), '{"dev":1}');
    await adoptDataFolder(path.join(repo, '.stetwise-data'));
    assert.equal(await readFile(path.join(repo, '.stetwise-data', 'settings', 'agents.json'), 'utf8'), '{"dev":1}');
  }
  console.log(JSON.stringify({ ok: true, checks: ['used-profile-beats-fresh-folder', 'used-stetwise-kept', 'clean-start', 'nested-redline-data-merged', 'development-folder'] }));
} finally {
  await rm(root, { recursive: true, force: true });
}
