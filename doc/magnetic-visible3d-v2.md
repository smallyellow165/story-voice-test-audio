# Visible 3D Vision Spatial Understanding V2

后续 V2.1 的确定性几何比较、图片联动与已审核空间检查见 [magnetic-visible3d-v21.md](./magnetic-visible3d-v21.md)。本页保留 V2 阶段记录。

已完成：增强原有两个模型阶段的 Prompt、V2 证据/解释契约和 Review UI，继续使用原来的请求、Trace、来源 Hash、Review head、几何执行及 Assembly3D。未增加模型阶段、相机求解、重投影、隐藏零件生成或第二套几何引擎。

## 先确认的 V1 断点

本地保存的紫色照片 `qisimiaoxiang_square.png`：Source `2c4901a08eadde9a0ec2549bfc4a506c0e0e8da00478e437823909681bc0ddfc`，旧 Analysis `8b712bcb-3606-4f84-8ec5-4a0e85f1cedf`。

旧 `gpt-6.1-sol` 输出实际已识别 3 个可见实例，且每片都有 `square@1` 候选，并非模型完全没有判断出正方形。Unknown 的主要 UI 原因是：Review 初始化把正式 Profile 全部设为 null，建议仅放在折叠 JSON 内。这一初始化保护仍保留，但 V2 将候选直接做成可用的确认按钮。不会把候选自动认证为准确实物规格。

## 修改范围与数据流

| 模块 | 修改 |
|---|---|
| `server/magnetic-visible3d-vision.mjs` | Prompt version 更新为 `magnetic-visible3d-v2-spatial-understanding`；Vision/Planning 两个 V2 输出 Schema；引导全图空间理解、透视下的基础形状、面方向、可见共享边和相关联的完整替代连接图；新模型响应必须使用 V2 |
| `three-d/reconstruction/spatial-understanding.ts` | 小型证据解释类型及严格验证，固定可见 ID/Feature 引用，区分形状与准确规格；隐藏说明只能是文本 |
| `three-d/reconstruction/contracts.ts` | V1 原样兼容读取/人工导入，V2 必须包含结构化解释与逐片 ShapeAssessment；Review 增加可选人工形状判断和整体解释审核，不修改 Assembly3D |
| `three-d/reconstruction/SpatialUnderstandingPanel.tsx` | 显示相机定性方向、整体假设、各面方向、折角候选/范围、其他解释、Unknown；隐藏说明单独折叠并标注“不进入执行” |
| `three-d/reconstruction/Visible3DWorkflow.tsx` | 可直接选用 Profile/Family 候选；人工纠正整体解释；把视觉连接建议填入已有边/角度表单，核对后才建立约束；从 Planning 选择完整连接解释并保存独立人工计划 |
| `intake/ReviewWorkspace.tsx` | 新增可选 AI Shape Family 行标签，2D 默认行为不变 |
| `server/magnetic-visible3d.mjs` | 人工选择计划可记录 basedOnPlanId/Hash，并检查其属于当前 Review；保留原模型计划/Trace |

调用链保持：Source 照片 → `visible3d/analyze` → 共享 `runStructuredSpatialModel` / `callBrickModel` / `captureVisionWire` → V2 Evidence → 原 Review 快照 → `visible3d/plan`（原图、Evidence、人工审核、真实 Snapshot、端口）→ 原 `executeVisible3D` → 原 Solver / Validator → Candidates → 明确采用 → 原 Editor。

本轮没有修改 `engine-adapter.ts`、Solver、Validator、Profile Adapter 的几何实现，也没有修改 2D Vision Prompt、DUPLO 几何、Assembly3D、Tutorial3D 或 Build Order 核心契约。无依赖升级，无生产记录改写。

## 模型如何表达理解

Vision 的每个可见 Observation 保留原有颜色、可见区域 bbox、独立角点/边段、遮挡、证据及准确 Catalog 候选，并新增：

- `shapeAssessment.family`：square / rectangle / triangle / polygon / curved / unknown。
- `alternativeFamilies`、形状证据、`perspectiveUncertainty` 和 `exactProfileUncertainty`。
- 可以判断 square，但不能确定准确尺寸；此时仍保留 square family，准确 Profile 候选可为空。已有 Catalog 候选必须是实际 ID@Version，其理由需要说明条件，不能编造规格。

Evidence 与 Planning 的 `spatialInterpretation` 使用同一种小型解释结构：

- `camera`：above / level / below / oblique / unknown，只有定性证据和不确定性，无内参/精确相机位姿。
- `faces`：已存在可见 Piece ID、大致 horizontal / vertical / inclined / unknown，附证据引用和说明。
- `connections`：可见边特征对应、shared_edge / occlusion / separate / uncertain、视觉折角候选和区间。视觉折角尚未绑定引擎端口方向，不能直接等同于最终 Connection。
- `overallShapeHypotheses`：整体可能是什么，只引用可见 IDs。允许判断“盒状角部”，不能因此增加盒子的其他面。
- `hiddenStructureHypotheses`：description / reasoning / uncertainty 三个文本字段，没有 ID、Profile、Port、Pose 或可执行数量。
- `alternatives` / `unknowns`：保留不同深度、接触、相机、整体解释，不强迫唯一答案。

