# Magnetic Tiles — Intermediate Outputs & Trace V1

## DUPLO 调查与复用边界

已检查现有实现：

| 环节 | 现有机制 / 对应文件 | 本轮采用 |
| --- | --- | --- |
| Parts Explorer | `server/brick-reverse.mjs` 保留结构化 Analysis、rawOutput、请求 / 响应；`server/brick-parts-input-source.mjs` 从已保存人工 Review 构建实例、reviewVersion、provenance、manualRelations | 原始与人工证据分别展示，保存执行时有效输入，用 ID / Hash 关联来源 |
| Spatial Planning | `experiments/spatial-planning/input.mjs`、`plan.mjs` 定义相对位置区间、relativeTo、yawCandidates、连接意图、不确定性；`server/brick-spatial-workflow.mjs` 保存 requestInput / sourcePlan / sourceInput / prepared input | 清晰区分模型输出、审核意图、确定性整理及实际执行输入；不引入新的规划模型 |
| Geometry Execution | `experiments/geometry-execution/execute.mjs` 保存实际 attempts；`ranking.mjs` 确定性排名和去重；`SpatialAssemblyPanel.tsx` 分开 Valid / Diagnostic，失败布局不可采用 | 真实尝试采样、确定性代表排名、失败与正式候选隔离、共用已有几何 Viewer |
| Trace Viewer | `server/llm-traces.mjs` 的 `shareText` 负责凭据和图片 base64 脱敏；`src/llm-traces/main.tsx` 按历史 ID 懒加载，只读查看和复制完整文本，缺失 wire 文件明确 unavailable | **直接复用 `shareText`**，在 Studio 增加小型只读 Trace 弹窗，不新增管理页面或 Workflow 阶段 |

DUPLO 的 LDraw、凸点 / 底部接合、LDU、3D yaw/网格和装配规则均未复制。Magnetic Tiles 继续使用相对单位、二维 Profile、原 Validator 和原 Reconstruction。

## 三类输出与入口

在图片与识别、识别审核、几何重建的 Inspector 标题旁点击 **Trace / Raw**，通过三个页签查看：

1. **Parts / Review**：原始 Analysis（含已保存 request、response、rawResponseBody、rawOutput、模型及 Usage）、完整 Review、Source / Analysis / Review ID / Hash。Review 入口还明确标注运行时 Draft、选中 Observation 和当前 Shape / Relative Size 候选分数及参考尺度。原 Parts Review 表格和匹配交互保持原样。
2. **Spatial Planning**：Review 零件轮廓的像素质心、每条边方向、相对位移、连接意图与原证据 / uncertainty、镜像形状比较结果、实际执行的刚体种子 Pose、全局尺度和搜索分组。没有独立 Spatial Planning 生成阶段，明确标为 `deterministic-review-input` / `modelGenerated:false`。质心为角点算术平均，不宣称是物理质心或真实测量值。
3. **Geometry Execution**：执行时完整 Review evidence、图片尺寸、当时 Profile 定义快照、模式、所有搜索参数、状态 / 尝试计数、原始剪枝统计、合法候选及 Diagnostic Top 10。包含失败阶段、Pose、尝试边、RMS、Validator / 实际连接和意图对照。

Trace 是只读 JSON，可完整复制；只在打开时读取并脱敏。缺失字段明确通过 `savedFieldAvailability` 表示，不从准备请求或解析输出补造。保存的应用请求**不宣称等于精确 HTTP wire 字节**；响应对象与原始响应文本分别标注来源，历史未保存的 wire 原文仍不可恢复。

只读接口：`GET /api/magnetic-intake/trace/analyses/:id`、`trace/reviews/:id`、`trace/reviews/:id/planning`、`trace/reconstructions/:id`、`trace/reconstructions/:id/planning`。返回现有脱敏工具生成的完整 `text`。

## 持久化与真实性

- 新 Reconstruction 使用现有不可变存储，增加可选 `trace` 和 `diagnosticCandidates`。不另建数据库、通用 Trace 服务或副本主链路。
- `trace.input` 是实际传入搜索的 evidence、宽高、Profile Catalog 快照及模式；参数包括 6000 状态、100000 对齐尝试、0.300 标准单位 RMS、原 EPS、3 个局部解 / 正式候选上限、原锚点距离及 `mirroring:false`。
- `trace.references` 保存 Source / Analysis / Review 的 ID / Hash、Profile Hash、Reconstruction ID。Reconstruction 自身 Hash 由外层记录和 Trace 响应引用，避免循环 Hash。
- 读取执行 Trace 时校验来源链、输入 evidence、图片尺寸 / 模式、Catalog 快照及引用的一致性。篡改引用即使重新生成文件 Hash 也被拒绝。
- **历史列表仅返回 Trace 可用性与诊断数量，省略大 Trace / 失败 Pose**；选择历史或恢复 URL 时按 ID 读取完整 Reconstruction。玫瑰花完整新记录约 125–140 KB；没有保存全部搜索日志。
- 运行时 Draft 与当前选中零件的匹配结果不自动保存，明确标 `persisted:false`。新执行中的匹配整理根据已保存 Review 和当时 Catalog 重算并固定；不会假装保存了临时人工尺度参考确认集合。
- 新执行的空间种子 / 规划整理、Top 10、统计和实际输入已持久化。旧执行缺少这些字段时显示 unavailable，不事后运行搜索或回填 Pose；缺失结构化 Analysis 时规划为 null。
- 不新增翻面 Pose 或朝向枚举域。边方向与形状镜像比较是可观察 / 可推导信息；执行种子只有实际拟合旋转，不是已实现的规划方向候选域。

