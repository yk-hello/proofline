// Lists the licenses of everything shipped in the app (production dependencies
// from package-lock.json, plus bundled fonts) into THIRD_PARTY_NOTICES.md.
import { readFile, writeFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
// Packages whose package.json omits the field; license confirmed from their repositories.
const KNOWN = { khroma: 'MIT', 'png-js': 'MIT' };
const rows = new Map();
for (const [location, info] of Object.entries(lock.packages || {})) {
  if (!location || info.dev || info.devOptional || info.link) continue;
  const name = info.name || location.slice(location.lastIndexOf('node_modules/') + 13);
  const license = typeof info.license === 'string' ? info.license : info.license?.type || KNOWN[location.slice(location.lastIndexOf('node_modules/') + 13)] || 'UNKNOWN';
  rows.set(`${name}@${info.version}`, { name, version: info.version, license });
}
const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
const counts = list.reduce((all, item) => ({ ...all, [item.license]: (all[item.license] || 0) + 1 }), {});
const text = `# Third-party notices

Proofline's own code is under LICENSE (Apache-2.0). The components below are distributed
with Proofline under their own licenses, which are not changed by Proofline's
license. Each package's full license text is in its folder under
node_modules (and in the installed app's resources).

Bundled fonts: Noto Sans SC, Inter Tight and JetBrains Mono (SIL Open Font
License 1.1), KaTeX fonts (MIT). Electron and Chromium licenses ship as
LICENSE.electron.txt and LICENSES.chromium.html in every build.

License summary: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} (${count})`).join(', ')}

| Package | Version | License |
| --- | --- | --- |
${list.map((item) => `| ${item.name} | ${item.version} | ${item.license} |`).join('\n')}
`;
await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log(JSON.stringify({ packages: list.length, counts }));
