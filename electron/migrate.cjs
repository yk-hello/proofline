// Carry data over from earlier names of the app (Proofline, Redline, MENG X).
// Kept apart from main.cjs so it can be tested without Electron.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PREVIOUS_APP_NAMES = ['Proofline', 'Redline', 'MENG X'];

/** A profile someone actually used: it has file grants or the version store. */
function usedProfile(folder) {
  return fs.existsSync(path.join(folder, 'file-access.json')) || fs.existsSync(path.join(folder, 'IndexedDB'));
}

/**
 * The user data folder to use. `current` is appData/<name>, built by hand: Electron's
 * app.getPath('userData') creates the folder, so asking it first would always look "new".
 * A folder that only a first start of this version created is replaced by the newest used
 * profile from an earlier name. If the old folder is locked (an older copy still running),
 * keep using it where it is.
 */
function adoptUserData(appData, name, previousNames = PREVIOUS_APP_NAMES) {
  const current = path.join(appData, name);
  if (usedProfile(current)) return current;
  const previous = previousNames.map((item) => path.join(appData, item)).find((folder) => folder !== current && usedProfile(folder));
  if (!previous) return current;
  try {
    if (fs.existsSync(current)) fs.rmSync(current, { recursive: true, force: true });
    fs.renameSync(previous, current);
    return current;
  } catch { return previous; }
}

/**
 * Earlier data folders for `root` (…/StetwiseData, or .stetwise-data in development), newest
 * name first. An installation that was itself inside the previous product's folder kept its
 * data one level up (…/Programs/Redline/RedlineData next to …/Programs/Redline/Proofline).
 */
function legacyDataFolders(root) {
  const development = path.basename(root).startsWith('.');
  const names = development ? ['.redline-data'] : ['ProoflineData', 'RedlineData'];
  const parents = development ? [path.dirname(root)] : [path.dirname(root), path.dirname(path.dirname(root))];
  return [...new Set(parents.flatMap((parent) => names.map((item) => path.join(parent, item))))].filter((folder) => fs.existsSync(folder));
}

/** Create `root` from the earlier data folders: rename the newest, then add what only older ones have. */
async function adoptDataFolder(root) {
  if (fs.existsSync(root)) return { adopted: [] };
  const legacy = legacyDataFolders(root);
  if (!legacy.length) return { adopted: [] };
  try { await fsp.rename(legacy[0], root); }
  catch { await fsp.cp(legacy[0], root, { recursive: true, force: false, errorOnExist: false }).catch(() => {}); }
  for (const older of legacy.slice(1)) await fsp.cp(older, root, { recursive: true, force: false, errorOnExist: false }).catch(() => {});
  return { adopted: legacy };
}

module.exports = { PREVIOUS_APP_NAMES, usedProfile, adoptUserData, legacyDataFolders, adoptDataFolder };
