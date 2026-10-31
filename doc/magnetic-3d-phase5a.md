# Magnetic Tiles Studio — Phase 5A：自动 3D Build Order V1

2026-10-30。完成有预算的确定性规划、候选审核、采用及现有 Tutorial 编辑/保存/播放闭环。本阶段不调用 LLM，不生成照片 Reconstruction，不进入后续阶段。

## 实现与复用

| 模块 | 职责 |
|---|---|
| `src/magnetic-tiles/three-d/build-order.ts` | 纯函数 `generateBuildOrder3D(Assembly3D, options)`；图约束、启发式束搜索、前缀检查、评分及诊断 |
| `build-order.worker.ts` | 在真实 module Worker 中运行同一函数，避免搜索阻塞 Studio；支持终止 |
| `BuildOrderGenerator.tsx` | Build → 3D 的预算、生成、候选报告、过期来源检查及显式采用 |
| `ThreeDBuildWorkspace.tsx` | 接入候选采用；同 ID 的明确重新加载/采用也重建 Player 实例，正确重置相机捕获与播放状态 |
| `checks/magnetic-3d/build-order.vitest.ts` | 17 项规划回归 |
| `scripts/verify-magnetic-3d-build-order.mjs` | Worker、生成/采用、播放、失败、保存及来源隔离的真实浏览器验收 |

继续直接调用阶段一 `validateAssembly3D()` 和 Profile Adapter，复用阶段二 `createViewerModel()` / 世界顶点 / `computeFitCamera()`，使用已有 Connections、`componentCount()` 和保存 Pose。没有 Solver 调用，没有更改 Engine 核心、Profile Registry、LEGO、2D 业务代码或 Assembly3D / Tutorial3D schema，也没有新增依赖。

阶段四上游 TutorialPlayer、编排器、时间线、Editor、存储和导入导出原样作为生成结果的后续流程。没有第二套 Build Plan 或播放器。搜索报告是临时诊断，不是另一种可保存作品格式。本地上游中未发现已有自动 Build Order 规划器，因此新增的搜索和评分属于宿主层能力；已有渲染、几何、镜头及播放均继续复用。MIT、来源哈希和阶段一至四补丁保持，维护说明追加于 `third_party/3D_Magnetic_Pieces/TUTORIAL.md`。

## 算法与确定性

算法版本为 `geometry-beam-v1`，按“一步新增一片”搜索：

1. 做结构和工作量前置检查，然后用现有 Geometry Validator 检查来源实际 Pose、端口、碰撞、连接及闭环残差。最终结构非法时不生成步骤。
2. 最终图须为一个连通组件。合法但不连通的来源返回 `DISCONNECTED_SOURCE`；V1 不将多个组件包装成成功的 Connected Construction。
3. 从多片基础候选开始；每个后续候选须至少有一条来源连接接到已放置集合。可选硬约束为“根片必须接地”和“单步最多新增多少条连接”。
4. 对候选累计子 Assembly 用现有 Validator 检查，传入其原始 Pose 和全部已可见端点之间的原始 Connections，并要求连通。地面穿透单独作为地面/搭建风险，不混同零件之间的几何合法性。
5. 为多个合法候选计算增量成本，比较累计成本。相同已放置子集只保留当前成本最低的前缀，因为后续约束和成本只依赖该子集；每层再按束宽保留候选。
6. 选择搜索到的最低成本完整候选。没有完整候选时明确返回预算/裁剪/无可行顺序原因；有合法前缀则可保留为未完成 Tutorial Draft，不补造剩余步骤。

评分越低越优，没有百分比、物理单位或成功概率含义。尺寸相关项以实际端口长度的中位数归一化，避免按 Shape 名称推断尺寸：

| 成本项 | V1 含义 |
|---|---|
| `base` | 基础未接地惩罚、非水平基础惩罚，以及较大水平接地投影面积的奖励 |
| `height` | 世界最低点与中心高度的软成本；它只是多个因素之一 |
| `support` | 未接地零件的风险成本；区分连接端口是否低于当前零件中心 |
| `overhang` | 零件中心超出当前接地顶点 XZ 包围范围的距离；仅为粗略支撑提示 |
| `closure` | 新增连接数减一的图环数，以及过早闭环成本；不是封闭体或安装可行性的证明 |
| `access` | 非接地水平覆盖片下方投影范围仍有未安装零件时的成本，尽量预留操作空间 |
| `connection` | 连接到既有结构的少量奖励，仍受闭环成本制约 |

因此既不是只按高度排序，也不是固定 BFS。候选主要按世界几何的稳定 key 排序，完全等价时才用 Piece ID 作最后消歧；名称和颜色不参与评分。连接数组和零件数组的排列不影响选择顺序。同一输入及选项得到相同顺序、评分、工作次数和 Tutorial3D；没有随机数、时间戳或墙钟超时参与规划。来源改名/颜色改变时教程需保留新来源内容，文档 ID 可以变化，但几何顺序保持。

## 搜索预算与终止

默认配置：几何检查最多 2000 次、候选展开最多 12000 次、束宽 12、每步新增连接上限 64、不强制根片接地。UI 可调整预算与硬约束。

