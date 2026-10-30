# Magnetic Tiles Studio — Workflow UI 整理与术语统一 V1

本轮只调整展示位置和用户可见术语。没有修改 Profile、识别、匹配、Relative Size、几何验证、Reconstruction、Assembly、Build 的数据与计算规则；Selected Snapshot 服务端存储和 CAS 均保持原样。付费 Vision / LLM 调用为 **0**。

## 控件归属

| 位置 | 保留 / 迁移后的内容 |
| --- | --- |
| 左栏 | 五阶段导航；紧凑「当前图片」选择；History（Analysis、Review 及各自 Selected 星号，Reconstruction 历史）；共享草稿恢复、操作反馈及错误 |
| 图片与识别 Inspector | 图片来源、服务器图库选择与刷新、上传、下次识别模型、识别图片按钮；实际模型 / Usage / 原始 Analysis 输出仍可展开 |
| 识别审核 Inspector | Profile 选择与匹配、零件编辑、排除 / 恢复、手工零件删除；中栏新增零件与保存审核快照保持原位 |
| 几何重建 Inspector | 审核来源摘要、几何重建作品模式、唯一的「生成几何重建」按钮、Candidate 与诊断及打开作品入口 |
| 作品编辑 Inspector | 现有零件工具、作品属性与保存 / 导入导出 |
| 搭建教程 Inspector | 从左栏移入的教程来源作品选择、来源状态及返回作品编辑；与原有生成 / 保存 / 播放控制放在同一栏 |
| Tiles Catalog | 右栏全局 Tab，保持现有列表、详情和持久化 |

标签和选择框尽量同行；服务器图库刷新采用短按钮；来源摘要省略显示且可 Hover 查看全文；草稿恢复与说明图标同行。长说明放入现有 InfoHint / details，没有新增管理页面或卡片。

## 重建入口调查

原 UI 在 `ImageIntake` 中只有一个 JSX 控件组，但其 `StudioSlot` 同时包含 `review` 和 `reconstruction`。两阶段共享同一 `mode`、`review`、`result` 和点击处理器：

`intakeApi('reconstruct', { reviewId, reviewHash, mode })`

服务端现有 `POST /api/magnetic-intake/reconstruct` 校验 Review / Source 来源链及 Hash，调用 `reconstruct(...)`，新增不可变 Reconstruction 快照。两个视图没有不同语义或不同的数据依赖。

现仅将该 Slot 限制为 `reconstruction`，沿用原处理器与模式值。在缺少已保存 Review 时仍显示入口和具体提示，执行按钮禁用；先在 Review 保存，或通过左栏 History 打开 Review。没有在 Review 添加替代执行按钮。

## 术语

导航、阶段标题和 Inspector 使用统一的显示词典 `studio-terms.ts`：

1. 图片与识别（Analysis）
2. 识别审核（Review）
3. 几何重建（Reconstruction）
4. 作品编辑（Assembly）
5. 搭建教程（Build）

「重建作品模式」改为「几何重建作品模式」，「重建二维布局」改为「生成几何重建」。模式显示为「整体连通（Connected Construction）」和「平面拼图（Flat Mosaic）」；仍使用原枚举 `connected-construction` / `flat-mosaic`。`artwork.ts` 仅更新显示用 `modeLabel`，未改计算逻辑。技术 ID、URL 参数和历史 Schema 均不重命名。

## 状态及兼容

- 继续由 `ImageIntake` 持有 Source、Analysis、Review、Draft、候选和模式。迁移控件仍调用原事件处理器；没有复制业务操作。
- `StudioSlot` 持续挂载，阶段 / Catalog 切换仅隐藏相应区域，不重置选择、匹配结果或草稿。
- `sourceType`、`model`、`sourceId` 继续使用现有 URL 与偏好恢复。切换阶段和恢复 URL 不执行识别或重建；只有显式按钮才发起对应请求。
- Current 仍由 URL 决定，Selected 仍由服务器引用决定，Draft 继续采用现有本地保留 / 显式恢复及历史切换前保护机制。
- History 不增加 Reconstruction Selected。Analysis / Review 的星号、优先排序、来源差异提示及 CAS 不变。保存新 Review 不自动改变 Selected。
- 三栏、Review 表格 / 原图上下分栏、候选对照分栏及各自滚动保持原实现。

## 修改文件

生产 UI：`StudioLayout.tsx`、`intake/ImageIntake.tsx`、`intake/ReviewWorkspace.tsx`、`BuildPanel.tsx`、`main.tsx`、`style.css`；新增 `studio-terms.ts`。均位于 `src/magnetic-tiles/`。`artwork.ts` 只改模式显示名称。

验收：新增 `scripts/verify-magnetic-workflow-ui.mjs` 和 npm 命令 `test:magnetic-workflow-ui:browser`；更新 `magnetic-studio-browser.mjs` 的真实 UI 导航助手。既有 browser 脚本中的可见名称 / 控件归属断言同步更新；没有降低评分、几何或历史不可变断言。

