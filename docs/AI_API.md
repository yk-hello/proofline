# AI / 自动化接口

接口版本 `1.1.0`。UI、页面 API 和 CLI 会话共用阅读器逻辑。调用 `describe()` 可以发现全部方法，`getState()` 可以读取当前状态。API 对象在 React 更新后保持相同身份，适合缓存引用。

产品显示名为 Proofline。`window.prooflineReader` 为推荐入口，`window.mengxReader` 保留为同一对象的兼容别名；旧事件名称和 CLI 命令仍可使用。

## 页面 API

```js
const reader = window.prooflineReader;
await reader.openText({ name: '报告.md', path: 'session', content: '# 报告\n\n正文' });
const hits = await reader.search('正文');
await reader.goToMatch(0);
const before = reader.getContent();
await reader.replaceContent(before.content + '\n\n新增段落', { expectedRevision: before.revision });
const result = await reader.exportPdf();
```

`openText`、`openFile`、`openRecent`、`openWorkspaceFile` 和 `replaceContent` 在文档准备完成后返回。`search` 在索引完成后返回真实数量；`goToMatch` 和 `goToHeading` 等待目标进入可视区；`setReadingMode` 等待编辑锁状态生效。遇到非法参数会抛出带 `code` 的错误；保存或导出失败返回 `{ ok: false, error, code, revision }`。所有索引从 `0` 开始，源偏移以 JavaScript UTF-16 字符计，文件大小以字节计。`revision` 在当前阅读器会话内单调递增，重启后应重新获取。

