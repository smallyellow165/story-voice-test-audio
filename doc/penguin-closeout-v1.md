# Penguin 端到端链路与 UI 收尾 V1

本轮只读核对真实持久化数据及现有服务读取接口，进行少量 UI 文案/展示整理。开始时 Git 工作区干净。没有调用模型、重算 Geometry、生成 Build Plan、播放或重做 11 步搭建验收。

## Penguin 已核实的正式链

| 阶段 | 真实身份 / 引用 |
| --- | --- |
| Source Image | `sha256:957bfeec320e103ebccb1b05aafe44c49088a908961868b6af47f31d22965b09` |
| Selected Analysis | `ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`，选择关系 revision=1 |
| Current Review | `brick-reverse/<analysisId>.json.review`，12 个有效实例；一份可覆盖审核 |
| Selected Spatial | `f18759ed-d4e1-45cc-b257-4ad5d71d48a8`，V2 选择关系 revision=1 |
| 该 Spatial 的 Review version | `39422e892278951769dcf9727ffe7c47fa4a8442b6d0987108d751c22e31665f` |
| 该 Spatial 的 Mapping Review | `54936721-39b4-495c-a8eb-0e7949c02563`，原快照保存于 Spatial.sources |
| Geometry | `c34c5c9a-b513-4ce5-b87b-47cbd96154f5`，planId 指向 f18759ed；sourcePlanHash / sourceInput 与实际 Spatial 一致 |
| Candidate | 上述 Geometry 下的 `candidate-1`；候选身份须带 Geometry ID，不能只凭 candidate-1 合并 |
| Saved Layout Selection | **`77d99b0e-9c62-4ba6-b655-bcf1a8db5828`**，明确引用 planId / geometryId / candidateId |
| Candidate hash | `c7dc1bdd6114a4f74f7e5304c49c103069340544f7161a450b7e053f72ef82bb` |
| Build Plan | `426f27c7-a9a9-4ee9-9965-39e1cd9e30f8`，source_selection_id 指向 77d99b0e；11 步，持久化状态仍为 draft |

通过 `brick-build` 的 `plans/<id>` 读取，得到的 source 反向包含 Layout、Geometry、Spatial、Analysis，再通过 Analysis.sourceImageId 和 Source Image 校验闭合。Workflow History 正向检查同一链的 ID、Plan hash、candidateHash、assembly 和源输入快照。没有另建 History 数据库或反向索引。

Geometry 状态为 `candidates_with_unverified_constraints`；候选几何有效不等于所有视觉关系已认证。用户已经实际测试步骤，不据此修改 draft / reviewed 等持久化状态。

## 多分支与 Snapshot 边界

- 同图有 4 条 Analysis：ed37d020、1b9a8805、80a0ad1a、abf0baf5。当前读取到 Current Review 的是 ed37d020 与 80a0ad1a。
- ed37d020 有 5 条 Spatial：f18759ed、b02871ca 为完成记录；c5c07e02、43e112ee、5201c771 为 prepared。
- 三条 prepared 明确引用 `sha256:e130489001d82b106ca5acfab4bb539e1911d50fecaac6e9ae100e9909398719`，当前正式计算结果与其相同，显示 Current。
- **f18759ed 没有 Parts Snapshot ID，显示 Selected · Unknown。不能将新的 Snapshot 插到这条历史链中。** 它的有效输入保存在自己的 requestInput / sources 中。
- b02871ca 的 Geometry 是 no_solution，不能继承 f18759ed 的候选。80a0ad1a 有自己的 3 条 Spatial 及多个失败 Geometry，没有继承 ed37d020 的 Build Plan。
- c34c5c9a 有 10 个候选。同一个 candidate-1 现有 3 条 Saved Layout：77d99b0e、c97485fc、e6600765，均独立保存。
- 按实际 selectionId 调用 Build Plan 列表：77d99b0e 返回 426f27c7；c97485fc 与 e6600765 返回空列表。没有按 Candidate、时间或 Selected 合并。

Selected Analysis / Spatial 关系只作标记。Current Review 修改不覆盖任何旧输入；精确审核版本匹配与 Parts Snapshot 匹配是两种不同证据。

## 保留的历史缺口

