# Parts Geometry → Spatial 输入身份解耦：调查与切换设计

后续实现已完成，见 [Parts Input Snapshot V1](parts-input-snapshot-v1.md)。下文保留调查时结论。

调查时状态：2026-10-28，只读调查完成；**未实现 Parts Snapshot 存储、复用或新生成入口**。本轮只新增本文，没有修改运行代码或真实历史。基线提交 `b78105b`。

## 1. 真实 ID 链

| 身份 | 创建位置与语义 | 保存 / 消费 |
| --- | --- | --- |
| sourceImageId | Source Image 原始字节 SHA-256 | Analysis 引用 canonical Source Image |
| analysisId | `ReverseAssemblyPanel` 提供 requestId；`brick-reverse.analyze()` 校验并保存为 record.id | `brick-reverse/<id>.json`；同一次请求幂等，不是内容 ID |
| observation.id | 模型输出，经 Analysis Validator 校验后保存 | 局部身份；跨 Analysis 应使用 `(analysisId, observationId)`，相同文字 ID 不表示同一实例 |
| 人工隐藏件 ID | Part Explorer 人工添加并保存到 Current Review.hiddenParts | Review 行身份；不改写原 Analysis |
| 展开实例 ID | `review-parts.mjs:planningReview()` 从人工数量确定性展开 `id`、`id__2` 等 | 非随机；同一审核重复准备不重新创造实例；数量变化影响实例集合 |
| Current Review 身份 | `<analysisId>.json.review`；保存覆盖，含 analysisId / updatedAt / rows / hiddenParts / manualRelations | 没有独立 Review UUID 或 Revision 文件 |
| reviewVersion | `brick-spatial-workflow.reviewedSource()` 对 `{updatedAt, rows, hiddenParts, manualRelations}` 做 JSON SHA-256 | 精确历史审核标记；**不是纯有效零件内容 hash**，仅保存时间变化也会变 |
| Part / Geometry / Color Definition ID | `brick-parts-geometry.mjs:definitionId()`，递归排序对象键后 JSON SHA-256 | 新 Mapping row.definitionReferences；没有独立定义数据库 |
| Inventory Session ID | `brick-spatial-workflow` 的 POST plan/prepare 内 randomUUID | Mapping Review.session.id；整批审核库存的一次准备记录，不是单块积木 |
| Mapping Review ID | `brick-spatial-mapping.spatialMapping()` 内 randomUUID | 整批映射审计记录，嵌入 Spatial.sources；不是 Parts Snapshot 内容 ID |
| Spatial requestId | UI 创建，服务保存请求 fingerprint / 状态 | `brick-spatial-requests`，只防止同一请求重复执行，不复用相同审核输入 |
| Spatial Plan ID | `experiments/spatial-planning/runner.mjs` 内 randomUUID；generationId 同值 | `brick-spatial-traces`；prepare（不调用模型）也生成一条 Spatial Trace |
| Geometry / Layout / Build Plan | 各自运行或保存记录身份 | Geometry.planId、Selection.geometryId/candidateId、Build Plan.source_selection_id 等保持独立 |

当前没有正式 Parts Snapshot ID。`prepareReviewedSource()` 内名为 snapshot 的临时对象，其 `id` 实际使用 Mapping Review UUID；它仅适配既有输入构造器，不是 canonical 集合快照。

## 2. 已共享与仍耦合的职责

Parts Geometry V1 已提供官方映射、颜色、特殊 Profile、资源证据及定义内容身份，可以支撑独立准备服务；它没有实例归属、集合一致性、不可变 Snapshot 存储或集合读取校验。

仍在 Spatial workflow 中的准备工作包括：读取 Current Review、展开审核实例、聚合库存、创建 Session、创建 Mapping Review、合并 Profile、组装图片和人工指导。核心 runner 本身已只生成运行 ID，但外围 Spatial API 尚不满足“只消费已存在 Snapshot”。

Mapping 的逐型号解析已调用共享服务；实例数量匹配与集合准备应迁到 Parts Input Preparation，不能全部归为共享 Part Definition。

## 3. 必须一起处理的契约边界

本轮按请求的停止条件停在设计，不提交只搬函数或增加孤立 hash 的半套链路。原因是以下契约需要同步切换：

1. **输入与证据混合**：现有 requestInput 同时包含实例、Profile、Mapping UUID、Review 时间版本、图片来源、可选 Analysis 证据及人工关系。不能直接 hash 整个对象当作 Parts Snapshot；也不能复用整个对象而丢失本次视觉/人工指导。
2. **严格来源检查**：Selected Spatial 要求 UUID reviewId、source Mapping ID、每块 observation.mapping.reviewId 一致；Key 包含 Mapping 全快照和 requestInput 全 hash。把 UUID 换成内容 ID 会违反现有校验，直接删这些字段也不可行。
3. **History 的“匹配当前审核”**：目前按含 updatedAt 的 reviewVersion 比较，不是零件内容匹配。仅增加 Snapshot ID 而继续显示旧判断，会错误报告无内容变更的重复保存。需增加独立的 Snapshot 匹配语义，不能改变历史 reviewVersion。
4. **未知几何是现有明确状态**：规划入口传 `allowUnknownGeometry=true`，普通零件可携带 null Profile；隐藏件要求已审核 Profile。执行阶段有独立、留痕的 enrichment。新准备层必须显式表达 planningEligible / geometryReady，不能顺便将缺 Profile 一律拒绝或默认为几何有效。
5. **下游 hash 已固化**：Geometry.sourceInput、Refinement.sourceInputHash、Selected Key 引用原 requestInput。任何历史补字段也可能改变这些 hash。不得重写旧 Trace。