| 方法 | 参数 / 返回值 |
| --- | --- |
| `describe()` | 版本、方法、能力列表、偏移单位、revision 语义、文件授权规则和错误码 |
| `invoke(method, args)` | 与直接调用等价；`args` 必须为数组 |
| `getState()` | 文档名称、路径、修订、`dirty`、`saveState`、`canUndo`/`canRedo`、准备进度、搜索数量、当前匹配、面板、偏好、工作区、并排文档和 PDF 任务状态 |
| `getTabs()` | 标签列表，每项包含 `id`、名称、路径、格式、`active`、`dirty` 和 `saveState` |
| `openTab(input)` / `switchTab(id)` | 打开或切换标签；输入可为 `openFile` 的输入或 `openText` 的对象；重复路径复用标签 |
| `closeTab(id?, { discard }?)` / `reopenClosedTab()` | 默认关闭当前标签；有未保存修改时返回 `pending` 并显示确认。`discard: true` 放弃修改，只应在调用方明确确认后使用。恢复最近关闭的标签及保留的会话历史 |
| `goBack()` / `goForward()` | 返回/前进到目录、搜索和批注导航前的位置，包含跨标签跳转；无历史返回 `history-empty` |
| `waitForReady({ timeoutMs })` | 默认等待 30 秒，返回准备完成的状态 |
| `openText({ name, path, content, kind })` | `kind` 可选，默认根据文件扩展名判断；`content` 应为已转换的 Markdown/文本 |
| `openFile(input)` | 支持 `File`、文件句柄、URL、`{ file, path, handle }`；HTML/DOCX 自动转换 |
| `getContent({ start, end })` | 内容、完整长度和修订号；支持只读取一段，包含尚未提交的直接修改 |
| `replaceContent(content, { expectedRevision })` | 替换正文，触发自动保存；阅读锁定或修订冲突时失败。打开的 MD/TXT 会真实写回，请用副本测试 |
| `undo()` / `redo()` | 撤销/重做并触发自动保存；每篇文档独立历史，保存不清空历史 |
| `getOutline({ offset, limit })` | `{ total, offset, items }`，默认 100 条，最多 1000 条；目录项带 `slug` 和源偏移 |
| `getReferenceOutline({ offset, limit })` / `goToReferenceHeading(slugOrIndex)` | 分页读取右侧文档目录 / 定位右侧章节，左右阅读位置独立 |
| `search(query, { timeoutMs?, caseSensitive?, wholeWord?, regex?, scope? })` | `{ query, count, total, items }`，返回首批匹配；范围为 `document/folder/workspace`，默认当前文档；空字符串清空搜索 |
| `getSearchResults({ offset, limit })` | 分页结果、查询词和 `pending`；大文档结果包含行号和源偏移 |
| `goToMatch(index)` | 等待第 `index` 个匹配进入视区；越界抛 `RangeError`。匹配位于链接地址或格式标记时定位其所在正文块并返回 `sourceOnly: true` |
| `goToHeading(slugOrIndex)` | 接受索引、slug 或精确标题文本；同名标题推荐用 slug |
| `closeSearch()` | 清空查找并关闭结果栏 |
| `getRecentFiles()` / `openRecent(pathOrIndex)` | 最近文档列表 / 按路径或索引打开；桌面版重启后仍从原路径读取，并恢复滚动位置 |
| `clearRecentHistory()` / `removeRecent(pathOrIndex)` | 清除全部/指定历史；不删除源文件 |
| `requestSourceDeletion(pathOrIndex)` | 显示确认弹窗并返回 `{ pending: true, token, path }`，此时文件未删除 |
| `confirmSourceDeletion(token)` / `cancelSourceDeletion()` | 确认/取消；必须匹配当前 token。桌面版移入系统回收站或废纸篓 |
| `openPath(path)` / `openFolderPath(path)` / `openReferencePath(path)` | 桌面版打开已授权的绝对路径；CLI 会话由显式路径命令建立授权 |
| `openDirectory(handle)` | 用户已选择的目录句柄，浏览目录内文档与图片 |
| `importWorkspace(entries, { name })` | 每项为 `{ file: File, path, handle? }`；只在打开或搜索时读取文档 |
| `getWorkspace()` / `openWorkspaceFile(path)` | 返回根路径、`lazy`、已展开目录及文件；接受目录中的相对路径打开文档 |
| `expandDirectory(relativePath)` | 桌面版展开指定子目录，只读取该层目录项，不预读正文 |
| `searchWorkspace(query, { limit })` | 后台逐篇搜索已选择的目录及最近可访问文档；返回 `{ total, matches, truncated, errors }`，默认最多 1000 个匹配 |
| `openReference(File 或 { name, content, kind })` | 打开右侧文档并开启并排阅读 |
| `openSplitTab(input)` / `closeSplitTab()` / `swapSplit()` | 打开右侧文档、保存位置后关闭右侧、交换左右文档 |
| `setSplitSync(boolean)` | 开关按阅读进度同步滚动 |
| `toggleSplit(boolean?)` | 显示/关闭并排阅读，省略时切换 |
| `setLanguage('zh' / 'en')` | 切换界面语言并持久保存 |
| `setReadingWidth('narrow' / 'comfortable' / 'wide')` | 切换正文宽度并按文档持久保存 |
| `getReadingPreferences()` | 读取当前文档的字体、字号、行距、段落间距、背景和代码字号 |
| `setReadingPreferences({ fontFamily?, fontSize?, lineHeight?, paragraphSpacing?, background?, codeSize? })` | 按文档持久保存；可选值分别为 `sans/serif`、`small/medium/large`、`tight/comfortable/relaxed`、`compact/comfortable/airy`、`white`（旧暖白设置自动迁移为白色）、`small/medium/large` |
| `resetReadingPreferences()` | 恢复当前文档的标准阅读排版 |
| `setSourceView(true/false)` | 切换 Markdown 源文与排版视图，保持当前段落位置；源文支持分块、搜索及自动保存 |
| `setFocusMode(boolean)` | 开关专注阅读；专注状态隐藏文件侧栏，但不改变 `readingMode` 的编辑锁定语义 |
| `setReadingMode(boolean)` | Promise；`true` 锁定修改，`false` 允许直接修改，等待后可安全调用编辑命令 |
| `setPanels({ sidebar, sidebarWidth, outline, preferences, help, focus })` | 控制面板和专注模式，侧栏宽度范围 220–480px，每项可省略 |
| `getReadingPosition()` / `restoreReadingPosition(position)` | 获取/恢复当前文档位置，包含像素位置、章节和原文段落锚点；字体或窗口变化时用段落与偏移校准 |
| `scrollTo(number / 'end')` | 正文滚动，数值单位为 px |
| `showImage(url / null)` | 打开 / 关闭图片查看 |
| `getAnnotations()` | 当前文档书签、高亮、划线与批注，返回解析后的文本锚点；原文删除时 `anchor.orphaned` 为 `true` |
| `addBookmark({ text?, sourceOffset?, label? }?)` | 没有指定文本时记录当前阅读位置；返回包含 `id` 的书签 |
| `addHighlight({ text, sourceOffset?, label? })` | 在源文中的指定文本上建立高亮；不传文本时使用当前选区 |
| `addUnderline({ text, sourceOffset?, label? })` | 为原文文本添加划线，不改变 Markdown；支持独立标注撤销/重做 |
| `addNote({ text, sourceOffset?, note, label? })` | 建立文本批注；不传文本时使用当前选区 |
| `updateAnnotation(id, { note?, label? })` / `removeAnnotation(id)` | 修改/删除当前文档的阅读标记 |
| `goToAnnotation(id)` | 定位并显示阅读标记；锚点丢失返回 `annotation-orphaned` |
| `undoAnnotation()` / `redoAnnotation()` | 独立的逐文档标注历史：撤销/重做高亮、划线、批注、书签的添加、编辑、删除，保留正文内容；无历史返回 `nothing-to-undo/nothing-to-redo` |
| `exportAnnotations()` | 保存全部修改指令与个人标记 JSON，不包含在正文导出中；桌面版写入当前 ProoflineData/annotations 并返回 `{ ok, path }`，浏览器下载 JSON |
| `getVersions()` / `restoreVersion(id, { expectedRevision }?)` | 读取最近保存版本及恢复草稿摘要；`id: 'draft'` 恢复草稿。恢复是可撤销的新修改，会触发自动保存 |
| `checkExternalChanges()` / `resolveConflict('reload' / 'overwrite', { expectedRevision }?)` | 检查原文件变化；冲突处理前备份当前草稿和外部版本，随后加载磁盘内容或写回当前内容 |
| `save()` | 写回原始 MD/TXT；没有写入句柄返回 `file-handle-unavailable`，不偷偷改用下载 |
| `exportMarkdown()` | 导出干净的 Markdown；桌面版选择保存路径，返回 `{ ok, path, bytes }`，浏览器触发下载 |
| `exportPdf()` | 后台排版并导出 PDF，桌面版写入后返回 `{ ok, path, bytes, pages, stats }`；浏览器返回 `{ ok, name, pages, stats }`。繁忙返回 `busy`，取消返回 `cancelled` |
| `cancelPdf()` | 取消当前 PDF，导出 Promise 返回 `{ ok: false, cancelled: true, code: 'cancelled', revision }` |
| `getPerformanceReport()` | 最近打开耗时、PDF 耗时、长任务、错误、已挂载分块/节点数和可用的堆内存数据 |
| `clearDiagnostics()` | 清空本次会话的性能和错误记录 |