允许范围：几何检查 0–10000、候选展开 0–100000、束宽 1–32、每步连接上限 1–512。V1 另限制最多 64 片、512 条连接、Profile 原始顶点总量 4096、实例世界顶点 16384、绝对世界坐标不超过 10⁶。原 Profile Registry 的合法性限制仍适用，并未放宽。输入/资源检查不属于几何求交次数。

最终来源检查占一次几何预算。候选子集的几何结果缓存，重复命中不重复消耗检查次数；候选展开另计预算，避免缓存命中或约束拒绝绕过上限。UI 展示实际检查、展开、缓存、裁剪、完整候选数、评分和终止码。Player/Inspector 在采用后按原流程做实时检查，不计入这次搜索工作预算。

| 状态 | 准确含义 |
|---|---|
| `complete` | 找到全覆盖、累计连通且各前缀满足现有几何检查的候选；仍待人工审核 |
| `budget-exhausted` | 检查或展开预算耗尽；可能仅有已检查的部分 Draft |
| `search-limited` | 经过束宽裁剪后未找到完整顺序，不能证明其他路径不存在 |
| `no-order` | 不连通，或在本次未裁剪/未超预算的搜索与明确硬约束下无顺序；不代表物理上不可能搭建 |
| `invalid-assembly` | 来源结构/几何非法，保留原始错误，不运行求解修复 |
| `input-limit` / `invalid-options` | 超出 V1 支持工作量或参数范围 |

找到完整候选但发生过裁剪，也会报告 `SEARCH_TRUNCATED`；不声称全局最优。后台 Worker 可取消；切换来源或离开 3D Build 会终止尚在运行的任务。工作预算是确定性次数，不是耗时承诺。

## 几何、风险与保存数据

四个结论分开处理：

- **Geometry Valid**：由现有 Validator 判断实际保存位姿；包括零件碰撞、端口、连接与闭环残差。
- **Connected Construction**：每步累计图连通，完整候选覆盖全部来源零件。
- **Buildability Estimate**：始终是待审核的启发式建议。单边托持、窄边基础、中心投影越界、提前覆盖、同时闭合多条边等会产生 Warning。
- **Physical Stability**：始终未评估，不模拟磁力、重量、摩擦、承重或真实站立。

没有验证连续安装路径、共享边铰链折叠、手部空间或临时支架。图闭环不等于封闭空间。即使最终和每个前缀 Geometry Valid，也不能据此宣称现实一定可搭建。

输出就是原有 Tutorial3D：完整独立 Assembly3D 快照、来源 ID/revision、BuildStepV2 的 Piece ID、说明、真实来源连接、原位淡入和观察镜头。最终 Pose 在内嵌 Assembly 中保存一次，步骤引用 Piece ID，不创建另一份权威 Pose。镜头复用已有正交 Fit 工具，不保证连接边绝无遮挡；必要时由作者手动调整。

每步 `hint` 保存原始风险建议，`focusPoints` 保存原始增量评分，基础步骤 `parentGuide` 保存算法版本、状态、预算和评分摘要。完整临时搜索报告不另建存储格式。作者改步骤后，这些原始评分只是历史建议；现有实时 Validator 继续检查当前教程，不会把旧规划评分当成新的验证结果。

## UI 与验收

1. 在 Assembly → 3D 明确选择一个作品或已保存 Draft。进入 Build → 3D 教程，右栏“自动搭建顺序 V1”会显示当前来源 ID、revision 和 Geometry 状态。
2. 点 **Generate Build Order**，查看“最近一次生成候选”。这个操作不改变现有 Tutorial，也不开始播放、保存或发布。
3. 没有教程时点“采用为 Tutorial Draft”；已有教程时点“采用候选并替换当前 Draft”，再明确确认。拒绝确认时原教程保持。
4. 候选来源变更后不能采用，必须重新生成。可以多次生成比较；当前 Draft 始终保持到明确采用为止。
5. 采用后使用原时间线编辑标题、说明、分配、顺序和镜头；可 Undo/Redo，自动播放、暂停、跳转、重新播放，也可手动继续编排未完成候选。
6. 点“保存 Tutorial Draft”，刷新后重新进入 3D 教程。导出/导入仍是同一种 Tutorial3D JSON，本地键仍是阶段四的 `magnetic-tiles.tutorial3d-draft.v1`。原 Assembly Draft 和 2D Build 存档不变。

两片示例：选“两片 90° 连接”，生成应为 `base → wall`，两步均 Geometry Valid / Connected Construction 通过；播放时逐步高亮。先保存一份，再重新生成，确认未采用前导出不变；拒绝替换确认后仍不变。

立方体示例：选“闭合立方体 · 12 条连接”，默认生成 `bottom → back → front → left → right → top`。该顺序由通用评分产生，不在实现中指定。逐步点六张卡检查累计几何/连通；最终六片、十二条连接、七个新增图环。查看闭环/支撑警告，人工确认安装方式后再保存。测试会逐字段对比保存前后 Pose、ProfileSnapshot、Connections 和来源 revision。