人工 Review 可另外保存逐片 `shapeFamily/shapeNote` 与 `interpretationReview={status,note}`。这些不替代准确 ProfileSnapshot。人工连接仍沿用现有 `constraints`，不会因为点击查看建议就自动加入。

Planning Prompt 明确引擎的实际语义：局部 XY、CCW 原始顶点、+Z 法向；flip 对应端点交换；有符号二面角基于 A 原始有向端口与两片法向的 atan2，而非直接取照片线条斜率或材料内部夹角。对于对称片，允许选择并明确说明一个一致的局部边编号约定，不因为没有印刷端口标签而全部填 Unknown。相关联的角度符号选择优先输出完整替代图，不能任意组合破坏闭环，也不能删除可见闭合边来制造成功。

最终精确 Pose 仍只来自现有 Solver。Geometry Valid、Evidence Coverage、Photo Match、Human Review 继续独立，照片匹配不会因为描述详细或几何合法而自动通过。

## 真实照片测试：实际结果与边界

本轮实际使用 **1 张真实照片、3 次模型调用**，模型均为已注册的 **gpt-6.1-sol**。所有新 Trace、Review、Plan、Execution 都写在 `/tmp` 隔离目录；原 Source、旧 Analysis、Selected 和作品未被更改。不是批量测试。

| 调用 | 实际结果 | Input tokens | Output tokens | Total |
|---|---|---:|---:|---:|
| 第一次 V2 Vision | 输出 3 个 square family、合理顶面/两侧面及近 90° 解释；一条 feature 使用三点转折线，违反单边双端点契约，正式记录被拒绝 | 2,757 | 3,165 | 5,922 |
| 明确修正 Prompt/Schema 后的 Vision | 3 个可见实例、3 个 square family，每片 square@1 条件候选；顶面水平/两侧竖直、3 条 near-right-angle 接缝、从上方斜看、局部盒状角部与 Unknown；无隐藏片 | 2,826 | 3,232 | 6,058 |
| V2 Spatial Planning | 固定 3 个已审核实例，给出 3 条具体 Port / Dihedral / Flip 连接，主解释 + 一组相关联的反向折叠完整图；保留视觉角度区间与局部编号不确定性 | 6,072 | 4,265 | 10,337 |
| **本轮合计** | **3 次，不自动重试；失败请求也计入** | **11,655** | **10,662** | **22,317** |

费用没有可靠账单金额，报告 Usage，不猜测美元费用。旧 V1 的 2,884 tokens 是此前已保存的调用，不计入本轮。

第一次失败没有静默修改模型返回或伪造成功。之后在最终 Schema 中给 `features.points` 明确添加 1–2 点和每点 2 个坐标的限制，Prompt 要求转折边分成独立特征；只做了一次明确的新 Vision 调用。

测试 Review 人工按照片选用了 `square@1`，厚度采用测试值 0.06；这是测试审核假设，**不是模型已测得实物绝对尺寸/厚度**。保留 Unknown 的用例另有自动化测试。

几何执行实际进行了 2 个连接组合、2 次几何检查，得到 **2 个合法候选，每个恰好 3 片、3 条共享边连接**，包含三面构成的闭环。主解释三条边使用 +90°、flip=true，替代图三条边使用 -90°、flip=true；具体 Port 由模型按一致局部约定选择。没有为完成六面体新增另外三片。

相较旧记录，可证实的改善是：

- 计数仍为 3，Profile 候选原本也已有 square@1；不能宣称这两项准确率由错误变正确。
- Shape Family、透视不确定性、相机/面方向、整体局部结构和角度建议现在独立可见、可审核。
- 本次两阶段真实输出实际形成了含闭合边的 3D Connection Graph，并产生了两组合法几何，而非只增加解释文字。
- **没有做旧 V1 Planning 的在线 A/B 对照**，没有标定相机或精确重投影，也没有测量照片匹配分数。三片正交角部在拓扑和近直角关系上与照片相容，不能仅据此宣布照片重建准确率已提高。

默认 Viewer 使用常规局部坐标和相机，可能先显示角部内侧或朝向与照片不同；用户需用 Orbit Controls 对照。定性“上方/水平”不会在本轮偷偷改动已生成/保存的 Pose。对于未标记、双面、同色磁力片，相关反向解释可能仍难从单张照片区分。

## 人工 Review 和 UI 操作