桌面版原生文件桥只接受已打开文件、目录及持久历史的授权路径。主界面没有通用 Node/文件系统访问权限；关联图片通过专用资源协议读取。浏览器不能直接 fetch `C:\...` 绝对路径，要选择文件获得句柄或使用 CLI。保存仅作用于打开的 MD/TXT。

自动保存约延迟 700ms；切换、失焦和关闭窗口时刷新写入。`replaceContent` 返回表示内容已就绪，使用 `await save()` 等待磁盘完成，或监听 `saveState.status === 'saved' && !dirty`。`conflict` 表示外部内容已变化，应用不会覆盖；可先导出副本保留修改。没有源句柄或不支持原格式时状态为 `session`。撤销有容量限制，不跨程序重启持久化。

标签分别保留草稿、撤销/重做、查找、阅读锁定及滚动位置。桌面端重启恢复原生文件标签、阅读位置、展开章节、搜索和偏好。恢复草稿及保存版本存入 IndexedDB，存储成功后可跨重启手动恢复；撤销历史不跨重启。最近关闭的标签最多保留 5 个会话快照，合计约 32MB。保存版本每篇最多 8 个，通常合计不超过 32MB，至少保留最新版本和待恢复草稿。

桌面版修改指令、书签、高亮、划线和批注自动存入安装目录下的 ProoflineData/annotations，Mac 使用应用包旁的 ProoflineData，开发模式使用 .redline-data。写入使用临时文件替换，并保留上一份 .bak；目录不可写时显示错误，可在 AI 工具设置中迁移数据目录。旧文档旁的 .redline.json 及旧版浏览器标记在读取时迁移。网页版继续使用浏览器存储。标记不写入 Markdown，也不出现在正文导出里。跨设备迁移应复制 ProoflineData、文档及其 .assets 目录；同名、同内容且匹配唯一时重新关联标记，其他情况不保证自动关联。恢复草稿、会话和阅读偏好仍属于本机 profile，不在这套 JSON 迁移范围中。定位使用原文摘录与上下文匹配，原文删改导致无法匹配时显示位置失效，每篇最多 1000 条。完整接入和迁移说明见 [CLI_INTEGRATION.md](CLI_INTEGRATION.md)。

