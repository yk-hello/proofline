// Apply our own Windows resources without signing or downloading a signing toolchain.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const rcedit = path.join(context.packager.projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  execFileSync(rcedit, [executable,
    '--set-icon', path.join(context.packager.projectDir, 'build', 'redline.ico'),
    '--set-version-string', 'ProductName', 'Proofline',
    '--set-version-string', 'FileDescription', 'Proofline',
    '--set-version-string', 'CompanyName', 'Proofline',
    '--set-version-string', 'OriginalFilename', 'Proofline.exe',
    '--set-file-version', context.packager.appInfo.version,
    '--set-product-version', context.packager.appInfo.version,
  ], { windowsHide: true });
};
