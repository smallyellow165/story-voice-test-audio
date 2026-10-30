# Review 输入类别与保存操作 UI 调整

本轮只调整 Review 工具栏的位置与反馈，保留此前所有未提交修改。

## 最终布局与状态

中栏 Parts Review 顶部第一行为标题、新增零件、保存状态、保存审核快照；第二行为输入类别下拉框及 Info Hint。窄屏允许标题行自然换行。筛选、搜索和表格继续在工具栏下方，Source Evidence 及上下分栏不变。

右栏不再包含输入类别，继续用于 Profile Matching、零件编辑及关系审查。提示中的位置说明已指向中栏。

三个选项及枚举保持原样：`unsupported`、`flat_photo`、`diagram`。类别控件仍直接修改 `ImageIntake` 的完整 `draft`，没有引入第二份状态；调用现有 `edit(...)` 后 `review` 变为 null，顶部立即显示 **未保存 · 请保存快照**。保存仍由原 `saveReview()` 提交完整 `evidence: draft`，包括类别与所有零件修改；成功后显示 **已保存**。

没有新增确认按钮、自动保存、Schema 或 URL 参数。现有本地草稿保留 / 显式恢复，以及切换历史前的草稿保护原样保留。Selected、历史快照和二维准入规则不变。

截图检查还发现移动布局中 Review 面板百分比高度塌缩，导致工具栏虽有 DOM 却被零高父面板裁切。增加仅作用于移动 Review 中栏的 `100dvh` 高度，保持其内部上下分栏可测量；没有更改分栏比例、持久化或其他阶段。

## 本轮文件

- `src/magnetic-tiles/intake/ImageIntake.tsx`：将原类别控件作为 `inputControl` 传入中栏；保存状态提示及 Info Hint 位置说明。
- `src/magnetic-tiles/intake/ReviewWorkspace.tsx`：在标题行之后显示类别控件。
- `src/magnetic-tiles/style.css`：紧凑类别行及移动 Review 高度修正。
- `scripts/verify-magnetic-review-toolbar.mjs`：新增真实 UI / API 验收。
- `scripts/verify-magnetic-review-ui.mjs`：断言类别位于中栏且 Inspector 无重复。
- `scripts/verify-magnetic-review-reconstruction.mjs`：适配类别仅在 Review 中栏显示，并独立保护当前 Selected；使用历史 unsupported Review，不假设当前 Selected 仍是 unsupported。
- `package.json`：新增 `test:magnetic-review-toolbar:browser` 命令，保留此前脚本。
- 本报告 `doc/magnetic-review-input-toolbar-v1.md`。

本轮未修改前次遗留的 `contracts.ts`、`reconstruct.ts`、Profile / Geometry / Matching / Relative Size / Build 算法或服务端 Selected 存储。

## 验证

- TypeScript 与生产构建：`npm run build` 通过；保留已有 bundle 大小提醒。
- Magnetic Tiles 单元测试：`node --experimental-strip-types --test test/magnetic*.test.mjs`，**71 / 71** 通过。
- 新增工具栏验收：两行位置、三个枚举、无 Inspector 重复、Info Hint、立即未保存且不发请求、类别与颜色一起保存、保存后真实重建读取类别、本地草稿刷新恢复、历史切换保护、Current URL / 新标签 / 刷新、原 unsupported Analysis / Review 与当前 Selected 不变、筛选与匹配、1024px / 430px 布局。
- 移动端检查实际按钮 / 字段位于 Parts Review 可见范围，表格与原图滚动区均有有效高度，已查看截图；不只依赖 DOM 可见性。
- 浏览器验收共 **7 组通过**（新增工具栏验收 + 6 组相关回归）：Review → Reconstruction（两种模式）、Review UI（含新增 / 删除 / 排除 / 恢复）、URL、Catalog、Workflow UI、Parts Review Table。
- 付费 Vision / LLM 调用 **0**。生产路径未引入 Mock。

产物：`/tmp/magnetic-review-toolbar/`（桌面、未保存、已保存、窄屏截图及 result.json）；相关回归日志与结果为 `/tmp/review-input-toolbar-*.log`、`/tmp/review-input-toolbar-regressions.json`。

```bash
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-review-toolbar:browser
```

## 手动验收

1. 刷新 Studio，打开玫瑰花 Review。中栏顶部可见保存按钮，下一行可见输入类别；右栏没有重复下拉框。
2. 修改输入类别，检查同一区域立即显示「未保存 · 请保存快照」。可同时改某个零件颜色 / Profile。
3. 点击「保存审核快照」，检查状态变为「已保存」，History Current Review 为新 ID，Selected 星号不自动移动。
4. 进入 Reconstruction，使用新 Review 生成，确认读取新类别。没有合法候选时仍按既有严格规则显示真实诊断。
5. 复制保存后的 URL 到新标签并刷新；再修改类别但不保存，刷新后通过原「恢复本地审核草稿」恢复。切换历史 Review 时检查原有草稿保护。
6. 检查新增零件、表格筛选、Profile Matching、三栏宽度与上下分栏拖拽；在手机宽度切换工作区 / Inspector，输入类别与保存按钮仍属于中栏。

## 限制

窄屏下标题与操作可换行，长说明仅按需显示。既有玫瑰花的几何拟合 / 翻面限制不属于本轮修改，0 候选的几何诊断仍保留。验收只追加新 Review / Reconstruction，原历史与当前 Selected 均不改写。
