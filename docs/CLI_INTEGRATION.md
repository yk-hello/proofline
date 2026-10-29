# CLI 接入、验证与故障恢复

Proofline 使用本机 CLI 的非交互命令执行一次文档任务，进程结束后进入审阅。每种 CLI 有独立的参数模板；每台电脑自动检测自己的安装路径和环境。无需给每个用户定制代码。

## 新电脑首次使用

1. 安装 Proofline，并按所选 CLI 的官方说明安装、登录。在自己的终端先确认能使用它。
2. 打开 Proofline「更多 → AI 工具设置」，点「重新检测」。程序位置只保存在本机配置；迁移数据不会拿另一台电脑的 Windows 路径去启动 Mac 程序。
3. 点「测试连接（会调用模型）」。只有进程成功退出、模型回复 REDLINE_READY，才算此项测试通过。版本号响应只证明程序能启动；登录状态未知不代表登录失败。
4. 用一次性 Markdown 测试：写入 The cost is 10.，标记要求改成 20，选择「只改这篇文档」。确认审阅前原文件保持 10，接受后变成 20。这个步骤验证真实编辑工具权限；纯文字回复测试无法代替它。

默认使用已有 CLI 账号或该 CLI 已配置的服务，不统一强制 API key。某些工具或账号确实要求密钥时，应在对应工具自己的认证流程中配置。

## 支持和证据边界

| CLI | 非交互模板核心 | 本次实际证据 |
| --- | --- | --- |
| Gemini CLI | -p；auto_edit；支持时使用 stream-json、skip-trust | 真实账号：Windows 0.66.0 自动发现、连接、编辑、审阅、写回通过 |
| Codex CLI | exec；workspace-write；json | 真实账号：Windows 0.165.0 自动发现、连接、编辑、审阅、写回通过 |
| Claude Code | -p；acceptEdits；限定读写工具 | 真实账号：Linux 2.1.312 自动发现、连接、编辑、审阅、写回通过；Windows 待验证 |
| Qwen Code | -p；auto-edit | 进程模拟通过，未做厂商服务实测 |
| Kimi CLI | --print --prompt | 进程模拟通过，未做厂商服务实测 |
| opencode | run | 进程模拟通过，未做厂商服务实测 |
| Cursor CLI | -p；--force | 进程模拟通过，未做厂商服务实测 |
| Copilot CLI | -p；--allow-all-tools | 进程模拟通过，未做厂商服务实测 |
| Aider | --message-file；--yes；不自动提交 | 进程模拟通过，未做厂商服务实测 |
| iFlow CLI | -p；--yolo | 实验模板；进程模拟通过，需要安装版本的帮助和服务验证 |
| CodeBuddy Code | -p；权限参数 | 实验模板；进程模拟通过，需要安装版本的帮助和服务验证 |
| Qoder CLI | -p；权限参数 | 实验模板；进程模拟通过，需要安装版本的帮助和服务验证 |

模板声明的标志必须出现在安装版本的帮助里，否则阻止自动运行并说明不兼容。帮助检查不会证明参数值、登录或服务可用；需要继续完成连接测试和一次性文档测试。自定义命令可覆盖新版本差异，普通用户一般不需要修改。

各 CLI 的权限机制不同，有些模板会允许工具自动执行。Proofline 的「只改这篇文档」建立文档副本和工作目录，不能把所有 CLI 变成操作系统沙箱。文件夹范围会先改动源目录，其他文件的修改不能通过文档审阅统一回滚。

## 用启动脚本运行的 CLI

有些用户用自己的启动脚本（例如一个 Start-Gemini.cmd）运行 CLI，脚本会选择自己的 Node、GEMINI_CLI_HOME 和临时目录。只找全局 gemini 命令时，启动环境会和用户平时的终端不同。Proofline 会优先检查能转发参数、不会挂起交互终端的启动脚本，也可以在设置里填写完整路径。

Mac 会读取登录 shell 的 PATH 和允许的服务变量，并检查 Apple Silicon Homebrew、Intel Homebrew、npm、nvm、fnm、Volta、Bun、pnpm 与用户 bin 目录。输出使用标记分隔，终端配置里的欢迎文字不会拼入 PATH。真实 Mac 结果见 [MAC_VALIDATION.md](MAC_VALIDATION.md)。

## 长任务、失败和重发

Proofline 每 3 秒检查子进程，超过 60 秒没有新输出时提示等待；这是本机存活检查，不能证明网络或服务端长连接正常。默认最长 30 分钟，可设置为 1–240 分钟。停止或超时会结束进程树；Mac 先发终止信号，仍未退出时补强制信号。日志、任务和副本保存在 ProoflineData，可恢复已有结果。

失败提示区分启动、参数、登录、网络/代理/证书、额度、权限和超时。已发送、已处理的标记仍能单条重新发送。失败后还可打开日志、审阅已有副本或在设置里恢复任务。

## 让 CLI 智能体辅助诊断

在设置或失败面板点「生成 CLI 辅助诊断任务」，得到 TASK.md 和 diagnostics.json。用一个本来就能使用的 CLI 打开该目录，告诉它：请阅读 TASK.md 和 diagnostics.json，按步骤排查 Proofline 连接问题，提供实际验证过的路径和命令。

任务要求它依次核对实际启动器、Node、CLI home、安装版本帮助、认证方式、代理/证书和工作目录；先测试 REDLINE_READY，再测试一次性文档副本。诊断包不包含正文、提示词、密钥值或原始运行日志。不要要求智能体导出完整环境或认证文件；不要用覆盖现有提供商配置、关闭 TLS 校验来掩盖问题。

如果本机 CLI 都不可用，可把诊断目录交给另一台设备的 AI 解释；另一台设备无法代替本机完成登录或确认本机命令实际运行成功，应明确保留这些未验证项。

## 其他设备、网页和桌面 AI

选「其他 AI / 其他设备」生成完整任务目录，包含文档副本、TASK.md、标记 JSON 和应用保存的图片目录。把整个目录带到新设备，用当地已登录的 AI 处理，再导入修改后的 Markdown 审阅。账号和密钥不会随着任务包复制。网页和桌面 AI 没有共同的自动接收接口，当前使用这个显式交接流程。

整套数据迁移时复制 ProoflineData、源文档及其 .assets 目录。标记通过同名且内容完全一致的唯一匹配重新关联；内容已经变化、重名或多个匹配时，不能保证自动关联。运行历史内的旧绝对路径也不会自动变成新设备路径。

## 验证命令与参考

~~~sh
npm run test:adapters
npm run test:integration
npm run build
npm run test:redline-desktop
npm run test:redline-desktop -- --live-gemini
~~~

适配器测试创建模拟程序，验证版本/帮助/连接/任务参数、中文路径、UTF-8、副本不覆盖原文、并发启动保护、日志恢复，以及真实等待一分钟的静默/超时/取消。它不代表 12 家真实模型服务已经通过。

参考：[Codex 非交互模式](https://developers.openai.com/codex/noninteractive)、[Claude Code](https://code.claude.com/docs/en/headless)、[Gemini 认证](https://geminicli.com/docs/get-started/authentication/)、[Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)、[Kimi CLI](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html)、[opencode](https://opencode.ai/docs/cli/)、[Cursor CLI](https://cursor.com/docs/cli/reference/parameters)、[Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)、[Aider](https://aider.chat/docs/scripting.html)。安装版本自己的 --help 是运行时检查依据。
