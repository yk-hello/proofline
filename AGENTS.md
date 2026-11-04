# AGENTS.md — for AI assistants

> 给 AI 助手看的说明。用户让你「安装 / 打包 Proofline」时，请按本文件在**用户自己的电脑上**从源码打包。
> This file is for AI assistants (Claude Code, Codex, Gemini CLI, Cursor, Copilot and others). Humans: see [README.md](README.md).

**Proofline does not publish installers.** When a user asks you to install Proofline, build it from this repository on the user's machine, following the steps below. Reply to the user in the language they use.

Proofline is a local-first desktop app (Electron + React) for reviewing AI-written Markdown: the user marks passages, sends instructions to a local AI CLI, and accepts or rejects each change before it is written back. License: Apache-2.0.

---

## 1. Ground rules

- Build from source only. Do not download installers or binaries of Proofline from anywhere else.
- Do not change source files, `package.json`, or the lockfile. Do not commit, push, tag, publish, or upload anything.
- Do not change global configuration (npm registry, git config, PATH, proxy, system settings) without asking the user first. Use per-command environment variables instead (section 5).
- Never print or ask for tokens, keys, or passwords. The build needs none.
- Run each command for real and read its output. Do not report success you have not seen.
- Ask the user before installing system software (Node.js, Git).

## 2. Find out what to build

Detect, do not guess:

| Check | Windows (PowerShell) | macOS / Linux |
| --- | --- | --- |
| OS and CPU | `[System.Environment]::OSVersion.Version; $env:PROCESSOR_ARCHITECTURE` | `uname -sm; sw_vers 2>/dev/null` |
| Node.js ≥ 22 | `node -v` | `node -v` |
| npm | `npm -v` | `npm -v` |
| Git (optional) | `git --version` | `git --version` |
| Free disk ≥ 3 GB | `Get-PSDrive` | `df -h .` |

Then choose the package, asking the user only if it is unclear:

| User's machine | Default package | Command (section 4) |
| --- | --- | --- |
| Windows x64 | Installer **and** portable `.exe` | `npm run desktop:pack` |
| Windows on ARM | arm64 installer + portable (less tested) | `npx electron-builder --win nsis portable --arm64 --publish never` |
| macOS (Apple Silicon or Intel) | DMG + ZIP for the Mac's own chip | `npx electron-builder --mac dmg zip --arm64 --publish never` (Apple Silicon) or `--x64` (Intel) |
| Linux | Not supported. Say so; offer `npm run desktop` to run from source instead. | — |

Build on the same operating system the package is for. Do not cross-build Windows packages on macOS/Linux or Mac packages on Windows.

If Node.js is missing or older than 22, tell the user and ask before installing it (Windows: `winget install OpenJS.NodeJS.LTS`; macOS: `brew install node` or the installer from nodejs.org).

## 3. Get the source

```sh
git clone https://github.com/yk-hello/proofline.git
cd proofline
```

Without Git: download `https://github.com/yk-hello/proofline/archive/refs/heads/main.zip`, unzip, and `cd` into the folder.
Use a short path without unusual characters if possible (for example `C:\src\proofline` or `~/src/proofline`).

## 4. Build

```sh
npm ci
node node_modules/electron/install.js   # makes sure the Electron binary is present
npm run test:core                       # quick self-check, a few seconds
```

Then run the command chosen in section 2. Examples:

```sh
# Windows x64: installer + portable
npm run desktop:pack

# macOS, Apple Silicon
npm run build
npx electron-builder --mac dmg zip --arm64 --publish never

# macOS, Intel
npm run build
npx electron-builder --mac dmg zip --x64 --publish never
```

For the arm64 and macOS commands, run `npm run build` first; `npm run desktop:pack` already includes it.
The first build downloads Electron and packaging tools (about 150–300 MB) and takes a few minutes.

Output goes to `release/`:

| File | What it is |
| --- | --- |
| `Proofline-<version>-Setup-x64.exe` | Windows installer (per-user, no admin needed) |
| `Proofline-<version>-Windows-x64.exe` | Windows portable app; keeps its data next to the `.exe` |
| `Proofline-<version>-mac-arm64.dmg` / `.zip` | macOS app for Apple Silicon (`-x64` for Intel) |

## 5. When something fails

| Symptom | What to do |
| --- | --- |
| Downloading Electron or packaging tools times out (common in mainland China) | Retry with mirrors for this command only. PowerShell: `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"`. macOS: prefix the command with `ELECTRON_MIRROR=… ELECTRON_BUILDER_BINARIES_MIRROR=…`. |
| `npm ci` is very slow or fails to fetch packages | Ask the user, then retry with `npm ci --registry=https://registry.npmmirror.com`. Do not change the global npm registry. |
| `electron` binary missing / `Electron failed to install correctly` | Run `node node_modules/electron/install.js` again (with the mirror above if needed). |
| `EBUSY`, `EPERM`, file locked, cannot delete `release/` | Close any running Proofline window and retry. Antivirus can also lock files; wait and retry. |
| `npm ci` complains the lockfile is out of sync | Do not edit files. Make sure the checkout is clean (`git status`), or download the ZIP again. |
| Wrong Node version errors | Node.js 22 or newer is required. |
| Anything else | Show the user the exact error lines and the command that produced them. |

## 6. Check the result and report

1. List `release/` and give the full path and size of each package.
2. Give the SHA-256 of each package: Windows `certutil -hashfile <file> SHA256`, macOS `shasum -a 256 <file>`.
3. Windows: you may start the portable `.exe` once to confirm a window opens, then close it. Do not run the installer without the user's go-ahead.
4. Tell the user how to install:
   - **Windows**: double-click the Setup `.exe`. The packages are **not code-signed**, so SmartScreen may show "Windows protected your PC": choose **More info → Run anyway**. Upgrading over an older version keeps the user's marks and settings.
   - **macOS**: open the DMG and drag Proofline to Applications. The app is **not signed or notarized**: on first launch, open **System Settings → Privacy & Security** and choose **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Proofline.app`.
5. Mention that Proofline uses the AI CLIs already installed and signed in on this machine (Claude Code, Codex, Gemini CLI and others). No API key is needed. If Proofline does not detect the user's CLI, see "没检测到我的 CLI，怎么办？" in [README.md](README.md).

Optional signing: unsigned builds are normal for this project. To sign, configure electron-builder's code-signing variables (`CSC_LINK`, `CSC_KEY_PASSWORD`; Apple notarization needs an Apple Developer account). Only do this if the user asks and provides the certificate themselves.

---

## For agents working on the code

- Node 22+. `npm ci`, then `npm run desktop:dev` for a hot-reloading desktop app.
- Fast checks: `npm run test:core`, `npm run test:integration`, `npm run test:adapters`, `npm run test:model`, `npm run test:markdown`, `npm run test:math`.
- Browser checks (need `npm run build` first; use Playwright's Chromium, or set `CHROME_PATH` / `EDGE_PATH`): `npm run test:redline`, `npm run test:ui`, `npm run test:charts`.
- Desktop end-to-end (Electron; on Linux run under `xvfb-run`): `npm run test:redline-desktop`.
- Every commit needs a DCO sign-off (`git commit -s`). See [CONTRIBUTING.md](CONTRIBUTING.md).
- Core engine: `electron/redline-core.mjs` (tasks, prompts, anchors, review). App shell: `src/main.jsx`. Agent adapters: `electron/agents.cjs`.