失败验收：将几何检查预算设 3，立方体只返回已检查的部分候选；设 0 时不做来源检查。将单步连接上限设 1、束宽 1，可看到 `search-limited`；束宽 32 则可见当前硬约束下的 `no-order`。这些操作不能自动覆盖现有教程。混合示例含自由片，应报告不连通；来源 Geometry Invalid 时 UI 禁用自动生成，手动 Draft 流程仍保留。

## 实测结果

以下为默认预算的实际结果；测试不是把这些顺序写进产品算法：

| 案例 | 结果与证据 |
|---|---|
| 两片 90° | 2 步；3 次几何检查、4 次展开、比较 2 个完整候选；原 Pose 和连接不变 |
| 六片 / 十二连接立方体 | 6 步全部实际前缀合法且连通；58 次几何检查、150 次展开、比较 6 个完整候选、裁剪 9 个状态；评分 34.36，七个图环警告 |
| 任意 Y 轴旋转、平移后的多环立方体 | 仍生成完整六步，所有前缀通过；图环总数仍为七 |
| 正方形 + 三角形连接结构 | 从真实混合示例取已连接组件，完整生成；仍使用真实不同形状 |
| 不同 Profile 版本、尺寸、厚度和部分端口 | 1 倍方片连接 2 倍尺寸 v2 的半边端口；完整生成、序列化往返保持所有快照与颜色 |
| 名称/颜色改变，零件/连接数组逆序 | 几何选择顺序不变；固定同一输入时整个结果确定 |
| 高位连接片与较低悬挂片组成的连接链 | 较低悬挂片必须在高位连接片之后安装；输出遵守真实连接依赖，未按高度直接排序 |
| 混合示例含自由片 | 最终 Geometry Valid，但两个组件，返回 `no-order`，不伪造完整教程 |
| 非法重叠、错误二面角、闭环残差、缺失端口 | 拒绝生成，不调用 Solver，不修正来源 |
| 合法悬空结构 | 默认可生成，但给出托持/支撑 Warning，稳定性始终未评估；强制接地根时返回无顺序 |
| 几何预算 3 | 正好使用 3 次，返回一片已检查前缀和未分配诊断 |
| 单步连接上限 1，束宽 32 | 31 次检查、120 次展开，未裁剪，当前约束下 `no-order` |
| 相同连接上限，束宽 1 | `search-limited`，明确有裁剪，不声称其他顺序不存在 |

自动验证命令与本次结果：

| 检查 | 命令 | 结果 |
|---|---|---|
| 3D Engine / Adapter / Viewer / Editor / Tutorial / Planner | `npm run test:magnetic-3d` | 12 文件、161 项通过，新增 17 项规划测试 |
| 现有磁力片回归 | `node --experimental-strip-types --test test/magnetic-*.test.mjs` | 121 项通过 |
| 严格类型检查 | `npm run typecheck:magnetic-3d` | 通过 |
| 项目类型检查与生产构建 | `npm run build` | 通过；仍有大 chunk 提示 |
| Viewer / Editor / Tutorial 浏览器回归 | `test:magnetic-3d:browser`、`test:magnetic-3d:editor:browser`、`test:magnetic-3d:tutorial:browser` | 全部通过 |
| 自动规划真实浏览器 | `npm run test:magnetic-3d:build-order:browser` | 实际 Worker、两片/立方体、六个前缀、明确采用/拒绝替换、手动编辑、保存刷新、文件导入导出、预算/裁剪/不连通失败、过期候选、非法来源及 2D 完成状态隔离通过 |

Browser 连接没有可用实例，沿用既有隔离 Chrome + 软件 WebGL 测试脚本。新上下文、临时 API 数据目录，禁止业务 POST，不操作正式数据。测试没有 pageerror、console error 或业务写请求。产物 `/tmp/magnetic-phase5a-browser/{result.json,generated-cube.png}`，独立算法案例报告 `/tmp/magnetic-phase5a-cases.json`。脚本使用本机 Chrome（可设 `CHROME_PATH`）和既有测试 Playwright，不给产品增加依赖或集成 V4。

## 局限与后续 Reconstruction 接口

本阶段是有边界的 V1：只规划一片一步、单组件、固定最终 Pose。没有子装配合并、临时位姿、预折叠、连续轨迹、真实接触力学或全局最优性证明。支撑投影是包围范围近似，不能替代物理稳定性。复杂闭环可能需要作者拆分/合并步骤、预装部件或扶持，不能将搜索成功理解为现实搭建证明。

后续真实照片 Reconstruction 应先输出版本化 Assembly3D 候选：坐标系/尺寸单位、完整 ProfileSnapshot、Piece ID、position/quaternion、端口连接和二面角。通过现有 Geometry Validator 后，调用同一个 `generateBuildOrder3D()`；照片识别置信度、多视角证据和多假设选择可由 Reconstruction 边界层单独保存，不让规划器修正或猜测权威 Pose。

重建产生新 ID/revision 或不同内容时，现有全内容来源比较会使旧候选不可采用。未来 LLM 或其他生成器也应输出同一种 Tutorial3D / BuildStepV2，继续经过相同验证与人工审核、复用同一 Player。本次未实现这些后续能力。