错误码以 `describe().errors` 为准。常用错误包括 `reading-locked`、`revision-conflict`、`file-conflict`、`permission-denied`、`write-failed`、`invalid-regex`、`unsafe-regex`、`cancelled`。页面异常、事件桥和 CLI 都保留相同 `code`，业务失败保留原始 `error` 和结果对象。正则按行匹配，不支持跨行模式；为控制性能风险拒绝部分嵌套重复和回溯语法。

```js
const tab = reader.getTabs().find((item) => item.active);
const mark = reader.addNote({ text: '重要结论', note: '下次从这里继续', sourceOffset: 0 });
await reader.openTab({ name: '第二篇.md', content: '# 第二篇\n\n对照内容' });
await reader.switchTab(tab.id);
await reader.goToAnnotation(mark.id);
```

## 事件桥

先监听结果，再发送请求。`id` 用于关联并发任务；不要仅通过文案猜测完成状态。

```js
const result = new Promise((resolve, reject) => {
  const listener = ({ detail }) => {
    if (detail.id !== 'search-1') return;
    window.removeEventListener('mengx-reader:result', listener);
    if (detail.ok) resolve(detail.result);
    else reject(new Error(detail.error || detail.result?.error));
  };
  window.addEventListener('mengx-reader:result', listener);
});
window.dispatchEvent(new CustomEvent('mengx-reader:command', {
  detail: { id: 'search-1', method: 'search', args: ['预算'] },
}));
await result;
```

`mengx-reader:changed` 在文档或 UI 状态变化后发送状态快照。监听 `getState().pdf` 可以显示进度；等待 `exportPdf()` 的 Promise 才表示下载已发起。未知命令、非法参数和异常返回 `{ id, ok: false, error, code }`，业务失败同时保留 `result`。

## CLI 会话

```powershell
npm run build
node scripts/reader-cli.mjs session --desktop --output test-fixtures/results/desktop-automation
```

AI 进程可使用 Node/Python 的子进程 API，与 CLI 标准输入/输出交换 JSON Lines。直接调用 `node` 可避免 npm 的额外日志。桌面会话使用构建后的独立窗口，无需服务或点击 UI；`--visible` 显示窗口，`--profile <目录>` 保留偏好/历史。测试已生成的打包版时增加 `--executable "release/win-unpacked/Proofline.exe"`。

省略 `--desktop` 会启动独立 Edge，此时需要开发服务；`READER_URL` 默认 `http://127.0.0.1:5173/`，`EDGE_PATH` 可自定义 Edge/Chromium 可执行文件。独立会话不控制用户现有窗口。

