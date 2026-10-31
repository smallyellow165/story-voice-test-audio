# Visible 3D V2.1 — 流程验证、相对空间检查与图片联动

已完成。本轮新增模型调用 **0 次**，Vision/Planning Prompt 均未修改，Solver/Validator 核心算法未修改。使用已保存的紫色照片 V2 记录完成确定性审计和隔离浏览器验收。

## 真实问题与确定性比较

数据：`qisimiaoxiang_square.png`，Source `2c4901a08eadde9a0ec2549bfc4a506c0e0e8da00478e437823909681bc0ddfc`。V2 两阶段记录保留在 `/tmp/magnetic-visible-v2-live-KDeucd/`。正式 Intake 中只有同照片的旧 Analysis，因此本轮直接复用这些已保存 V2 记录，没有向正式目录补写评估结果。

结果不是“两个候选都算错了”，也不是“两个都只是相机不同”：

| 检查层 | 实际发现 |
|---|---|
| Vision → Review | Review 的完整 Evidence 与 Vision 保存输出 Hash 一致，面方向、结构假设、边证据没有丢失 |
| Review → Planning | 模型实际请求里的 geometryInput 与已保存 Review 输入一致；原图、ProfileSnapshot 和人工审核状态均已传入 |
| Planning → Engine | 三条 Port / Dihedral / Flip 按原值进入 Connection；实际角度属于所选完整解释，没有把视觉折角误当另一种数值重新转换 |
| Solver → Candidate | 两个保存 Pose 均通过原 Validator，三条完整连接及闭环成立；三对无向面夹角都为 90° |
| 空间解释执行 | 旧流程只把 Connection 当硬约束；文字形式的 horizontal/vertical、整体结构和相机解释并没有成为独立候选检查。旧 Review 也没有逐项确认的相对空间约束 |
| Viewer | 所有局部根片从常规 XY / +Z 开始，默认相机沿世界 +X/+Y/+Z 看；这与照片推断的“顶面朝上”没有绑定。相机可以看到三面角内侧，视觉上显著不同 |

比较参考来自既有 `closed-cube.json` 的 top/front/right **三片子集**，保持原始 Pose 和连接。没有要求重建另外三块隐藏面。明确的人工对应是 `tile1→top`、`tile2→front`、`tile3→right`：分别对应照片中的顶片、左片和右片。

比较方法在 `pose-inspection.ts`：从真实 ProfileSnapshot / Pose 构造每片中面顶点和厚度端点；枚举锚定多边形的循环/反向角点对应，构造整体刚体变换，并检查所有对应零件顶点。接受结果必须 det=+1，不允许反射，也不逐片旋转或交换 Observation ID。det=-1 只作为“镜像才能对齐”的诊断，绝不应用到 Candidate。

| 候选 | 整体正常旋转后的中面比较 | 镜像诊断 | 原始厚度比较 |
|---|---|---|---|
| candidate-1，主解释 | 最大顶点残差约 `3.33e-16`，det=+1；三面角结构与人工参考一致，连接拓扑也一致 | 不需要镜像 | 候选厚度 0.06，参考 0.05；实体顶点残差约 0.005，单独列为厚度参数差 |
| candidate-2，相关反向折叠解释 | 在固定零件对应下不能用正常整体旋转对齐；枚举锚定刚体变换的最佳中面最大残差为 1 个 Profile 单位 | det=-1 才可将中面残差降至浮点误差级；这是标签固定下的反手三面角，不是同一个视角问题 | 正常变换实体残差约 0.97546；不能用调整厚度或镜像掩盖结构差异 |

参考和候选的厚度差没有被偷偷修改。中面结构比较与完整厚度比较分别报告；初期同厚度结构检查得到的浮点残差不能当成原始实体厚度完全相等。

该结论依赖上述明确的左右片对应。若交换 front/right 对应，会改变手性比较的语义；不能因为颜色相同就偷偷换 ID。三片无标记、双面、同色面板的相机/左右解释本身仍可能歧义。本轮没有从单张照片自动证明手性，也没有把 candidate-2 自动认定为照片错误或对它做镜像修复。

完整审计：`/tmp/magnetic-visible-v21-audit/report.json`，包含来源链检查、实际连接、逐片 Pose、世界法向、面夹角、正常/反射变换矩阵、厚度与拓扑比较。

```bash
node --experimental-strip-types scripts/audit-magnetic-visible3d-v21.mjs \
  --evaluation /tmp/magnetic-visible-v2-live-KDeucd \
  --reference src/magnetic-tiles/three-d/examples/closed-cube.json \
  --mapping '{"tile1":"top","tile2":"front","tile3":"right"}'
```

这是有对应关系的已知多边形刚体诊断，不是图像配准、PnP、点云优化或照片评分。残差为枚举锚定变换的结果，不宣称是任意近似形变的全局最优误差。

## 图片、列表与 3D 的双向联动

