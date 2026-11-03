# 3D Selected + Lineage：调查与统一

## 原有事实与缺口

只读检查现有小车 Project `7fbf1042…`：1 个 Analysis、3 个 Review、5 个 Plan、9 个 Execution、5 个 Origin。其服务端 `visible3d/heads/<sourceId>.json` 原来只有 `revision:3 / reviewId:7f86bfcb… / reviewHash`，没有 Analysis、各 Group 的 Selected Plan / Execution。

结果记录本身已有良好的不可变 ID、内容 Hash、父 ID/Hash：Review → Analysis，Plan → Review，Execution → Plan，Origin → Execution/Plan/Review/Analysis/Source。模型 Trace 还绑定实际图片和请求。Registry / Canonical Profile / Port 已统一；本轮没有改变几何定义。

实际风险：

- `Visible3DWorkflow::chooseReconstruction` 从按时间排列的 history 取第一条匹配 Plan，再取其第一条 Execution；切回 Group 时可能悄悄使用新历史。
- 单份 localStorage context 保存全局 Plan/Execution ID，不能表达 Front/Back 独立当前选择。只改本地历史下拉，也没有改变服务端的“最新保存 Review”。
- 服务端 `outdated` 原本只比较最近保存的 Review head，没有 Selected Plan / Execution 校验；旧 Plan 仍可能在另一个版本已被选择后执行/采用。
- Group Scope 原来只比较本次图片交集，未固定 Group 的完整成员集合；交集之外的成员变化可能未被发现。
- Assembly 角度建议已沿单个不可变 Origin 读取，上一轮已删除跨历史 Port Mapping，没有重新引入。但单有不可变来源还不能证明它仍是该 Group 当前选定的来源。
- 严格 Geometry Valid 的 Build 原来可直接在本地生成/保存，缺少当前来源链的服务端检查。

## 最终契约

复用既有存储，不新增 Project/Geometry/Solver/History 系统。

| 对象 | 唯一身份与来源 |
|---|---|
| Project | 现有不可变 Source / Source Set 的 ID；Hash 固定原图、处理视图及实际有序图片集合/元数据。同一集合重复打开复用 ID，多次 Analysis 共用该 ID。改变图片输入快照会得到另一个 ID，不进行身份重绑。 |
| Analysis | 现有 result.id/hash + sourceId/sourceHash；来源图片集合由该不可变 Source 固定。 |
| Review | 现有 result.id/hash + 唯一 analysisId/analysisHash；保存时只继承当前 Selected Review 的模块。`parentReview` 只是创建来源，不是选择指针。 |
| Group | 现有 Module ID、Module Plan ID/hash、成员 ID 集合；Plan Scope 另外固定完整 `groupObservationIds` 和本次交集 `observationIds`。 |
| Plan | 现有 result.id/hash + reviewId/hash + reconstructionScope + Canonical Geometry 契约。 |
| Execution | 现有 result.id/hash + planId/hash + 相同 scope；Refinement 仍是该唯一 Plan 的明确输入。 |
| Assembly Draft | 复用单个工作区 Draft CAS 与不可变 Origin；Origin 保存实际 Execution、Plan、Review、Analysis、Source、Candidate/Diagnostic 身份。编辑和 Undo/Redo 不重绑这些父来源。 |
| Tutorial | 原有 Assembly 快照与 Revision；照片来源的教程额外保留 `source.reconstructionOrigin: {id,hash}`。保留真实 Invalid 诊断，不再生成或依赖人工批准引用。 |

**唯一 Selected Source of Truth**：复用 `visible3d/heads/<Project Source ID>.json`，增加：

```
revision                  # 既有 Review 保存 CAS，不改变其含义
selectedRevision          # 选择变更 CAS
analysisId / analysisHash
reviewId / reviewHash
groups[Group ID] = {
  scope,                  # 包含 Image Scope 与完整 Group 成员
  plan: {id, hash},
  execution?: {id, hash}
}
```

每个 Group 只有一条选定链。Image 是该 Plan 的输入，不另建“同一 Group 多条 Selected 链”。切换图片浏览不改变范围；切换重建范围不会自动找历史。若当前选定 Plan 属于另一图片范围，当前视图不展示它，需明确选择相应完整结果或重新生成。

Project 的当前打开 ID、模型偏好、图片显示偏好、Candidate 预览偏好可以留在 localStorage；Analysis/Review/Plan/Execution 的正式选择不再从 localStorage ID 恢复。实际 Project 定义继续是现有不可变输入快照，本轮没有引入可独立改名、增删图片而保持原 ID 的 Project 管理功能。

## 选择、创建和失效