1. f18759ed 等旧 Trace 没有 Snapshot；不能证明它们使用新的 Parts Geometry 定义身份，Unknown 正确。
2. 旧 Spatial 保存了有效规划输入和 Review version / Mapping 快照，但没有完整历史 Parts Explorer Review 文件；当前 Review 不能冒充所有历史审核。
3. 已保存 Build Plan 没有可确认的成功 Build Order Trace 引用。现有 `5fac7f3e-fb38-40bb-bd48-ef5268aacc3a` 为失败 Trace，虽属于同一 Layout，但不能当作此 Plan 的生成来源。Plan → Layout → Geometry → Spatial 的来源本身可验证。
4. Workflow History 返回 31 条全局未关联诊断，其中包括其他旧 Analysis 的 Source Image 缺口等；这些不是“Penguin 有 31 条失败”，UI 已明确标注全局范围。

## Camel / Rooster 有限只读检查

| 案例 | 已有数据 | 继续操作前的缺口 |
| --- | --- | --- |
| Camel | Analysis `0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa`；7 行 Review；4 条 Spatial（1 完成、2 prepared、1 provider_or_trace_failed）；完成计划 `f1f84e96-8269-4132-807a-61c41243229f`；Geometry `6f7f1241-a230-4c8c-89cd-92f6775a793b`，512 个已保存候选；未找到其 Layout / Build Plan | Analysis 无 sourceImageId，当前审核恢复严格拒绝。旧 Spatial 缺正式 Review version/Snapshot；有历史 Analysis + design trace 引用，不将其解释成新 Snapshot。 |
| Rooster | Analysis `848fe628-5766-4f8c-8f73-5cf9235ef76d`；9 行 Review；1 prepared、1 完成 Spatial `7415a066-d5e1-490d-a863-936a285a4597`；5 次 Geometry（3 invalid_input、2 no_solution）；没有有效候选、Layout 或 Build Plan | Analysis 无 sourceImageId，当前审核恢复严格拒绝。正式图片关联补齐后，才能从 Current Review 继续新流程；当前没有可保存为有效 Layout 的结果。 |

两者旧 Spatial 读取仍可用，匹配均为 Unknown，Analysis 中均保留 originalImage payload，但没有存储的 originalImage.sha256。下一阶段应独立验证这些原始字节及来源证据，决定能否审计修复正式 Source Image 引用；本轮未创建图片身份或迁移数据。无需为两种动物另建工作流；没有发现需要放宽 Validator 的通用代码问题。

## UI 小范围整理

- Build Order 使用 Saved Layout 文案，避免把保存布局包装成新的 Selected / Approved。
- Layout 下拉缩短长 UUID，完整 ID 保留在原生 title 和 Source 详情；Build Plan 下拉增加短 ID，区分同名计划。
- Step List、Motion Hint、装配依据、Spatial Assembly 的控件说明改为同行 InfoHint，复用既有鼠标/键盘/点击可访问组件。
- Step / Result 长身份放到折叠详情。
- Generate Build Order 按钮明确“调用模型”；费用相关动作不藏到提示中。
- 未改变 History 自动加载、Select、Current Review 保存、Use This Layout、步骤编辑/保存/播放逻辑。保留未保存保护、错误、校验失败及动画限制提示。
- Part Explorer 与 Workflow History 现有交互已满足本轮要求，没有为了产生改动而重构。

## 测试与人工验收

更新 `test/brick-workflow-history.test.mjs`：隔离副本包含现有 Snapshot；按正式保存记录核对全部 Spatial/Layout 分支，不再写死旧的“2 条布局、2 条 Spatial”；明确验证 426f27c7 仅挂到 77d99b0e，其他布局不能继承它；来源 hash 不一致时只隔离相应分支。

只读接口核验及 History/Selected/Parts Geometry 自动化覆盖来源、分支和独立状态；其他相关 32 项通过，修正旧固定计数断言后的 History 9/9 通过，共 41 项。构建通过（既有 bundle size 提示）。没有运行 Penguin Build Plan 生成、播放或重新搭建测试。真实积木文件 274 个，前后逐文件 SHA-256 一致。

最少浏览器验收：

1. 从 Penguin 的 Workflow History 展开 Selected f18759ed，确认 Unknown、Geometry 分支及 3 条 Saved Layout 分别存在。
2. 打开 77d99b0e 下的 426f27c7，确认标题、11 步列表、Source 详情；切换另外两条 Saved Layout 应无已保存 Build Plan。无需重新生成、保存或播放。
3. 在 Step List / Motion / 装配依据旁的 ⓘ 用鼠标、Tab Focus 或点击查看说明，确认长 ID 可展开、错误与未保存提示仍可见。

实际浏览器交互需人工核验；本轮没有宣称重新完成播放器或实物搭建验收。
