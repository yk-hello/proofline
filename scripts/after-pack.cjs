// Apply our own Windows resources without signing or downloading a signing toolchain.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const rcedit = path.join(context.packager.projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  execFileSync(rcedit, [executable,
    '--set-icon', path.join(context.packager.projectDir, 'build', 'icon.ico'),
    '--set-version-string', 'ProductName', 'Stetwise',
    '--set-version-string', 'FileDescription', 'Stetwise',
    '--set-version-string', 'CompanyName', 'Stetwise',
    '--set-version-string', 'OriginalFilename', 'Stetwise.exe',
    '--set-file-version', context.packager.appInfo.version,
    '--set-product-version', context.packager.appInfo.version,
  ], { windowsHide: true });
};
