# Parts Input Snapshot V1（已实现）

## 职责与入口

- Part Explorer Current Review 的保存及覆盖逻辑未改。
- `server/brick-parts-input-source.mjs`：原有审核合并、隐藏件展开、库存一致性和准备构造器，从 Spatial workflow 迁出；原导出保留供现有调用者使用，不是旧数据兼容读取器。
- `server/brick-parts-input.mjs`：Parts Input Preparation，调用共享 Parts Geometry，计算集合身份、管理不可变 Snapshot、准备上下文、读取校验、当前输入只读比较。
- `server/brick-spatial-workflow.mjs`：新 plan/prepare 只消费 partsSnapshotId + preparationContextId，不再创建 Session / Mapping，不调用 Current Review 决定实例。
- `experiments/spatial-planning/runner.mjs`：仍只生成独立 Plan 及请求/响应 Trace。

API：

```text
POST /api/brick-parts-inputs/prepare
  {analysisId, reviewVersion}
  -> {partsSnapshotId, preparationContextId, planningEligible, geometryReady}

GET /api/brick-parts-inputs/<sha256:...>
  -> 完整、验证过的 Snapshot

POST /api/brick-spatial/prepare 或 /plan
  {requestId, analysisId, partsSnapshotId, preparationContextId,
   model, includeEvidence, promptVersion}
```

Spatial 的 prepare 仍表示“保存实际模型请求但不调用模型”；它不是 Parts Input Preparation 的备用入口。缺少正式 Snapshot 引用的新写入请求会被拒绝。

## 持久化与身份算法

Snapshot：`generated/brick-parts-inputs/<sha256 hex>.json`

```text
schemaVersion: 1
partsSnapshotId: sha256:<identity hash>
identity:
  schemaVersion: 1
  sourceImageId, analysisId
  instances[]:
    id, part, color, quantity: 1
    confirmedPart: {part_num, color_id}
    provenance（包括审核行、来源、隐藏件实例号）
    definitionReferences
    geometry / geometryStatus / geometryUnknowns
    dimensionsMm
  inventory[], units
mappingReview: {id, session, mapping}
definitions[]: 实际共享型号、Profile、颜色及资源证据
preparationEvidence: 首次准备的 Analysis、Review version/time、有效审核行
planningEligible, geometryReady
integrityHash
```

复用既有 Parts Geometry `definitionId`：递归按对象键排序后 JSON SHA-256。实例按实例 ID 排序、inventory 按型号/颜色排序；**Profile connector 数组顺序不变**。有效实例集合表达数量；Analysis、Source Image、颜色、实例来源、几何定义、Profile、单位均参与身份。保存时间、Mapping/Session UUID、运行 ID、模型和 Prompt 不参与。

Mapping Review 归准备服务：先计算集合身份，若已保存则读取验证原记录，不再创建 Mapping UUID。首次准备创建并冻结 Mapping/Session。并发通过临时完整文件 + 原子排他发布实现；竞争失败者读取赢家，不能覆盖。整份记录另有 integrityHash，读取检查内容、定义 hash、定义引用、Profile、Mapping 对应关系及数量。损坏时明确拒绝，不重建。

普通零件缺 Profile 继续保留原有显式未知语义：可规划但 geometryReady=false；人工隐藏件仍须有受支持的 Profile。几何规则未放宽。

## 准备上下文不是 Review Revision

`generated/brick-parts-inputs/contexts/<sha256 hex>.json` 保存正式准备上下文：

```text
schemaVersion: 1
partsSnapshotId
prepared: 本次审核构造出的完整准备输入、图片、几何快照及图片 hash
preparationContextId: sha256:<以上内容 hash>
integrityHash
```

上下文只在显式准备时生成，不在每次保存 Review 时生成；不提供 Review History / Selected Review。它保存本次使用的审核版本、图片、视觉证据及人工关系，避免复用 Snapshot 时错用第一次准备的指导。相同准备上下文可复用；仅保存时间变化时 Snapshot 相同、上下文不同。

上下文中的集合字段是审计证据，读取时必须与 canonical Snapshot 完全一致；Planner 的实例几何取自冻结 Snapshot。includeEvidence 由每次运行明确选择；模型、Prompt、请求与输出仍保存在各自 Spatial Trace。没有新零件数据库或第二套 History。