## Diagnostic Top 10 如何产生

在原搜索的三个拒绝点直接观察实际 Tile 数组：

- `outline`：`alignEdge` 已产生真实 Pose，RMS 超过原 0.300 阈值；保存此时的已放置布局和新增 Tile。
- `geometry`：原 `acceptable()` 的 Validator 结果拒绝。
- `relation`：原明确 connect / separate 检查拒绝，保存实际意图和已计算 Validator 结果。

记录真实尝试号 `attemptIndex` 和状态号 `stateIndex`、连接两端及边 ID、已 / 未放置零件、实际 Pose、被尝试零件 RMS、布局 RMS 与各零件 RMS。没有为失败记录单独生成布局，没有放宽接纳条件。

内存中仅保留 10 个代表项，加当前待处理零件最近的一条实际轮廓失败；若明确连接域被堵塞，将这条已捕获的真实失败标为 `domainBlocked` 供优先诊断。去重键为按 Tile ID 排序后的实际世界顶点，精度 1e-7，并规范化负零，可合并对称 / 重复摆放。

代表排序：被堵塞的明确连接域优先；每个连接对 / 失败阶段先显示一个代表，再填入其他摆放；同类按放置数量降序、被尝试零件 RMS 升序、尝试号与几何键稳定排序。它是**本次搜索已观察失败的有界代表 Top 10**，不是全局最优前十，也不声称完整枚举。

轮廓阶段原搜索尚未运行 Validator。对最终保留的这些项才做只读复检，标 `validator.checkedBy: diagnostic-recheck`；原实际检查过的项标 `search`。复检不计入搜索剪枝统计、不参与候选生成。因此子布局可能 Validator Valid，却仍因 RMS / 不完整而不可作为正式作品。

## Viewer、历史与草稿

几何重建的现有「候选」下拉框分成 **Geometry Valid** 和 **Diagnostic Top 10**。已前移到长诊断文字之前；0 个合法候选时默认显示第一个诊断布局。

诊断布局继续由现有 `AssemblyPreview` / 中栏 Candidate Viewer 显示实际 Pose，标注 Diagnostic、Partial / Complete、放置数与失败阶段。不会补齐未放置零件。右栏可展开完整失败记录。只有原 Valid 分支才有「在作品编辑器中打开」操作；服务端 origins 路由也不会接受 diagnostic ID。

沿用 `candidateId` URL 参数表示选中布局，诊断 ID 必须属于所选 Reconstruction，复制 URL、刷新、Back / 新标签均恢复相应 Pose。旧合法候选和历史 URL 保持兼容。

回归中修正了一个暴露出的关联问题：编辑 Review 清除旧 Reconstruction 后，URL 同时移除旧 candidateId，防止悬空布局 ID 阻碍草稿刷新恢复。没有改变原 Draft / 保存 / 历史切换保护机制。Selected 服务端存储及 CAS 未改。

## 玫瑰花真实结果

使用既有 Review `836c266b-1b94-40c9-aa96-a7631cd94d3d`（14 块 Known、二维类别已确认），Analysis `ec08916f-a0d5-4be7-964e-f63a52df22b9`。没有重新识别、修改 Review 或改变当前 Selected。

| 模式 | 状态 / 尝试 | Valid | Diagnostic | P3–P6 实际边 | 失败 RMS | 已放置 |
| --- | --- | --- | --- | --- | --- | --- |
| Connected Construction | 10 / 474 | 0 | 10 | P3.e0 → P6.e2 | 0.5910235265 | 11/14 |
| Flat Mosaic | 10 / 165 | 0 | 10 | P3.e0 → P6.e1 | 0.6069919542 | 2/14 |

整体连通的代表失败是第 **468** 次对齐、状态 **10**；未放置 P1 / P2 / P4。平面拼图是第 **158** 次对齐、状态 **9**；当前局部组只有 P6 和新增 P3，其他 12 块未包含在该条布局中。

这两条真实摆放都可视化；只读 Validator 复检显示子布局本身可整边连接，但原搜索已先因 P3 对齐后 RMS > 0.300 淘汰，且没有完整放置 14 块。因此它们不是合法完整玫瑰花，不能采用。两模式各 10 条诊断的几何键与实际 SVG 均不同。

P3 / P6 相对位置、边方向、Review connect 意图、原 uncertainty、P3 镜像形状比较与执行不支持翻面的差异，均可在 Spatial Planning JSON 查看。并未将这些信息伪装为新的模型 Spatial Plan。

