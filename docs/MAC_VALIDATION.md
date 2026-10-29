# macOS 验证记录与未打包验证方法

2026-10-28：按用户要求暂停 Mac 打包。本轮运行环境为 Windows x64；没有连接的 macOS 主机，没有生成或验证 DMG、ZIP、签名或公证结果。

## 本轮已做

直接执行生产代码的 Mac 分支，以模拟的文件系统、进程和 Electron 服务验证：

- 应用安装目录、用户自定义目录、卷目录、App Translocation 路径、嵌套 .app 和中文/空格目录的数据位置。
- Apple Silicon 与 Intel Homebrew，以及 nvm、fnm、Volta、Bun、pnpm、用户 bin 的搜索计划。
- 可执行权限：发现文件却无执行权限时跳过；不会因为残留文件就报告可用。
- 登录 shell 环境：使用标记分隔和允许变量列表，排除 profile 欢迎文字；超时可回退；沿用 shell 中的 Gemini home 和账号环境。
- 登录终端：路径与参数经过 POSIX 和 AppleScript 两层转义；终端授权或启动错误返回界面。
- POSIX 进程组停止：终止信号、延迟强制结束和备用停止分支。
- Finder open-file 事件在界面就绪前排队，就绪后发送给真实打开文档的处理函数。
- 打包配置审查：原配置全局复用本机 Electron 解压目录，会妨碍 Mac universal 使用两种架构运行时。已把该优化限制在 Windows 命令，未执行 Mac 打包。

这些检查属于代码与模拟验证，**不属于 Mac 真机通过**。Windows 的完整桌面流程也已测试，但不将其计入 Mac 测试结果。

## 已修正的问题

1. 原先没有处理 Finder 的 open-file 事件，双击打开 Markdown 可能不进入阅读器。
2. shell profile 的额外输出可能混进 PATH；环境读取也没有排除非目标变量的原始输出。
3. Mac 的 Volta、pnpm、部分 fnm 路径和执行权限检查不完整。
4. 登录 shell 设置的 Gemini home 和认证变量没有在全部检测分支使用。
5. Mac 登录终端失败时原先可能仍返回已打开；现在等待 osascript 结果。
6. 进程拒绝终止时原先缺少强制停止步骤。
7. 发送和审阅的快捷键提示原先仍显示 Ctrl，现在按平台显示 ⌘。

## 在 Mac 直接验证，不打包

在 macOS 的项目目录安装 Node 和依赖，然后：

~~~sh
npm ci
npm run test:mac-host
~~~

脚本执行基础逻辑、存储、12 个模拟 CLI、网页构建、隔离桌面流程和 Mac 原生检查。它不会调用 electron-builder，也不生成 app、DMG 或 ZIP。默认不调用任何厂商模型。确实要验证本机已经登录的 Gemini 时，显式运行：

~~~sh
npm run test:mac-host -- --live-gemini
~~~

原生检查包括 osacompile 编译登录脚本（只编译，不打开终端）、真实 shell PATH、chmod 执行权限、只读目录、忽略 SIGTERM 的进程停止、Mac 菜单、应用内注入 open-file 事件和 ⌘F。桌面测试使用独立 profile 和测试文档，验证标记重发、图片重启、诊断、恢复和跨标签审阅。

报告保存在 test-fixtures/results/mac-verification-时间戳/report.json；所有阶段的日志也保存在该目录。Windows 运行 test:mac-host 会明确标记 skipped，macHostVerified 为 false，不能拿跳过结果充当通过。

## 仍必须在真实设备确认

| 项目 | 当前状态 |
| --- | --- |
| Intel Mac 和 Apple Silicon 实际启动与渲染 | 未验证 |
| Finder 真正双击、打开方式、启动时文件事件 | 仅处理函数模拟；OS 事件未验证 |
| Terminal 首次自动化授权和打开后的登录交互 | 未验证；不能用脚本字符串检查代替 |
| 安装位置只读、/Applications、磁盘卷、Translocation | 仅路径分支模拟；真实权限和挂载未验证 |
| 各 CLI 的实际安装、账号、代理和模型编辑权限 | 未在 Mac 验证 |
| 系统剪贴板、输入法、Retina、菜单快捷键、睡眠恢复 | 未验证 |
| universal 合并、DMG 安装、Gatekeeper、签名与公证 | 按要求未打包，均未验证 |

达到可交付标准需要至少在 Apple Silicon 和 Intel 各完成上述主流程，并保存主机/架构、版本、报告和截图。当前只能交付代码与验证脚本，不能宣称 Mac 版本已可发布。