## Trace、History 与 Selected

新 Trace 保存 `inputContract: parts-input-snapshot-v1`、partsSnapshotId、preparationContextId；requestInput 和 sources 保留正式引用及原 Mapping 证据。读取校验实际 requestInput、图片、图片 hash、geometrySnapshot、sources 与准备上下文一致。

旧 Trace 沿用原始数据契约，不补字段、不推断 Snapshot。新入口唯一采用 Snapshot 路径。

History 与 Design Lab 显示：

- Current：当前有效审核及定义计算出的 Snapshot ID 相同。
- Outdated：当前有效集合身份不同。
- Unknown：旧记录无 Snapshot，或当前审核/定义无法确认；原因保留在证据详情。

只读比较不保存 Snapshot / Context。回到 Design Lab 浏览器窗口时刷新状态，不覆盖当前布局预览。Workflow History 仍是 canonical 记录的只读投影。

Selected Spatial 的 Key、关系文件、revision、CAS 均未改变；只对新 Trace 增加 Snapshot 来源验证。Selected 的输入状态在 History 中显示，但 Outdated 不清除/改选它。V1 仍可能按审核时间、视觉证据等分组，人工选择范围留下一阶段。

## 验证

- 相关回归 60/60 通过；最后新增 Profile 变化测试后，Snapshot 专项 8/8 通过。
- 使用真实 Penguin 审核和正式保存的 Catalog 证据，在临时目录验证：并发/重复准备同 ID；四块 11170 独立；只改保存时间同 Snapshot；颜色/实例/数量/隐藏来源/Profile 敏感；模型/证据模式不同仍共享 Snapshot；Planner 不读取 Review 或调用 Mapping；缺失/损坏明确失败。
- 端到端隔离重放：新 Snapshot → 保存 Spatial（注入已有模型结果，不调用模型）→ 实际 Geometry → 新 Layout Selection → 已有 11 步序列通过正式 Build Plan 保存校验。Current Review 改变后 History 为 Outdated，Selected 与 Build Plan 不变。该测试不是一次新的真实模型生成。
- Penguin / Camel / Rooster 的共享 Profile 与 2302 测试通过。原 Geometry Validator、Build Plan 实现未修改。
- 构建通过，有既有 bundle size 提示；本地 HTTP 确认 Penguin 旧 History 两条均为 Unknown，非法准备和缺失 Snapshot 返回 422。
- 263 个真实积木数据文件前后 SHA-256 一致；没有真实 Snapshot 或新规划写入，没有付费调用。浏览器实际交互仍需以下人工验收。

## 浏览器验收

1. 重启服务。Part Explorer 加载 Penguin `ed37d020…`，确认已保存 Current Review，进入 Design Lab。
2. 点击“准备 Parts Input 与请求（不调用 LLM）”。观察准备进度；成功后新记录显示 Current，在 Snapshot 证据里查看完整 ID。
3. 重复准备：两个不同 Plan ID 应共享 partsSnapshotId、Mapping Review ID。改变模型或视觉证据开关仍共享集合 ID，各 Trace 请求独立。
4. 在 Part Explorer 仅重新保存相同审核，再准备：Snapshot 不变；新上下文记录新的保存证据。
5. 更改实际型号/颜色/隐藏件数量等有效审核内容并保存。回到 Design Lab，旧计划应显示 Outdated；准备新输入得到新 Snapshot。审核未完成或映射无法验证时显示 Unknown/具体错误，不伪造 Current。
6. 检查原历史两条 Spatial：仍为 Unknown，原 Geometry、两个 Layout Selection 和 11 步 Build Plan 可正常打开。
7. 若要验收新的模型结果，明确点击“生成新的 Spatial Plan（调用模型）”，再执行 Geometry、保存有效 Layout、进入 Build Plan。此步骤会产生模型费用，本轮自动化没有执行。

实现文件：新增两个 Parts Input 服务模块和 `test/brick-parts-input.test.mjs`；调整 server 路由、Spatial workflow/runner、Selected 来源验证、Workflow History，以及 Design Lab / 两处 History UI。既有工作流测试改为新写入契约，旧历史读取测试继续保留。