同步更新的既有验收脚本：`verify-magnetic-build-viewer.mjs`、`verify-magnetic-catalog.mjs`、`verify-magnetic-compact-nav.mjs`、`verify-magnetic-intake.mjs`、`verify-magnetic-library.mjs`、`verify-magnetic-mosaic.mjs`、`verify-magnetic-panels.mjs`、`verify-magnetic-partial.mjs`、`verify-magnetic-preferences.mjs`、`verify-magnetic-profile-match.mjs`、`verify-magnetic-relative-size.mjs`、`verify-magnetic-review-ui.mjs`、`verify-magnetic-review.mjs`、`verify-magnetic-selected.mjs`、`verify-magnetic-url.mjs`。另修改 `package.json` 注册新增验收命令，本报告为 `doc/magnetic-workflow-ui-v1.md`。

## 验证

- `npm run build`：TypeScript 和生产构建通过；保留项目原有的部分 bundle 超过 500 kB 提醒。
- `node --experimental-strip-types --test test/magnetic*.test.mjs`：67 / 67 通过，覆盖 Catalog URL、Selected / CAS、Review 编辑、相对尺寸、几何、Intake、重建与 Build。
- 新增 Workflow 浏览器验收使用现有玫瑰花 Selected Analysis / Review 和真实 API：控件只在所属阶段显示；Source / History 五阶段可见；阶段 / Tab 切换零自动执行；P1 匹配、选择及编辑保持；草稿刷新恢复；追加 Review 不改 Selected；实际重建参数和来源链；图库 / 上传去重；URL / 新标签 / Back / Forward；1024px 和 430px 布局。
- 相关浏览器回归：19 组（Workflow、Review UI、Catalog、Relative Size、Profile Matching、Review Table、URL、Selected、Mosaic、Assembly、Build、Build Source、Build Viewer、Partial、Intake、Compact Navigation、Library、Preferences、Panels）。真实 17 片作品成功重建为 3 个组件、17 条连接，并完成 17 步教程播放 / 保存 / 刷新 / 导入回放；像素检查和 430–1920px 布局通过。Intake 使用 `MAGNETIC_LIVE=0`，仅读取既有真实 Analysis；历史 Usage 不代表本轮新调用。
- 浏览器截图与本轮结果：`/tmp/magnetic-workflow-ui/`。相关回归结果见 `/tmp/workflow-regression-results.json`，详细日志为 `/tmp/workflow-regression-*.log`。

玫瑰花既有匹配未变：P1 Tall Right Shape 87.8% / Size 92.3%；P2 Large Equilateral 100.0% / 100.0%；P3 Tall Right 86.3% / 92.6%。低分候选人工应用与 Size Unknown 也在现有回归中验证。

复现主要检查（保持本地服务启动，且玫瑰花已有 Selected Analysis / Review）：

```bash
npm run build
node --experimental-strip-types --test test/magnetic*.test.mjs
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-workflow-ui:browser
```

## 手动验收

1. 打开 `magnetic-tiles.html?stage=review&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`。无本地草稿阻挡时沿用 Selected；也可从 History 手动打开选定 Review。检查星号与 Current 独立。
2. 在 Review 选 P1，点击 Find Matching Profile，改颜色但不保存。切换五阶段，再切 Catalog / Inspector，回 Review 检查 P1、匹配结果及未保存编辑仍在。Review 右栏不出现重建模式或生成按钮。
3. 保存一个新 Review，确认 Selected 仍指向原记录；在几何重建 Inspector 选择模式、显式点击生成，检查来源、候选和诊断。
4. 在图片与识别 Inspector 切换服务器图库、刷新和上传，选择下次模型。无需点击识别图片即可验证布局和 URL 偏好；本轮无须调用模型。
5. 在 Assembly 检查作品编辑；在 Build 检查右栏教程来源与生成 / 播放控制，左栏仍是当前图片与 History。
6. 复制 URL 新开标签，刷新，使用 Back / Forward；检查当前记录、Selected、Tab。拖动三栏及中栏分隔线，测试窄屏、各栏独立滚动。

## 限制与已有诊断

当前 Selected Rose Review 的输入类别仍为 `unsupported`。本轮实际生成得到 **0 个候选、搜索 0 状态**，原因是现有 Review 未确认输入可用于完整二维重建。保留原诊断，没有为 UI 验收修改来源类别或几何验证规则。查看匹配分数不等于允许完整重建。

窄栏中的长技术名称和 ID 会截断，可 Hover 查看完整信息。只有相应阶段 Inspector 显示其操作；切到 Catalog 时需切回 Inspector 执行该阶段操作。原始 Analysis 和历史快照不覆盖；浏览器验收追加的 Review / Reconstruction 仍保留在历史中。