不需要改几何数学 Validator，也不需要迁移历史才能部署一个新的写入契约；但新写入端、准备存储、Trace 来源校验、UI/History 当前匹配必须作为一个完整改动交付。不能以 runtime fallback 自动给旧记录补 Snapshot。

## 4. 最小目标契约（建议，尚未实现）

建议新增 `server/brick-parts-input.mjs`，属于 Parts Geometry / Input Preparation 边界。复用现有解析及实例/库存校验，唯一新增持久化为：

`generated/brick-parts-inputs/<sha256 hex>.json`

逻辑结构：

```text
schemaVersion: 1
id: sha256:<canonical identity JSON digest>
identity:
  schemaVersion: 1
  sourceImageId
  analysisId
  instances[]:
    id, reviewObservationId, source, visibility/instanceNumber（按来源严格定义）
    confirmedPart: { part_num, color_id }
    ldrawPart, ldrawColor
    partDefinitionId, geometryDefinitionId, colorMappingId
    geometryStatus（resolved 或明确 missing_reviewed_profile）
  units
definitions: 本次使用的去重定义内容及资源证据
preparationEvidence: 首次成功准备时的有效 Review 输入、Mapping 审计快照
```

这是 schema 草案，不是已经通过实现验证的正式 API。上线前要把每个字段的必选/可空约束固化，并校验 definitions 内容与引用 hash 一致。

身份规则：

- 排序对象键；实例按 ID、定义按 ID 排序。Profile 内 connector 数组顺序不能排序，它的下标参与连接语义。
- 用实例列表表达数量；不忽略隐藏来源、实例 ID、真实颜色、印花绑定或几何定义差异。不同 Analysis 不共享集合身份；共享的是定义身份。
- 不把随机 Session / Mapping UUID、保存时间、搜索记录 ID、模型、Prompt 或运行 ID 纳入 identity。
- mapping 审计原文可保留，但不对整份带 UUID/时间的审计对象计算集合身份。已有 Definition ID 应继续采用 V1 算法，不能偷偷改变其内容边界。
- 同内容重复准备只能读取验证已有记录，不覆盖首次快照。并发使用排他创建或原子发布；冲突后校验内容，不采用“最后写入覆盖”。损坏记录报错，不修复。
- 普通零件已确认映射但 Profile 未支持时，严格记录 null definition / 缺失状态；保持现有“可规划但不可几何执行”的区别。Profile 后来补齐应形成新 Snapshot。
- Snapshot 不存“当前 Review 指针”；Current Review 继续唯一覆盖。审核保存时间只是准备/运行审计，不构成集合内容。

## 5. Spatial Run 的输入不能等同于 Snapshot

建议新的生成入口只接受 `partsSnapshotId`、模型、Prompt 版本及明确的本次视觉/人工指导参数，不接受裸 inventory 来临时创建 Snapshot。

UI Generate 的顺序应明确为：

1. 调用独立 Parts Input Preparation API，验证 Current Review 并取得已保存 Snapshot。
2. 将该 ID 交给 Spatial API；若准备失败则不调用规划。
3. Spatial 读取/验证 Snapshot，不调用 reverse.restore / resolveMapping，不创建 Session 或 Mapping 身份。
4. 以 Snapshot 的实例和冻结几何，加上该次实际视觉证据、manualRelations、Prompt、模型参数构建请求并留存完整 Trace。

可以保留现有 Mapping Review 结构，改由准备服务创建一次并冻结；后续规划引用同一审计记录。保留现有 requestInput / sources 字段作为历史证据，新 Trace 增加明确的输入契约版本及 partsSnapshotId。**Mapping Review UUID 是准备证据 ID，Snapshot SHA 是有效集合 ID，两者不互相冒充。**

本次采用哪个保存版本、图片 payload、includeEvidence、人工关系和指导，必须作为本次运行上下文完整保存；不能沿用首次 Snapshot 的这些可变上下文。关系指导变化不必改变零件集合身份，但必须改变完整 Spatial 输入证据。实例增减、颜色/型号、隐藏来源、几何变化必须改变集合身份。

Snapshot 的首次准备证据可包含完整的有效审核投影，不需要每次保存 Review 都保留历史。若复用 Snapshot，本次审核采用证据存在 Trace；不能将首次准备时的时间说成本次审核时间。

## 6. History / Selected 的最小切换