- 现有 History 下拉通过 `POST visible3d/selected` 提交阶段、Result ID/Hash、期望 selectedRevision。服务端重读真实父记录、当前选择和最新 Group 成员；跨 Project、跨父版本、错误 Hash、过期 CAS 均拒绝。
- Analysis 改选：清除 Selected Review 与所有 Group 当前链。Review 改选：清除各 Group 下游选择。历史原件不变。
- Plan 改选：只清除这个 Group 的 Selected Execution。其他 Group 保持原状。Execution 必须属于该 Group 已选定的 Plan。
- 保存 Review、保存人工 Plan、明确执行 Planning / Execution 可以选择该次新结果；选择基于明确请求及 CAS，不基于时间戳。迟到 Planning 响应的记录仍保存，但不能覆盖期间已被用户改选的指针。
- 背景 Analysis 完成只保存历史；用户可使用原有“打开已完成识别并 Review”明确选定。不因为查询到最近成功请求就换 Analysis。
- Group 改成员：只清除受影响 Group 的当前链。单纯重命名不改变输入。服务端在执行/采用/Build 时仍重算最新范围，防止绕过 UI。
- 切回历史 Review 时，先明确选择其完整 Analysis，再选 Review，之后选对应 Group 的完整 Plan/Execution。不从多个旧结果收集零散 Port、Pose 或关系。
- 新正式执行链只消费当前 V5 Execution；旧无范围、旧格式结果可读取，但不会自动升级、回放采用或补齐元数据。没有历史迁移、Port Mapping 或备用来源路径。

## Assembly、Auto Fix 与 Build

Assembly 的当前 Draft 继续由既有 Draft CAS 选择；创建 Origin 不会冒充 Draft 保存成功，也不会因客户端取消/失败而改绑另一个 Draft。多个历史 Origin 可以存在，但消费者只能使用 Draft 明确记录的那个 Origin，而且其父 Plan/Execution 必须仍为该 Group 的 Selected。

`selected-origin/<id>` 校验完整来源链和最新 Group 输入。角度建议及 Auto Fix 定期/焦点刷新该检查，应用候选前再次校验；来源改变会阻断，绝不寻找另一份历史 Plan。手动 Snap 只使用当前 Draft 的真实 Port/Pose，不从历史补证据。

人工批准机制已移除；操作仍检查 Origin 与 Selected 链及 Hash。Pose 修改后的错误直接反映在诊断中。

照片来源 Build，在本地 Worker 生成前、使用生成结果及正式保存前调用服务端 `build-check`，重查 Selected Origin、Assembly ID、Registry 和原严格 Validator。Invalid 作品也使用同一本地 Worker 和 Player；碰撞不再需要授权，错误不会改写成 Valid。没有第二套 Build Player 或几何判定。失效 Draft 可以继续保留/导出/编辑，但不能把旧来源当成当前重建结果用于正式 Build。

## 验证

- 266 项磁力片 Node 测试：新增 Project + Front/Back 各两份 Plan/Execution、显式历史选择、成员变更、图片范围唯一链、跨 Project/Hash/CAS、真实延迟 Planning 响应不抢占新选择、严格采用和 Build 阻断。
- 297 项 3D Vitest 几何/编辑回归；专项 TypeScript 和生产构建通过。
- 新隔离 Chrome 浏览器脚本 `verify-magnetic-selected-lineage.mjs`：故意写入错误本地结果 ID，验证服务端恢复；Front/Back 独立历史切换；刷新；另一页面改选；正常 Candidate → Assembly → Build/保存；旧来源 Build 阻断；新旧 Review 完整选择；1780/1100/680 布局。
- 既有 Back 八片 Auto Fix/Snap 与 Front 九片 直接进入 Build 浏览器脚本使用明确的隔离 Canonical 测试记录。正式小车存档只读取和逐字节校验，不改写。
- 实际 LLM 调用 0、正式记录写入 0；接口模型测试仅使用拦截 HTTP 或明确离线 Fixture。

结果与截图：`/tmp/magnetic-selected-lineage/`；Back/Front 浏览器回归仍输出至原有 `/tmp/magnetic-canonical-geometry/browser`、`/tmp/magnetic-human-diagnostic/browser`。

## UI 最短验收

1. 重启开发服务，重新打开图片集合。选定 Analysis，再选该 Analysis 的 Review；必要时重新生成缺少新契约的旧下游结果。
2. Reconstruction 选 Front，明确生成或选定 Plan、Execution；切到 Back，分别生成或选定。
3. Back 改选另一份 Plan：Execution 应清空；切回 Front，其原选择应保留。
4. 刷新后仍恢复服务端那一份选择。选历史 Review 后，下游为空，按 Group 明确选择其兼容完整历史结果。
5. 采用到 Assembly 并保存，验证编辑/Undo/Redo、Auto Fix、Build。再改变其 Group 的 Selected Plan：旧 Draft 应保留，但 Auto Fix/正式 Build 显示来源失效，不拼接其他历史。