复用原 `Visible3DWorkflow` 已有的 SVG 图片/边角覆盖层，提取为 `VisibleEvidenceImage.tsx`，继续使用 2D Review 的 Observation-ID 选择方式和 `.observation / .selected` 高亮样式，没有另建标注编辑器。

- 原有 `ReviewWorkspace` 表、筛选、选择、图片区域及 Profile/连接表单保持复用；没有改动 2D Reconstruction。
- `MagnetScene3D` 的原 mesh 点击 / R3F raycast 和 `onSelect` 直接驱动同一个 Observation 选择状态，不再用图片 selected 与 Viewer pickedPiece 两套独立状态。
- 新执行结果显式保存 `observationMap`。目前 Engine Piece ID 来自固定的 Observation ID；映射在构造时建立，不依赖颜色或数组次序。旧结果按这一已存在的构造契约恢复映射，历史文件不改写。
- 重建中栏将原图与真实 Pose Viewer 并列，窄屏上下排列；点击任一侧会高亮另一侧，Inspector 显示 ID、Profile@Version、Pose、世界法向和照片证据。
- 下方 Observation→Piece 列表可用于重叠/遮挡区域，显示 reconstructed、unresolved、unknown-profile、unconfirmed、excluded。选择未重建项不会错误高亮别的零件。
- 切换 Candidate 保留当前 Observation；新候选不含该片时，保留图片/列表选择，并明确显示“未重建”。
- 提供“回到 Review 修正选中零件”，回到表格时仍选中同一 Observation。

Viewer 新增可选 inspectionTools，默认关闭，只有候选对照开启：

- **正对所选面**：依据保存 Pose 的面法向，明确改变相机观察方向。
- **以所选面为上方观察**：把该片作为相机参考上方，从几何中心到各面的方向构造观察辅助。不是照片相机估计，也不绑定重力。
- 两项均复用上游 `computeFitCamera` / `applyFitResult` / OrbitControls；不会求解、挪片、改变连接或镜像。Reset 恢复默认 +Y-up 三分之四视角。

这让主候选可以直接查看到与照片类似的外侧三面，而不必为了默认截图改变 Assembly Pose。观察反手候选时应点击左右片检查 ID 对应，不能只看同色外观。

## 新增可执行的空间检查

使用现有 Review 的可选 `spatialChecks` 保存用户逐项确认的相对关系，附可见实例 ID、证据引用和说明；不要求模型新输出，不改变 Assembly3D / Tutorial3D。

| 关系 | 检查方式 | 结果边界 |
|---|---|---|
| 无向面夹角 | 从实际 Quaternion 得到两个单位法向，`acos(abs(dot(nA,nB)))`，0° 平行、90° 垂直，检查人工范围 | 不依赖世界轴或本地法向正负；不把屏幕斜率当二面角。视觉 ±90° 均映射到相同的无向夹角 |
| 必须建立共享边连接 | 检查对应的 Connection Graph 边；实际几何由原 Geometry Validator 认证 | 照片具体 Feature→Port 对应仍需核对。需要绑定端口/角度时沿用已有 Review constraints |
| 遮挡/前后 | 保留为 Unverified | 无相机标定/可见性检查，不能直接从世界 Z 判断遮挡 |
| 图片上下 | 保留为 Unverified | 屏幕上下不等于世界高度，不执行假的高度约束 |

整体解释的 accepted 状态不会自动把所有模型文字认证为硬约束；horizontal/vertical 不直接映射世界坐标。用户应逐项确认可靠的相对关系。

候选独立显示四项：

1. **Geometry Valid**：原引擎的连接、碰撞、闭环检查。
2. **Spatial Interpretation Consistency**：仅已审核相对关系的 consistent / contradicted / unverified，并逐项显示角度或缺少连接的 Diagnostic。
3. **Evidence Coverage**：哪些可见实例已重建、缺失或排除。
4. **Photo Match**：仍为 unverified，不伪造评分。

几何合法但空间检查冲突的候选保留以便诊断，排序排在非冲突候选之后，UI 禁止采用；服务端采用时重新检查，不能用直接 POST 绕过。Unverified 不被冒称通过。冲突应通过修正 Review 或连接计划后重算解决，而不是保存时静默修正 Pose。

本例两个候选的面夹角都为 90°，所以确认相对垂直本身不能区分反手候选。没有可信相机/有向对应或人工参考时，这项区别必须继续人工核对，不能用一个“空间一致”标签取代照片匹配。

## 零模型的修正与重新执行

旧流程修正 Review 后清空当前 Plan，用户往往只能重新付费 Planning 或输入 JSON。本轮增加了显式延续操作：

