# Visible 3D Geometry Execution V3

本轮只改进确定性执行、诊断保留、局部搜索和结果展示。未修改 Vision / Spatial Planning Prompt、模型请求、Solver 算法、碰撞判定条件或 Assembly3D 的有效性标准。没有模型调用，也没有重写正式 Review、Plan 或 Execution。

## 理想几何与实体碰撞

`engine-adapter.ts::assemblyValidationLayers` 将同一份严格 Validator 报告投影为两层：

- `idealGeometry`：除 `intersection` 外的全部检查，包括保存 Pose、端口/连接、二面角、闭环残差等。
- `solidCollision`：严格 Validator 的 `intersection` 结果。

`candidate.geometry` 继续是完整且权威的严格报告；两层展示不改变 `geometry.valid` 的定义。所有碰撞阈值、已存在的连接缝例外、SAT 轴和 Solver 都保持原行为。

新的不可变 Execution 记录为 `version: 3`，原字段保留，增加可选数据：

- `candidates`：仅严格 Geometry Valid 的正常候选。
- `diagnosticCandidates`：同一种 `VisibleCandidate3D` / `Assembly3D` 数据结构，`kind: diagnostic`，保存求解得到但严格 Validator 不通过的 Pose、ProfileSnapshot 和连接。它不是第二套装配格式。
- 每个 V3 Candidate 的 `validation` 保存两层报告；`construction` 保存解释编号、连接组合编号、原组件实例、父连接及未实现的原假设。Diagnostic 还保存 `collisions`。
- `search.localSearch` 保存局部搜索计数、上限、去重数量、父组件截断及完成状态。

新增运行固定使用 V3。普通 Adopt 只查找 `candidates`，拒绝 Diagnostic ID，按记录版本重新执行、比对 Candidate Hash，再运行严格 Validator 与人工相对空间检查。即便修改按钮或把 Diagnostic 移入正常数组，也不能绕过复核。既有 V1/V2 存档仍通过原 V2 枚举/排序路径复核，不迁移、重写或重新编号。

## 碰撞证据

Vendored Validator 仅增加结构化 `relatedPieceIds`、原始 `penetrationDepth` 和一个只读检查函数。新函数复用同一凸棱柱 / SAT，利用凸体顶点和边面交点估计交叠区域，输出：

- 碰撞零件对、SAT 深度、空间包围盒和交叠区域顶点。
- 两个中面多边形的公共顶点、公共边及是否存在声明连接。
- `near-shared-vertex`、`near-shared-edge`、`non-contact-penetration` 或 `unresolved`。

局部性检查使用 `2 × 较厚零件厚度` 的诊断距离，要求全部交叠区域顶点都接近公共几何；平行面内部重叠优先标为非接合穿透。这个距离不参与碰撞判定，任何分类均不能自动放行。SAT 深度是最小分离轴重叠，不等于实际材料的压入量。每个 Diagnostic 最多保留 24 对碰撞的空间详情，完整 Validator issues 不截断。

详情位于 Inspector「碰撞空间证据与原连接约束」和现有 Trace / Raw 的 Geometry Execution Tab；不新增日志系统。

## 局部搜索与预算

复用原解释、端口、角度、flip、uncertain 可选连接枚举以及原 Solver。对严格验证失败但已经求出 Pose 的组件，按覆盖数、连接数、解释/组合顺序保留父组件，然后：

1. 跨父组件优先枚举较大的实例子集。
2. 仅检查连通的诱导子图：保留其内部所有已选连接，不偷偷删除冲突闭环边。
3. 直接复制父结果的真实 Pose 和原 ProfileSnapshot；不重新求解、平移分组或创造隐藏零件。
4. 对局部 Assembly 调用原严格 Validator；只将通过者放入正常排名。
5. 保存未覆盖实例与未实现的原连接假设，始终标明局部结构不满足完整重建。

默认/硬上限：

| 预算 | 默认 | 硬上限 |
|---|---:|---:|
| 原连接组合 | 128 | 2048 |
| 原组件和局部子图合计的几何检查 | 256 | 4096 |
| 局部子集尝试（连通性/去重前也计数） | 1024 | 8192 |
| 失败父组件 | 32 | 64 |
| 合法候选返回数量 | 5 | 20 |
| Diagnostic 返回数量 | 8 | 20 |

局部子集预算可以设为 0 以关闭扩展搜索。任一启用预算耗尽或父组件被截断，`completeSearch=false`、`status=budget_exhausted`，遵循既有保守语义，不返回可普通采用的候选；已得到的 Diagnostic 仍可检查。

去重键包含实例、Profile 版本、Pose 和连接。仅去重时以 1e-8 精度量化并统一 quaternion 的等价正负号，实际保存的 Pose 不舍入。排序先确保严格几何合法，再比较覆盖数量、已审核空间关系矛盾、未验证项数量和稳定键。不同原解释可能保留几何相似但 Pose / 来源不同的结果。

`completeSearch=true` 只表示所提供离散假设及启用范围的枚举完成，不代表穷尽连续角度、所有可能的 Port、实际物理可搭建性或照片一致性。