CLI 支持表中页面方法，但 `File`/句柄参数不能直接用 JSON 表达，使用以下额外命令：

| CLI 命令 | 参数 |
| --- | --- |
| `openPath` | `["C:/.../file.md"]`，支持全部导入格式，建立可写回的本地适配句柄 |
| `openFolderPath` | `["C:/.../folder"]`，桌面版按需浏览该目录，工作区全文搜索时遍历子目录，跳过符号链接 |
| `openReferencePath` | `["C:/.../other.docx"]`，打开右侧文档 |
| `capture` | `["reader.png"]`，截图写入输出目录 |

```json
{"id":"1","method":"openPath","args":["C:/Users/you/Documents/report.md"]}
```

返回示例：

```json
{"id":"1","ok":true,"result":{"ok":true,"name":"report.md","path":"C:\\Users\\you\\Documents\\report.md","revision":1}}
```

必须等待打开的返回结果，再发送 `search` 或 `replaceContent`。互相独立的请求可并发，例如 `exportPdf` 执行中发送 `getState` 或 `cancelPdf`。导出响应包含已经保存的 `downloads` 路径；标准输入 EOF 会等待现有任务、尝试保存当前修改并关闭会话。如仍有未保存内容，会输出 `unsaved-session-content` 警告，调用方应先导出或处理保存失败再发送 EOF。

```json
{"id":"2","method":"search","args":["视觉终端"]}
{"id":"3","method":"goToMatch","args":[7]}
{"id":"4","method":"exportPdf","args":[]}
```

修改会自动写回 `openPath` / `openFolderPath` 选定的 Markdown/TXT。每次通过本地句柄重新打开时读取磁盘最新内容；若有冲突尚未保存，重开历史会保留会话修改，避免丢失。调试必须先复制源文件。删除命令同样需要先请求，再由调用方获得确认后提交 token，不能用清除历史替代删除。

HTML/DOCX 的修改只可导出 Markdown/PDF，不能写回原格式。PDF 统一使用 Worker 排版和嵌入中文字体，正文可选择复制；段落与表格公式为矢量，Mermaid 为 SVG，本地图片通过已授权的资源路径加载。`stats` 包含 `formulas`、`diagrams`、`images`、`repeatedTableHeaders`、`fallbacks` 和最多 20 条 `fallbackReasons`（`kind`、`message`），可用于验证复杂内容是否降级。文档导出不会包含工具栏、文件格式、字数或阅读标记。

表格跨页重复表头；超过单页高度的表格行或过窄的列展开为带列名的段落，保留全部文字。代码自动换行并分页。复杂内容有边界：公式输入最多 10000 字符；最多渲染 100 个 Mermaid，每个输入最多 8000 字符；单个图片最多 16MB、加载限时 5 秒。渲染失败时保留公式源码、图表代码或图片替代文字，不中止全文；动画图片在 PDF 中使用静态帧。PDF 独立排版不保证与阅读视图逐像素一致，HTML/DOCX 也不保证恢复原软件的版面。导出期间可继续操作界面，通过 `cancelPdf()` 终止 Worker。

Windows 桌面版已支持独立运行和便携打包。文件选择器和 CLI 路径命令都在本机读取用户指定的文件或目录，不向服务器上传文档，也不扫描未指定的位置。

网页链接由系统默认浏览器打开（HTTP、HTTPS、mailto）；文内锚点留在阅读器，相对文档路径通过当前已打开文件的授权解析。阅读器不内置浏览器。批注在独立侧栏显示，不在正文上叠加图标；高亮使用统一颜色，划线有独立侧栏。四种阅读标注均可自定义名称，有独立查找与撤销/重做。`getState().annotations.canUndo/canRedo` 用于判断标注操作可用性，`document.canUndo/canRedo` 只表示正文历史。阅读锁定时 Ctrl+Z/Y 在标注页签中操作标注；编辑正文时操作正文。所有编辑区关闭拼写检查。
