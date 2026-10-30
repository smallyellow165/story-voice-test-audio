# Review 顶部两行布局

本轮仅调整 Review UI，保留所有此前未提交修改。

- 第一行：唯一的「识别审核（Review）」标题；右侧新增零件、已保存 / 未保存、保存审核快照。
- 第二行：左侧 All / Known / Unknown / Excluded 数量筛选器；右侧输入类别标签、下拉框和 Info Hint。
- 删除独立 Parts Review 标题及 14/14。搜索、排序、表格和下方 Source Evidence 的交互不变。

Review 标题由其工具栏统一显示；其他四阶段仍使用原工作区标题。移动端保留工作区 / Inspector 导航，控件优先缩小并在极窄栏内受控换行。下拉框被截断时 Hover 可查看当前完整类别。未保存状态缩短为「未保存」，保存提醒仍可通过 Hover / Info Hint 查看。

没有调整类别枚举、Draft、保存处理器、Snapshot / Selected、URL、重建准入或任何几何 / 匹配算法。

## 本轮文件

- `src/magnetic-tiles/StudioLayout.tsx`：仅 Review 不再单独显示外层标题。
- `src/magnetic-tiles/intake/ReviewWorkspace.tsx`：合并标题和操作；筛选器与输入类别同行。
- `src/magnetic-tiles/intake/ImageIntake.tsx`：精简状态显示，增加当前类别完整 Hover 文本；保存逻辑不变。
- `src/magnetic-tiles/style.css`：Review 专用紧凑布局及按栏宽收缩的样式。
- `scripts/verify-magnetic-review-toolbar.mjs`：补充唯一标题、无重复计数、两行对齐、类别最右、拖拽窄栏断言。
- `scripts/verify-magnetic-review-reconstruction.mjs`：状态文字断言跟随「未保存」的简写。
- 本报告 `doc/magnetic-review-two-row-layout-v1.md`。

## 验证

- `npm run build`：TypeScript 和生产构建通过；已有 bundle 大小提醒保留。
- 工具栏浏览器验收：真实历史玫瑰花 Review、完整类别及颜色保存、脏状态、真实 Reconstruction 读取、历史 / 本地草稿保护、Selected 不变、表格搜索、匹配、URL / 刷新 / 新标签、拖拽中右分栏、1024px / 430px 无溢出。
- 相关浏览器回归：Review UI（含新增 / 删除 / 排除 / 恢复、匹配、上下与外层分栏）、Catalog（含三栏拖拽、独立滚动和 Tab 恢复）、URL。
- 已查看桌面、压窄中栏和移动端截图，确认两行对齐及操作可见。桌面顶部较前版少一层独立标题和独立类别行，更多高度用于表格。
- 付费 Vision / LLM 调用为 0；未写入 Selected 映射或覆盖历史快照。

截图：`/tmp/magnetic-review-toolbar/unsaved.png`、`narrow.png`、`mobile-workspace.png`；本轮日志：`/tmp/review-two-row-*.log`。

手动验收：刷新玫瑰花 Review，检查两行位置；修改类别看到「未保存」，点击同一行保存后恢复「已保存」；拖动左右分栏并测试筛选、搜索、选中零件与 Inspector 的联动。

没有已知的本轮业务回归。极窄栏中标签可能截断、筛选按钮可能换行，保证控件不互相遮挡、不产生工具栏横向溢出。