- 旧 Trace 保持原读取契约和完整原文；没有 Snapshot 就显示“未记录 Parts Snapshot，无法按 Snapshot 判断当前匹配”，不计算一个猜测 ID。
- 新 Trace 由正式写入边界强制引用已保存 Snapshot；校验其 analysisId / 实例 / Profile 与 requestInput 一致。损坏或缺失不能退回 Analysis 自动准备。
- 当前匹配至少三态：matched / different / unknown；只有完成当前审核及定义的正式解析后，才能用 Snapshot ID 比较。未检查、当前审核无效、定义无法读取均不是 matched。只读比较不隐式保存 Snapshot。
- 不自动清除或改选 Selected。旧 Selected Spatial identity、文件、revision、并发 CAS 均保留。
- 本次输入契约切换可以暂时保留 V1 Selected Key：它仍可能被 Review 时间、证据模式及指导分开；不可声称 Snapshot 复用已自动解决选择分组。
- 下一步单独设计 Selected scope V2：候选起点为 `(analysisId, partsSnapshotId)`，但是否允许不同视觉/人工指导的结果互相改选是产品选择范围，不等于来源身份。显式版本化，不重算旧 Key，不自动搬迁选择。

所需生产修改：新增 `brick-parts-input.mjs`；从 `brick-spatial-workflow.mjs` 迁出准备职责；调整 `experiments/spatial-planning/input.mjs` 的集合/运行上下文边界；runner 增加正式引用；`server.mjs` 提供准备/读取/匹配 API；`SpatialAssemblyPanel.tsx` 显式两阶段调用；`brick-workflow-history.mjs` 与 `WorkflowHistory.tsx` 展示 Snapshot 证据及三态匹配。Selected 服务需验证新引用，但不改既有 Key/CAS。Geometry / Build Plan 不应因此修改事实结构或 Validator。

## 7. Penguin 真实证据

Analysis：`ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`。

| Spatial Plan | Review version | Mapping Review | Inventory Session | 下游 |
| --- | --- | --- | --- | --- |
| `f18759ed-d4e1-45cc-b257-4ad5d71d48a8` | `39422e892278951769dcf9727ffe7c47fa4a8442b6d0987108d751c22e31665f` | `54936721-39b4-495c-a8eb-0e7949c02563` | `ca7cc870-5c57-4a3c-9669-72fbd45a4d51` | Geometry `c34c5c9a-b513-4ce5-b87b-47cbd96154f5`，10 candidates |
| `b02871ca-e1ed-43ef-a416-9ba6dff25b74` | `5e0fb3f825013e7e3aea077d1f3e641038823adbcb503c0e83b73ba2662dbaac` | `955a5828-2a31-4d10-aa9a-997200d2d34b` | `e292e490-ad6c-4ef7-bb42-7b2df0bccd50` | Geometry `92f06430-a17a-4711-bd1f-7d251461564e`，no_solution |

两条均有 12 个实例，ID 列表相同；这**不能证明整套输入相同**，因此没有将它们合并为同一 Snapshot。两条都没有 definitionReferences，不能用当前定义反向补造历史身份。

成功 Geometry 的 candidate-1 有两个不同 Layout Selection：`c97485fc-166c-4e0c-ab31-156d9467564e`、`77d99b0e-9c62-4ba6-b655-bcf1a8db5828`。后者关联 Build Plan `426f27c7-a9a9-4ee9-9965-39e1cd9e30f8`，11 steps。Geometry 状态是 candidates_with_unverified_constraints，不能将其描述为所有约束均已验证。

只读恢复当前 Review 得到 12 实例、ready=true，reviewVersion 与 f18759ed 所存值一致。在内存中只替换 updatedAt，rows 完全相同而 reviewVersion 改变；验证了它不能用作纯零件 Snapshot 身份。没有保存修改。

当前工作区未发现 `generated/brick-spatial-plan-choices` 目录；因此本次不能声称已有真实 Selected Spatial 持久化记录已完成刷新验收。选择机制由隔离测试验证。

## 8. 验证与未完成项

执行现有五个测试文件：brick-parts-geometry、brick-spatial-workflow、brick-selected-spatial、brick-workflow-history、brick-build-order。**40/40 通过**；Parts Geometry 测试含真实 Penguin、Camel/Rooster Profile 与 2302 检查。`npm run build` 通过，有 bundle size 提示。没有付费调用。

未新增生产代码或自动化测试；没有新 Snapshot，未运行“两个 Plan 复用一个 Snapshot”的端到端验证。本次测试只能证明当前基线可运行，不能证明建议的新契约已实现。

实现阶段必须新增的测试：同输入重复准备与并发同 ID；保存时间不影响 ID；型号/颜色/数量/实例/隐藏来源/Profile 改变分别改变 ID；Profile connector 顺序保留；两个独立 Plan 共享 Snapshot 且 planner 不触发任何准备调用；Review 覆盖后旧快照不变；旧 Trace 不被补造；失败准备与损坏快照拒绝；不同视觉/人工指导保留各自请求；Selected 不随 current-match 改变。