本次可直接查看 [Flat Mosaic 的 Diagnostic 1](http://127.0.0.1:5175/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&observationId=p3&rightTab=inspector&catalogProfile=square%401&sourceType=uploaded&model=gpt-4.1&reconstructionId=4e1edb0d-b6a9-4dd5-8605-06c7c8111f31&candidateId=diagnostic-1)。本链接仅加载已有结果，不执行搜索或改变 Selected。

## 修改文件

- `src/magnetic-tiles/intake/execution-trace.ts`：确定性空间整理、Trace 类型、有界采样 / 排名 / 去重。
- `src/magnetic-tiles/intake/reconstruct.ts`：原拒绝点插入只读采样与参数 / 种子记录；原算法和阈值保留。
- `src/magnetic-tiles/intake/contracts.ts`：可选 Trace / Diagnostic 类型。
- `server/magnetic-intake.mjs`：新执行持久化、只读脱敏 Trace API、引用校验、精简历史列表。
- `src/magnetic-tiles/intake/TraceViewer.tsx`：小型只读弹窗 / 页签 / 完整复制。
- `src/magnetic-tiles/intake/ImageIntake.tsx`：三个阶段入口、诊断选择 / 实际 Viewer、完整历史懒加载、URL 关联。
- `src/magnetic-tiles/style.css`：紧凑入口、只读弹窗及诊断说明。
- `test/magnetic-trace.test.mjs`：实际边对齐 / RMS 复算、唯一性、有界性、历史 / Hash / 脱敏 / 不可采用 / 缺失数据测试。
- `test/magnetic-intake.test.mjs`：构造真正无 Trace 的旧 Catalog 快照兼容样例。
- `scripts/verify-magnetic-trace.mjs`、`package.json`：真实浏览器验收与命令。
- 本报告 `doc/magnetic-intermediate-trace-v1.md`。

现有 Profile、Relative Size、Shape Matching、Geometry Validator、Assembly / Build 核心没有修改。前次未提交的 Review UI 修改均保留。

## 验证

- TypeScript + 生产构建 `npm run build` 通过；仍有项目原有大 bundle 提醒。
- **79 项测试通过**：Magnetic Tiles 76 项及既有 Trace 脱敏 3 项。
- 使用修改前源文件在临时目录作只读对照：5 组通用输入 + 玫瑰花、两模式共 **12 组**，新旧合法候选、状态数、尝试数、截断状态和结果完全一致，结果在 `/tmp/magnetic-trace-search-equivalence.json`。
- **12 组浏览器验收通过**：新增 Trace、Review Toolbar、Review UI、Review → Reconstruction、URL、Catalog、Mosaic、Intake（MAGNETIC_LIVE=0）、Build、Build Source、Build Viewer、Panels。包含 17 片真实作品重建和完整 Build 回放。
- 新 Trace 浏览器验收检查 14 块原始 / Review 证据、P3/P6 推导、每模式 10 条不同实际布局、精确 0.591 / 0.607 RMS、逐 Tile SVG 与保存 Pose 一致、不可采用、Draft、旧记录、复制 URL / 刷新 / Back / 新标签、430px。
- 验收起始的 **541 条历史快照逐字节保持一致**，当前 Selected（含 revision）不变；付费模型调用 **0**。

截图、实际执行 ID / Hash / Pose 和当前 URL：`/tmp/magnetic-trace-v1/`。回归日志：`/tmp/magnetic-trace-regression-*.log`，最终汇总 `/tmp/magnetic-trace-regression-results.json`；单测 `/tmp/magnetic-trace-unit-final.log`。

```bash
npm run test:magnetic-trace
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-trace:browser
```

## 手动查看与限制

1. 若运行中的 Node 服务没有监听变更，重启后刷新 Studio。进入玫瑰花图片与识别或 Review，在 Inspector 标题旁打开 Trace / Raw，查看 Parts / Review。
2. 在 Review 中选择 P3，再打开 Trace 查看当前运行时匹配；切 Spatial Planning，检查相对位置、方向、镜像比较、P3–P6 connect 和 uncertainty。没有独立规划模型输出的地方保持明确标注。
3. 打开已确认二维的 Review，在几何重建显式生成。分别选择两模式，候选下拉中查看 Diagnostic Top 10；切换条目，中栏显示真实局部摆放。
4. 打开 Geometry Execution Trace，找到 input、references、planning.fittedSeeds、search.parameters / stats 与 diagnosticCandidates。对照原失败阶段、尝试号、实际边、Pose、RMS 和 Validator 来源。
5. 复制 URL 新开 / 刷新，确认结果与选中诊断一致；打开旧历史时看到未记录提示，而非补造的布局。

尚未实现独立 Spatial Planning 生成 / 编辑、翻面 Pose、透视 / 层叠求解、全局最优 Top-K 或完整搜索日志；本轮不尝试修好玫瑰花。仅记录真实拒绝点，不保存全部已接受的中间状态树。Trace 弹窗打开状态及页签为轻量运行时状态，身份与布局选择通过既有 URL 恢复。历史列表仍采用既有服务器文件扫描，虽不向浏览器批量传输大 Trace，但后续大量记录时可另行优化索引。
