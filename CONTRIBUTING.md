# Contributing to Proofline / 参与共建

[中文在下方](#中文)

Contributions are welcome in this repository: code, tests, documentation,
translations, and especially **test reports from real machines** (macOS, and
CLIs we have not verified with real accounts yet).

## Ground rules

- **License.** Proofline is Apache-2.0. By submitting a contribution you agree
  it is licensed under Apache-2.0 (section 5 of the license).
- **Sign off your commits (DCO).** Add a `Signed-off-by` line to every commit
  to certify the [Developer Certificate of Origin](https://developercertificate.org/):
  `git commit -s -m "Fix …"`. A check on each pull request verifies this.
- **Name and logo.** If you publish your own modified build, rename it and use a
  different icon; see TRADEMARKS.md. Forks that only prepare pull requests can
  keep them.
- **Privacy.** Never commit or paste tokens, API keys, personal paths or
  private documents. Tests use the fixtures in `test-fixtures/`.

## How a change gets in

1. Fork the repository and create a branch.
2. Make the change, run the relevant tests, commit with `-s`.
3. Open a pull request: what changed, why, which tests you ran and on which
   system (Windows / macOS / Linux, version, CPU).
4. GitHub Actions runs the tests on Linux, packages Windows and runs the
   macOS host check. The maintainer reviews, may ask for changes, and merges.
   Nothing reaches `main` without the maintainer's approval.

## Run it

```sh
npm ci
npm run desktop:dev                      # desktop app with hot reload
npm run build && npm run test:redline    # browser end-to-end
```

Node 22 or later.

## Tests

```sh
npm run test:core          # review engine: blocks, prompts, replies, diffs
npm run test:markdown; npm run test:math; npm run test:model
npm run test:integration   # storage, images, task folders, CLI errors
npm run test:adapters      # 12 simulated CLIs, timeouts and cancellation
npm run test:probe         # connection test results
npm run test:redline-desktop          # Electron app with a fresh profile
npm run test:local-cli -- --edit-others   # real CLIs on this machine (calls models)
npm run test:mac-contracts # macOS code paths on any host
npm run test:mac-host      # only on a real Mac; does not call a model
```

Windows installer check (on a Windows PC, after `npm run desktop:pack`):
close Proofline and run `verify-install.bat`. It installs, upgrades,
uninstalls and reinstalls, and checks that ProoflineData survives.

## Where things are

| Path | What |
| --- | --- |
| `src/main.jsx` | The app: reading, marks, sending, review, editing |
| `src/redline/` | Marks store, rail, popover, send / review / settings dialogs, rich editor |
| `electron/redline-core.mjs` | Pure review engine: block split, task prompt, reply parsing, diffs |
| `electron/agents.cjs` | CLI adapters, detection, runs, logs, error classification |
| `electron/platform.cjs` | macOS login shell, search paths, Terminal, process groups |
| `electron/data-store.cjs` | ProoflineData JSON storage |
| `build/installer.nsh` | Windows installer: options page, file types, data-keeping uninstall |

In the code, "redline" is the internal word for an **instruction mark** (fix,
expand, delete, ask): the marks that are sent to the AI.

## Adding or fixing a CLI adapter

Adapters are in `electron/agents.cjs`. Each names the commands to look for,
the non-interactive arguments, and the flags that must appear in that
version's `--help`. Add a simulated program to `scripts/cli-adapters.test.mjs`.
If you can, run `npm run test:local-cli -- --edit-others` where the real CLI is
installed and signed in, and put the CLI name, version and result in the pull
request.

## Style

Keep changes focused and match the surrounding code. User-facing text is
bilingual; most of it is in `src/redline/copy.js` and `src/lib/i18n.js`.

---

## 中文

欢迎在本仓库参与共建：代码、测试、文档、翻译都可以，**尤其欢迎真机测试报告**，比如 macOS，或者我们还没用真实账号验证过的 CLI。

**规则**

- 本项目采用 Apache-2.0，你提交的贡献同样按 Apache-2.0 授权。
- 每个提交都要加签名行（DCO），用 `git commit -s` 即可。PR 会自动检查。
- 发布你自己改的版本时，请换名字和图标（见 TRADEMARKS.md）。只为提 PR 的 fork 不受限制。
- 不要提交或粘贴任何密钥、token、个人路径或私人文档。

**改动怎么进入仓库**

1. fork 本仓库，新建分支。
2. 修改，跑相关测试，用 `-s` 提交。
3. 发起 PR：写清改了什么、为什么改、跑了哪些测试、在什么系统上（Windows / macOS / Linux、版本、芯片）。
4. GitHub 会自动在 Linux 跑测试、在 Windows 打包、在 macOS 跑真机检查。维护者审阅后合并；没有维护者批准，任何改动都进不了 `main`。

运行、测试命令、代码结构和新增 CLI 适配的方法见上文英文部分。代码里的 "redline" 指「发给 AI 的指令标记」。