1. Source → Visible 3D，选择模型执行 Analyze。已有 V1 Analysis 也可以直接重新打开，新的 Profile 候选按钮同样可用，无须为了查看已有候选再付费识别。
2. 在 Review 表选择一片。右栏直接展示 AI 基础形状、透视/规格不确定性和准确 Profile 候选理由/几何尺寸。
3. 点击“采用 AI 形状判断”或选择“人工形状判断”。点击“使用 Profile 候选 ID@Version”只设置候选，仍须明确勾选“确认可见实例”。不确定规格时保持 Exact Profile Unknown；误识别项排除并保留证据。
4. 查看 Vision 整体空间理解：相机、整体结构、各面方向、视觉折角建议、替代解释。隐藏结构说明单独显示“不进入执行”。通过整体解释审核下拉框接受为待验证假设、纠正或拒绝，填写简短说明。
5. 点击某条“核对此连接与角度建议”，会填入原有连接表单、角度/范围和证据，**端口仍等待核对**。只有点击“加入 / 替换人工连接约束”才改变 Review；随后可修改或移除。
6. 保存 Review，再执行原有 Spatial Planning。Reconstruction Inspector 的 Planning 详情默认折叠；可展开查看全部具体连接与完整替代图，或选择某组解释保存独立人工计划，原模型计划和 Trace 保留。
7. Geometry Execution、候选切换、原图对照、Fit/Reset/Orbit、选择零件和明确采用仍是原流程。Geometry Valid 不等于 Photo Match 通过。修改任何 Review 内容都会使旧候选过期或要求重新求解。
8. 采用后原 Editor 保存、刷新、来源 sidecar、Auto Build Order、Tutorial 沿用已有契约。不会重新求解恢复存档，也不会覆盖 2D 数据。

## 自动化与浏览器验收

- `npm run test:magnetic-visible3d:v2`：7 个新增测试通过，含形状已知但 Profile Unknown、严格可见 ID/Feature、隐藏字段隔离、三片闭合边、多解释、错误闭环、人工纠正、派生计划来源和过期保护。
- `npm run test:magnetic-visible3d`：7 个 V1/API 回归通过；真实 transport adapter 的模拟 HTTP 两阶段流程继续使用共享请求和 Wire Capture，新模型响应按 V2 校验。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs test/brick-spatial-*.test.mjs test/brick-selected-spatial.test.mjs`：178/178 通过，包含新增 V2、2D、Catalog、保存与 DUPLO 相关回归。
- `npm run test:magnetic-3d`：173/173 通过，原 Engine、Viewer model、Editor、Tutorial 和 Build Order 单元回归保留。
- `npm run typecheck:magnetic-3d`、`npm run build`：通过。生产构建仍有原 Three.js 大 chunk 提示。
- `npm run test:magnetic-visible3d:v2:browser`：临时 API、实际 Chrome/WebGL，验证无需 JSON 的形状/Profile 确认、整体纠正、连接建议表单、完整 Planning 解释选择、两片候选和三片闭环、采用保存、刷新、过期/预算保护及下游 Build Order。
- 浏览器还从本轮隔离评估目录加载真实紫色照片与实际模型的两组候选，确认截图有实际零件像素，逐一切换，对候选明确采用，并核对导出/刷新后 Pose、ProfileSnapshot、3 片/3 连接一致；此浏览器回放没有再次调用模型。
- 原 Editor、Tutorial、Build Order 及 2D Review 浏览器回归采用既有隔离脚本；2D 仅复制所需 rose fixture 到临时目录，不向现有服务保存测试记录。

真实评估：`/tmp/magnetic-visible-v2-evaluation.json`（累计 Usage 和结果）；完整模型记录分别位于 `/tmp/magnetic-visible-v2-live-qdRGcY/`（格式失败）和 `/tmp/magnetic-visible-v2-live-KDeucd/`（成功的两阶段、候选与 source.png）。

浏览器结果：`/tmp/magnetic-visible-v2-browser/result.json`、`real-purple-evidence.png`、`real-purple-candidate-1.png`、`real-purple-candidate-2.png`。

可零付费回放本轮真实结果：

```bash
node --experimental-strip-types scripts/verify-magnetic-visible3d.mjs \
  --v2 --live-evaluation /tmp/magnetic-visible-v2-live-KDeucd
```

`scripts/evaluate-magnetic-visible3d-v2.mjs` 只有显式 `--execute`、Source ID、模型和测试审核 Profile 参数齐备才允许最多两次真实调用，写入临时目录，不重试/回退。测试人工审核假设和实际 Usage 均写入 evaluation.json。不要把自动化浏览器回放的 `realVisionCalls:0` 与本轮前述 3 次真实模型调用混淆。

## 剩余问题与下一步

目前只有这 1 张真实照片。两片 90°、三片空间结构、错误连接、多解释、Unknown 等其余案例有合成/人工 fixture 覆盖，没有新的真实照片识别成功率数据。应再收集少量不同透视、三角片、遮挡和真实非直角连接图片，逐项记录计数、Family、端口、角度、闭环及照片人工匹配结果，再决定是否继续微调 Prompt。

二面角符号、对称片局部编号、透明重叠、接缝是否真的接触、实际尺寸和相机深度仍会歧义。复杂实例可能超预算或没有合法候选，必须保留 Diagnostic；不能用几何合法替代照片验证。V2 响应也更长、token 成本更高，应关注“可执行且照片相容的结果”，不是解释长度。

本轮停止在 V2；未自动开发相机优化、重投影、镜像/隐藏结构补全、Gallery 或 V4。
