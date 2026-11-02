# Canonical Geometry 调查与契约

本轮契约：`magnetic-canonical-profile-ports-v1`。
Planning Prompt：`magnetic-spatial-canonical-geometry-v1`。

## 调查结论

没有发现 Analysis、Review、Execution 或 Viewer 各自重新排列 3D 顶点。原有主链已共享 `three-d/profile-adapter.ts::adaptProfile`，但没有完整约束同 ID@Version 的 **厚度、scale、Port 分段**：Review 可以覆盖厚度，Assembly 可以直接改变同版本快照，Catalog 添加默认 .05，而 Review 默认 .06。这是真实的契约缺口。

另一个独立问题是 Auto Fix 曾读取其他历史 Plan 的 Port 配对。Back 当前 Plan `a3d5a25f` 中 p01:e3 → p03:e2、p11:e3 → p09:e0 均为 +90° / flip=true；历史 Plan `745e9061` 中相同编号的这两条声明均为 −90° / flip=false。历史 Plan 的 p03:e3 ↔ p09:e2 不能直接插入当前实例解释。两个 Plan 用的是同一 Registry 多边形，不是两份不同内部 Profile；它们给无标记对称实物选择了不同的观测边对应/实例朝向。此前 Mapping 解决的是跨假设配准，不是引擎偷偷重编号。

紫色片看起来朝左/朝上并不能证明 Port mismatch。Solver 的 `engine-adapter.ts::solveAssembly3D` 固定保存的根 Pose、关闭隐式 ground lock；`execute.ts` 明确标记 `component-local-unregistered`。照片的重力/相机没有完成标定。Viewer 的“正对所选面”“以所选面为上方”改变相机，不改 Profile、Pose 或 Port。不能用相机更正或统一局部坐标替代真实世界位姿估计。

## 唯一数学定义

- Registry 的 `Profile ID@Version` 固定原始 CCW 凸多边形及顶点顺序、connectableEdges。2D Catalog 使用原始坐标；其 SVG `scale(1 -1)` 只补偿屏幕 Y 向下。
- 3D **唯一**适配为面积质心原点，保留原顶点顺序，局部 XY 为中面，正面法向 +Z。世界点 = quaternion × local + position。翻面是 proper rotation；不反射、不重编号多边形。
- `e{i}` 为 v{i}→v{(i+1)%n}。可连接边上的 `e{i}-p{j}` 按沿原始有向边递增的 t 区间编号。p0→p1 不随实例姿态或相机改变。Port 的二维 `normal` 是 CCW 左侧板内方向；它不是 +Z 正面法向。
- 厚度实体沿局部 Z 对称挤出 ±thickness/2；Port 轴仍在中面边界。本轮不改变该实体模型或 Collision 判定。
- 标准厚度固定为 .06、scale=1、每个可连接边完整区间一个 Port；这是本契约的版本化标准定义，不是历史格式兜底。可选 Registry `solid3d` 在新 Profile 版本中固定厚度和分段。以后不能修改该标准而保持 ID@Version 不变。
- Flip=true 反向匹配端点；Dihedral 是绕 A 原始 Port 方向的有符号右手角。B→A 反向遍历时仅 flip=false 需要反号；保留原 Solver 定义和回归。

## 端到端消费与校验

| 阶段 | 几何来源与边界 |
|---|---|
| Parts Explorer / Catalog | Brick Parts Explorer 是独立的 Brick 数据，不是磁力片 Profile 来源。磁力片 `SupportedTiles.tsx` / `ProfileEditor.tsx` 使用 append-only Registry；可展开查看同一 `canonicalProfileGeometry` 的局部顶点和 Ports。改变厚度需要保存新 Profile 版本。 |
| Analysis | Catalog/manifest 是规格依据；模型输出图片归一化坐标的 feature/bbox 和 Profile 建议，没有可执行局部几何。Single/Multi Analysis Prompt 文本未修改。 |
| Review | 明确选择 ID@Version 后，服务端 `canonicalProfileSnapshot` 从 Registry 创建快照；不再有 Review 厚度覆盖控件。图像 feature ID 与 Port ID 是不同命名空间。 |
| Spatial Planning | 请求包含完整 manifest（原点、法向、局部顶点、有向边和分段 Ports），并在付费调用前验证存在契约输入；输出仍沿用原 Spatial Schema/Parser。模型只能推断观测边到已存在 Canonical Port 的对应，不得重排或创造编号。新 Plan 保存契约标识。 |
| Execution / adoption | `executionPlan` 在执行/重放/采用前校验契约标识和 Registry 快照；缺失标识明确拒绝并要求重新规划，不转换旧编号。普通 Candidate 和 Diagnostic 均保持原严格验证与来源校验。 |
| Assembly / Snap / Auto Fix / Viewer | 共同消费 adaptProfile；导入、重新加载、交接、保存、Revalidate 及服务端审核/Build 使用 Registry 校验。移除同版本快照厚度编辑。Auto Fix 只执行当前采用 Plan 的当前解释、人工作出的约束及其 Execution 遗留假设；不再查询历史修复证据。 |
| 正式授权 / Build | 服务端独立比较 Registry 几何，仍运行原 Validator 和 Human Accepted 授权；改错版本/改厚度不能靠前端放行。 |

