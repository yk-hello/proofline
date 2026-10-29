# 中文字体

界面使用 `@fontsource-variable/noto-sans-sc` 提供的 Noto Sans SC（思源黑体体系）网页字体，按 Unicode 区间加载。字体在构建产物中随程序提供，不依赖在线字体服务。

PDF 使用 `public/fonts/NotoSansSC-Regular.ttf`，从 Google Fonts 官方 Noto Sans SC 变量 TrueType 字体生成字重 400 的静态实例。相比此前的 CFF OpenType 字体，这个文件降低了 PDF 中文字形解码的开销。输出字体名称为 `NotoSansSC-Regular`，仍保留完整原始字符覆盖，导出时再按实际使用字符嵌入子集。

上游：

- 字体：<https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf>
- 许可：`public/fonts/OFL.txt`，SIL Open Font License 1.1，随程序一起分发。
- 本次上游文件 SHA256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`
- 静态实例 SHA256：`6200827e53af554f8c7e38c674003949d892384c9fd735c23054f9180c9d7cf3`

复现生成需要 Python 与 fonttools（本次使用 4.66.1），应用运行和一般构建不需要它们：

```powershell
python -m pip install fonttools==4.66.1
python scripts/prepare-pdf-font.py "NotoSansSC[wght].ttf" public/fonts/NotoSansSC-Regular.ttf
```

上游 `main` 分支可能更新，复现时先核对输入 SHA256，并保留对应版本的 OFL。生成脚本保留许可记录，同时更新静态字体名称。