1. 从 Inspector 回到 Review，保留选中片。
2. 使用原表单修正 Profile、端口、角度/flip；或在同一对实例下新增/修改“已审核空间检查”。可先点击 Vision 的连接建议填入对象，但只有点击加入约束/检查才更改 Review。
3. 保存新 Review，旧候选立即过期，原 Analysis / Plan / Trace / Draft 不变。
4. Reconstruction 展开“沿用已有空间假设（不调用模型）”，明确选择来源计划，点击“按当前 Review 创建人工计划”。
5. 新 `rebase-plan` 记录保存 basedOnPlanId/Hash、旧 Review ID/Hash 和适配 Diagnostic；只允许同一 Analysis、同一 Source 的当前 Review。
6. 新确认实例采用当前正式 ProfileSnapshot；排除/取消确认实例时，当前审核草稿清理引用它的人工连接和空间检查；原保存快照不变。沿用计划时再移除其旧模型连接。Profile/版本或端口语义变化时旧端口置 Unknown 并提示，不凭名称或旧序号猜测对应。继承的模型文字继续标为旧解释，不能宣称重新视觉规划。
7. 用户明确点击 Geometry Execution。当前 Review 的人工连接约束仍优先，新的相对检查参与候选评估。
8. 原候选留在 History，新候选不会自动覆盖 Draft；逐项对照后明确采用，进入原 Editor / Auto Build Order。

新 Execution 版本为 2，增加上述映射与检查。已有版本 1 的候选读取不改文件；采用时保留原几何内容 Hash 比较语义，同时独立计算新检查。没有把新的诊断字段硬塞回历史记录而导致历史候选无法采用。

## 测试与验收证据

本轮所有新 API/浏览器测试写临时目录；实际模型调用为 0，正式资料只读。新单元/API 测试 `test/magnetic-visible3d-v21.test.mjs` 覆盖：

- 正常整体旋转、标签固定的反射识别、中面与真实厚度差分离。
- 几何合法的 60° 连接与已确认近垂直关系冲突；修正审核范围后通过。
- 合法开放结构缺少“必须共享边”的连接，得到空间冲突。
- 遮挡、图片上下仍 Unverified；不把 accepted 文字当硬约束。
- 同色不同 ID、部分/Unknown/排除映射、±90° 的无向语义。
- 无模型计划延续、Profile 变化后的 Unknown 端口、原记录不变、来源及过期保护。
- 相机辅助只返回有限观察参数，不改变保存的 Pose。
- 服务端拦截冲突采用，以及历史 Version 1 候选兼容。

浏览器命令：

```bash
node --experimental-strip-types scripts/verify-magnetic-visible3d.mjs \
  --v21 --live-evaluation /tmp/magnetic-visible-v2-live-KDeucd
```

实际 Chrome / WebGL 验收已验证：

- 原图点击→Viewer 高亮；真实 mesh raycast→图片高亮与 Inspector；候选切换保留同一 Observation。
- 正对/面朝上/Fit/Reset 只改相机，保存候选字节不变。
- 两个实际模型候选与原图并列，并记录同一侧片在两组解释中的对应截图。
- 经 UI 刻意确认错误的平行关系：Geometry Valid 保留、Spatial contradicted、采用按钮禁用。
- 回 Review 改成近垂直、明确沿用来源计划、重算、采用、导出/刷新 Pose 与 ProfileSnapshot 一致，原模型计划 Hash 不变。
- 排除第三片后重算局部候选，选中排除项显示未重建，不错误高亮其它 Piece。
- 没有调用 Analyze 或 Planning，且沿用原 Editor / Build Order 入口。

结果与截图：`/tmp/magnetic-visible-v21-browser/result.json`、`linked-and-camera.png`、`candidate-1-correspondence.png`、`candidate-2-correspondence.png`、`spatial-contradiction.png`、`review-corrected.png`。

实际回归结果：

| 检查 | 结果 |
|---|---|
| `npm run test:magnetic-visible3d:v21` | 12/12，通过 |
| `node --experimental-strip-types --test test/magnetic-visible3d*.test.mjs` | 26/26，通过 |
| 全部 Magnetic + DUPLO Spatial / Selected 相关 Node 测试 | 190/190，通过 |
| `npm run test:magnetic-3d` | 173/173，通过 |
| `npm run typecheck:magnetic-3d`、`npm run build` | 通过；仍有已有 Three.js chunk 体积提示 |
| V2.1 真实照片记录回放 / Viewer / Editor / Tutorial / Build Order / 隔离 2D Review 浏览器脚本 | 全部通过，实际 Chrome / WebGL；页面运行错误为空 |

日志保留在 `/tmp/magnetic-v21-*.log`。没有修改 Vision/Planning Prompt、2D Reconstruction、LEGO 或 DUPLO 工作流。

## 剩余限制

- 一张照片不能验证精确相机、绝对尺度、Gravity、真实磁吸接触和隐藏结构。全局刚体比较使用人工指定参考对应，不是自动照片匹配。
- 未标记/双面/同色面板的有向法向和手性需要更多可辨认证据；无向夹角检查不能区分所有镜像解释。
- `pieceViewPreset` 是用户明确触发的查看辅助，不会纠正模型；不同结构的外侧方向可能仍需 Orbit 调整。
- 继续沿用原引擎的厚度、端口与碰撞假设。不会为了让照片看起来正确而修改这些算法或漏掉闭合连接。
- 未开发相机标定、重投影、镜像补全、隐藏片、Gallery 或 V4。本轮到 V2.1 停止。
