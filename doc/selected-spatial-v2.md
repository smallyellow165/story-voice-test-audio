# Selected Spatial Planning V2

## 选择范围与持久化

每个真实 Source Image / Analysis 组合最多一条当前选择。范围只包含：

```json
{"schemaVersion":2,"sourceImageId":"sha256:…","analysisId":"…"}
```

`selectionKey = 'sha256:' + SHA256(JSON.stringify(identity))`，字段顺序按上述契约固定。

存储：`generated/brick-spatial-plan-choices-v2/<selectionKey hex>.json`

```text
schemaVersion: 2
selectionKey
identity: {schemaVersion:2, sourceImageId, analysisId}
selectedSpatialPlanId
revision
```

未选择时 API 返回 selectedSpatialPlanId=null、revision=0，不创建文件。Select 继续使用同范围排他文件锁、expectedRevision 检查、写入前复核和原子 rename；过期请求返回 409。改选只更新此关系。

Review version、Mapping UUID、Parts Snapshot 和完整输入 hash 不再参与选择范围。它们保留在原始 Trace，并作为 API 的 `provenance` 详情返回。人工作出的选择不代表 Current，也不代表下游已选定。

## 校验边界

保留 V1 的来源与有效性检查：Analysis / Source Image 真实存在且一致；历史 Review / Mapping 引用、实例数量、目标型号/颜色和图片 hash 一致；Plan 的解析输出、完成状态和正式 Plan Validator 全部满足条件。

新 Snapshot Trace 继续接受严格 Snapshot / 上下文一致性检查。没有 Snapshot 的旧 Trace 按原始正式来源校验；缺少新字段本身不构成失败。来源不足或冲突仍拒绝，不读取当前 Review 来补造历史。Prepared / failed / 损坏的 Plan 不可 Select。

既有接口不变：`GET/POST /api/brick-spatial/plan-choice/<planId>`。POST 仍需 selectionKey 和 expectedRevision；其他 Analysis 的 Key 不能用于目标 Plan。

## V1 实际数据与切换

本轮检查时，`generated/brick-spatial-plan-choices` 目录不存在，V1 关系文件为 **0**。因此直接启用新的 V2 目录，不需要迁移。

运行代码只读写 V2 目录；不读取 V1、合并 V1 选择或推断用户决定。测试在隔离目录中放入多条 V1 关系，验证 V2 初始仍为空、改选后 V1 原文不变。

如果其他部署有 V1 关系，应保留原文件为审计资料，由用户明确指定某个 Analysis 采用的 Plan，再通过 V2 正式接口提交并记录操作；不能自动取最新或最高版本的 V1 选择。本轮没有运行迁移工具。

## UI 与 History

- 同一 Analysis 的历史仍由既有 Spatial History 提供；下拉自动 Load，不自动 Select。
- 显示“此 Analysis 的 Selected”，保留执行状态和 Current / Outdated / Unknown。
- Select 成功更新本 Analysis 各行标记，不修改 Geometry 当前候选或布局。
- 并行读取各行可能跨越一次关系更新，UI 依据同一正式关系的 revision 统一显示，避免同一 Analysis 出现两个 Selected 标记。Workflow History 每次投影也固定同范围的一份选择关系。
- Snapshot / Mapping / 输入 hash 放在证据详情。Hover Hint 说明 Analysis 级选择；原有切换预览保护继续保留。
- Current Review 改变不清除选择：可显示 Selected · Outdated 或 Selected · Unknown；该状态不参与选定资格判断。

## Penguin 实际可选记录

Analysis：`ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`。

| Plan | 可 Select | 说明 |
| --- | --- | --- |
| `f18759ed-d4e1-45cc-b257-4ad5d71d48a8` | 是 | 完成的旧 Trace；无 Snapshot，匹配为 Unknown；有 Geometry、Layout 和 11 步 Build Plan 分支 |
| `b02871ca-e1ed-43ef-a416-9ba6dff25b74` | 是 | Spatial 本身通过正式条件；其 Geometry no_solution 不等于 Spatial run 失败；无 Snapshot，匹配为 Unknown |
| `c5c07e02-20cc-40f0-b42b-3d36e1e363a9` | 否 | prepared，可查看 |
| `43e112ee-3a2e-4c5e-bb95-60741d377e65` | 否 | prepared，可查看 |
| `5201c771-3b38-494d-aa5f-e192777ac964` | 否 | prepared，可查看 |

五条共享 V2 Key：`sha256:ccca90dd3f875a62af497043d0c5a39d7caf249054a7e2dad863256876ead2e8`。只读检查没有替用户选择任何一条。

## 测试与变更

修改文件：

- `server/brick-selected-spatial.mjs`：V2 范围、独立关系目录、来源证据分离；并发算法不变。
- `server/brick-workflow-history.mjs`：同一次投影固定每个 Analysis 的选择关系。
- `src/brick-test/SpatialPlanningHistory.tsx`：Analysis 级文案、统一标记、证据详情。
- `test/brick-selected-spatial.test.mjs`：改选、跨 Analysis、并发、V1 保留、真实旧历史、UI 和下游字节不变。
- `test/brick-parts-input.test.mjs`：两个真实不同 Snapshot 的有效 Plan 共享选择范围；Outdated 的采用决定保留，再改选 Current。

Selected 专项 13/13、最终相关回归 58/58 通过；构建通过（既有 bundle size 提示）。测试全部使用隔离写入；无付费模型调用。真实积木数据 271 个文件前后 SHA-256 一致。未修改 Snapshot 身份、Current Review、Planner 模型输入、Geometry 或 Build Plan Validator。

## 浏览器验收

1. 重启服务，在 Part Explorer / Workflow History 打开 Penguin `ed37d020…`，进入 Design Lab。
2. 下拉选 `f18759ed…`，确认自动加载；点击 Select，应出现 Selected · Unknown。
3. 下拉选 `b02871ca…`：当前查看改变，但正式 Selected 仍为 f18759ed；确认后点击 Select，Selected 移到 b02871ca。
4. 刷新页面或重启服务后重新打开：仍仅 b02871ca Selected。三条 prepared 的 Select 应不可用。
5. 打开原 f18759ed 下游：Geometry、两个 Layout Selection、11 步 Build Plan 应仍存在且来源不变。
6. 用两个标签页测试过期选择：先在一页改选，另一页持旧 revision 提交必须报冲突，不能静默覆盖。错误后的重新读取只同步状态，不自动重试 Select。
7. 有不同 Snapshot 的完成记录时，可直接跨 Snapshot 改选；修改当前审核后，保留 Selected 并查看独立的 Current / Outdated / Unknown 状态。

浏览器实际点击与视觉布局仍需人工验收；自动化覆盖服务端、持久化和 UI 静态渲染行为。