## 橙色案例复现

使用既有 Review `66ec23c3-b08c-41f9-aa90-a4f2ab9450f6` 与 Plan `edb975b9-c57c-4dd6-8ee1-03a379303c1a`。Plan 仍关联原模型 Trace `b80f45f6-2b22-4f5c-a34a-bf708761f938`。旧 Execution `37e8ebfc-3691-4300-9ba8-cae7b38bdc65` 原样保留。

默认预算结果：16 次连接组合，111 次几何检查（其中局部 91 次），864 次局部子集尝试，335 次去重，16 个失败父组件，预算未耗尽。

| 结果 | 覆盖 | Ideal Geometry | Solid Collision | 普通采用 |
|---|---:|---|---|---|
| diagnostic-1 / 2：完整七连接、两种折角解释 | 6/6 | Valid | Invalid | 禁止 |
| diagnostic-3 至 8：其他完整六连接组合 | 6/6 | Valid | Invalid | 禁止 |
| candidate-1 / 2：顶部及左右侧 | 3/6 | Valid | Valid | 需明确接受局部结果并确认 Draft 替换 |
| candidate-3 / 4：正面三角形组 | 3/6 | Valid | Valid | 同上 |
| candidate-5：另一个连接对 | 2/6 | Valid | Valid | 同上 |

完整七连接的最大位置残差 < 1e-12，角度残差 < 1e-10 度；四对严格碰撞为 tile1/tile2、tile1/tile4、tile3/tile5、tile3/tile6，深度约 0.015，诊断为公共顶点附近的局部交叠。其余组合还会产生公共边附近约 0.026、0.030 的交叠。所有碰撞仍判失败。

合法正常候选最大仅覆盖 3/6，所以 Execution 默认显示「重建不完整，未覆盖 3 个已确认实例」的红色 Blocker。默认优先预览完整且理想几何成立的 Diagnostic，便于判断空间解释；其他候选仍通过同一下拉框选择。中栏与 Inspector 独立显示 Ideal Geometry、Solid Collision、Coverage、Photo Match（Unverified）。

Diagnostic 与正常候选共用既有 Observation 映射、相机元数据、Viewer、Inspector、History 和刷新恢复。Camera 的稳定键仍为 Execution ID / Hash / Candidate ID；Diagnostic 不会进入 Assembly 相机交接。合法局部候选的原有审核、来源校验、覆盖确认和 Camera 交接保留。

## 测试与验收

- `npm run test:magnetic-3d`：191 项通过，含上游几何测试、闭合立方体、混合 Profile、反向遍历、二面角、Editor、Tutorial、Build Order 以及新 V3 回归。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs`：165 项通过，包含 35 项 Visible 3D 测试。增加了局部完整性提示、Diagnostic 直接采用/伪造拒绝、旧 V2 采用兼容测试。
- `npm run typecheck:magnetic-3d` 与 `npm run build`：通过。
- 新增 `npm run test:magnetic-visible3d:execution-v3:browser`：复制正式案例到临时目录，执行确定性重建；验证全部 13 个候选、WebGL、碰撞详情、红色完整性 Blocker、Diagnostic 禁止采用、历史/刷新/相机隔离、Trace、合法局部采用与 Camera 交接。宽度 1660 / 1100 / 680，无页面溢出。
- 已有 `test:magnetic-visible3d:layout:browser`：紫色四候选、图片与实际 WebGL 双向选择、相机、History、取消覆盖与采用、Trace、窄屏通过。
- 已有 `test:magnetic-visible3d:2d:browser`、`test:magnetic-3d:editor:browser`、`test:magnetic-3d:build-order:browser` 通过；教程检查包含两片、六面十二连接立方体和已保存紫色三片结构。
- 上游 `engine.patch` 已在临时目录应用并逐字节比对，能精确还原五个 vendored 文件。

浏览器产物：`/tmp/magnetic-visible3d-execution-v3/result.json` 与该目录截图。浏览器只写临时 API 数据与隔离浏览器存储，已比对正式 Review / Plan / Execution 文件未改变。真实模型调用数为 0；这些测试证明确定性几何和工作流行为，不证明照片识别准确率提高。

手动验收：左栏选 3D 和橙色图片，恢复上述 Review / Plan，进入 Reconstruction，只点击 Geometry Execution。旧执行不会被覆盖。保留默认 128 / 256 / 1024 预算，打开新执行；默认完整 Diagnostic 可旋转、选择和保存视角，不能 Adopt。查看独立状态、碰撞空间证据和 Trace；切到 candidate-1 或 candidate-3 对照局部结构。刷新和切换 Execution History 检查相机与候选隔离。只有明确接受合法局部结果、确认覆盖 Draft 后才能进入 Assembly。

## 保留的限制

完整橙色实体结构依然无效；本轮只使其理想空间假设可见，不自动放行接点碰撞。搜索不优化 Pose、不重新拟合照片、不扩展未知 Port/角度，也不搜索被父组件预算截断的图。没有相机标定、照片匹配评分、实体接点建模、材料变形、磁力或物理稳定性结论。
