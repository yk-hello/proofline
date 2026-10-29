## 下载 / Download

- **`Proofline-*-Setup-x64.exe`** — Windows 安装版（推荐）/ installer (recommended)
- **`Proofline-*-Windows-x64.exe`** — Windows 便携版，不用安装 / portable, no install
- `SHA256SUMS.txt` — 校验码 / checksums (`certutil -hashfile <file> SHA256`)

**macOS：暂未提供安装包。** 一位测试者在 Apple Silicon 上用本机打的包走通了核心流程（标记 → 交给 AI → 审阅 → 写回），其余仍在测试，欢迎在 Issues 里提交测试报告。
No macOS installer yet. One tester ran the core flow on Apple Silicon with a locally built app; the rest is still being tested — test reports welcome.

## 首次运行 / First run

安装包**没有代码签名**，Windows SmartScreen 会提示「已保护你的电脑」：点 **更多信息 → 仍要运行**。
The installers are **not code-signed**; on the SmartScreen prompt choose **More info → Run anyway**.

## 升级 / Upgrade

直接运行新安装包即可覆盖安装，标记和设置（`ProoflineData`）会保留。从旧名 Redline 升级时会自动迁移。
Run the new installer over the old one; your marks and settings are kept.

## 更新内容 / What's changed

（发布前由维护者填写 / maintainer fills this in before publishing）