数学引擎 adapter 保留可测试的显式 snapshot 参数（用于独立几何实验）；它不是 Registry。正式工作流入口必须 `assertCanonicalProfiles`，不会因为某个任意凸体在数学上有效就冒充已登记的 ID@Version。

## 删除与不可避免的推断

删除 `port-mapping.ts`、旧 Mapping 测试/历史配对 fixture、`repair-evidence` 历史扫描接口、加载及 Proof UI。没有双路径读取、历史编号转换或迁移。未删除或改写正式源图片、Review、Plan、Execution、Draft 或 Registry ledger。旧 Trace 可以读，但旧 Plan 不再可执行/采用，需要重新生成。

无标记的正方形具有旋转对称性。仅有 Exact Profile 不能判断照片左边是哪个 Canonical Port；翻面时还可能有正反面歧义。这种 **观测→Canonical Port 识别**不可避免；可保留不确定性，但必须在同一 Plan 内一致。将其他 Plan 的边指认直接拼入当前 Pose 不在本轮支持范围。现在只有一条执行链，不以转换层维持跨 Plan 拼接。

## Back 的验证边界

真实旧 Plan 本身没有 p03↔p09 声明；删除历史拼接后，不能声称只刷新旧 Draft 就会凭空出现该证据。测试在 /tmp 服务中创建明确标记的 **离线人工 Canonical Plan fixture**，沿用当前九条连接并直接提出 p03:e1 ↔ p09:e1、0°±5°、flip=true；没有转换历史编号，也不冒充新 LLM 输出。

现有 Find Fix 在同一预算内得到 10 条连接，两条 45° 协调到 30°，原九条 Port/Flip/关系不变；全图位置残差约 1.83e−16，二面角残差约 2.84e−14°。p01/p09、p03/p09 消除，p03/p11 仍为真实 Intersection（约 .015），Geometry Invalid。Non-repairable 排除评分但仍检查不得加重。预览/取消/应用/Undo/Redo/保存/刷新通过真实浏览器测试。

这证明原 Solver 能直接消费一致的 Canonical 配对，不证明新模型一定选对照片中的边；本轮真实 LLM 调用 0，Usage 0。真实新 Planning 的语义正确性仍需要用户明确执行后结合照片检查。

## 验证与操作

见 `checks/magnetic-3d/canonical-geometry.vitest.ts`、`connection-repair.vitest.ts`、`test/magnetic-canonical-geometry.test.mjs` 及三个隔离浏览器脚本。覆盖 Registry 持久化、正方形/三角形/直角三角形/对称形、分段 Ports、旋转/反向正面、版本不一致拒绝、完整闭环与实体错误、Human Accepted → Build。

用户新流程：确认 Catalog 规格 → 保存 Review（厚度随 Profile 版本）→ 明确执行新的 Spatial Planning → Geometry Execution → 对照照片检查 → 采用进入 Assembly → Find Fix。检查连接证据应来自当前 Plan；没有当前配对时如实保持无建议，不能再依赖其他历史 Plan。相机调整仅用于观察；不要据此认定真实世界姿态已标定。

本轮最终验证：3D Vitest 297 项通过；磁力片 Node 260 项通过；TypeScript 专项检查与生产构建通过。三个隔离 Chrome/Playwright 端到端脚本通过（Back Canonical 第十条连接、真实点击/拖动 Snap、Front 人工采用/保存恢复/9 步 Build）。结果与截图位于 `/tmp/magnetic-canonical-geometry/browser`、`/tmp/magnetic-3d-snap` 和 `/tmp/magnetic-human-diagnostic/browser`。正式存储写入 0，LLM 调用 0、Token Usage 0。
