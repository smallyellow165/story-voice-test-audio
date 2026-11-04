# Multi-Image Analysis · 超时与任务恢复

## 已有第二次失败能确定什么

实际读取的 Trace 为 `9cc581af-e87a-40e5-b336-6b32dedbd2e2`：

| 字段 | 原始值 |
|---|---|
| Model / Reasoning | `gpt-6.1-sol` / `medium` |
| Prompt | `magnetic-multi-image-analysis-v1.1-color-contract` |
| 请求 | Responses API，非流式，`store:false`，没有 `background` |
| 输出格式 | `json_schema` / `strict:true` |
| 耗时 | 180032 ms |
| 结果 | `provider_or_trace_failed`、`wireStatus:no_response`、`transportError:TimeoutError` |
| HTTP Status / Request ID / Provider Response ID | 均未获得 |
| Raw Response / 模型输出 / Usage | 未获得；不能据此推算实际费用 |

180 秒的确定来源是 `server/openai-responses.mjs` 原有 `requestOpenaiResponse` 的 `AbortSignal.timeout(180000)`，作用于等待完整前台响应。前端 `intakeApi` 没有自己的 Abort / 重试。`server.mjs` 没有另设 180 秒响应限制；本机 Node HTTP 默认 requestTimeout=300000（接收请求）、headersTimeout=60000、socket timeout=0，这些与本次供应商 fetch 超时不是同一层。

Trace 没有 `insufficient_quota`、Schema 拒绝、HTTP 4xx 或供应商异常响应的证据。不能把余额、Schema 或供应商停机当成已证实原因，也不能认定客户端停止等待后供应商一定停止执行。模型支持 Structured Outputs，但本账户、本次 Schema 与 Background 的真实组合仍需一次用户主动的在线调用确认；本轮不发送。

旧请求没有 Response ID，且 `store:false`，目前不能从现有存档可靠检索原结果；不会尝试按内容猜测 Response ID，也不重新提交。原文件 SHA256：`879e2b43ffa57e160e00354756e1015cab10d92431267fa96245c64c35521b72`。第一份颜色失败 Trace 也保持不变。

## 选择 Background + 同一 Response Retrieval

仅对 **Visible 3D、2–4 图、OpenAI Analysis** 启用 `background:true, store:true`。一次 POST 获取 ID，然后用 `GET /v1/responses/{id}` 查询；queued / in_progress 只代表仍在执行。采用官方 [Background Mode](https://developers.openai.com/api/docs/guides/background) 和 [Retrieve Response](https://developers.openai.com/api/reference/resources/responses/methods/retrieve)，不引入流式解析、第二阶段识别或新的队列平台。

选择它是因为可在提交后保存供应商 ID，后续恢复不依赖同一 HTTP 连接。Streaming 本身不能解决刷新后继续查询或提交确认丢失的问题。本轮不同时维护另一种流式主链路。

`store:true` 是有意的请求参数变化，用于后续恢复；供应商会按账户的数据保留政策保存 Response，不代表无限期可检索。ZDR / 其他账户策略可能覆盖 store 设置；过期或不可用时显示实际 GET 错误，不重新生成。参考 [OpenAI 数据保留说明](https://developers.openai.com/api/docs/guides/your-data)。

单图 Prompt、单图请求、2D Analysis、多图颜色 Prompt V1.1、Canonical Schema / Validator、Planning、几何及 Assembly / Build 算法不变。Gemini 路径不启用 OpenAI Background。

## 状态与边界

| 本地状态 | 含义 / 行为 |
|---|---|
| submitting | 正在提交一次请求，等待供应商确认；不会重复提交 |
| running | 已保存 Response ID；只查询同一 ID，不设置 180 秒生成总截止时间 |
| completed | 供应商执行完成；格式、来源及引用完整性通过后保存 Analysis，可审核的重复标注问题保留诊断 |
| failed | 明确的提交拒绝、供应商终态失败、拒答、不完整输出或阻断性完整性错误；保留 Trace / Raw 与实际原因 |
| timeout | 本次提交 / GET 等待超时；有 ID 时仍可恢复，不代表供应商取消 |
| unknown | 网络中断、无法识别的响应或查询服务错误；不伪称模型生成失败 |

后台初始 ACK 的 HTTP 等待上限 90 秒，每次 GET 上限 30 秒；它们不是模型总执行上限。没有拿到 ID 的提交超时 / 断线只能标记未知、可能已计费，不能自动重发。若服务进程在确认提交期间退出，读取已有记录时会将超过 95 秒仍无 ID 的 submitting 显示为 unknown；此展示不改写旧 Trace。

Analysis 页面每 5 秒查询 running Response；切换阶段 / 模式停止浏览器轮询，供应商任务继续执行。返回 Analysis / 刷新后从现有记录恢复。20 分钟自动查询窗口结束或查询异常时暂停自动查询，用户仍能手动查询同一 ID。没有新的 POST fallback。

客户端超时后立即重新点击识别，可能产生第二次费用；对于已知 background timeout / unknown，创建新请求前有明确确认提示。已有 requestId 重复提交仍沿用原去重机制，不创建新调用。X-Client-Request-Id 使用本地 Trace / 查询 UUID，供排障关联，并非生成幂等承诺；见 [OpenAI Request IDs](https://developers.openai.com/api/reference/overview#debugging-requests)。

## 存储、验证及调用链

沿用原目录，不增加第二套任务 / Recognition History：

- `generated/magnetic-intake/visible3d/requests/{requestId}.json`：现有请求记录，增加运行期间的 checkpoint，保留 fingerprint、Source ID / Hash、Trace 关联及结果引用。
- `.../model-traces/{traceId}.json`：模型、Prompt 版本、实际 request、Provider Response ID / Request ID、HTTP / Error Code、状态事件、耗时、Raw Output、Parser / Validator 及实际 Usage。
- `{traceId}.request.json` / `{traceId}.response.txt`：原有提交 wire 文件，保留提交响应。
- `{traceId}.polls/{queryId}.request.json` / `.response.txt`：每次查询的 GET method / URL 元数据（GET 没有请求正文）、实际原始响应。Trace 中保留查询关联，已有 Trace Viewer 的 wire.response 指向最新实际查询响应，另保留 submissionResponse。不会将旧响应冒充失败 GET 的新响应。
- `.../analyses/{id}.json`：可安全审核的不可变结果；所有新模型 Analysis 使用稳定 Trace ID，避免保存成功但关联中断后重复创建。`evidence` 是严格契约下的 Review 投影；发生主图重复标注规范化时另存 `rawEvidence` 和 `analysisValidation` 诊断/策略，原 Trace 不改写。

调用链：`Visible3DWorkflow.modelAction → recordedSpatialOperation → runVisibleModel → runStructuredSpatialModel → callBrickModel → 单次后台 POST`；查询为 `resume-analyze → resumeSpatialOperation → resumeVisibleAnalysis → 同一 ID 的 GET → validate / saveModelResult → Analysis History`。已 completed、wire 已保存的输出直接本地重校验并持久化，不 GET、不生成，不改变 Trace 的原始状态。

查询端不接受新的 Prompt、图片、模型参数或任意 Provider URL；只读已保存任务的 ID，独立核对 Source ID / Hash 和 Trace 关联。不同 Response ID 返回的内容被拒绝。提交和查询共用文件锁，避免并发写入；服务进程退出后的锁可恢复。完成后的正式 Trace 不继续轮询或修改，来源 Hash 校验仍有效。

## UI 操作

1. 更新并重启 `npm run dev`，进入 3D → Analysis，选择四张图片。
2. 用户确认余额后主动点击 Analyze 一次；看到 Submitting，随后 Running 与 Response ID。
3. 页面运行时只查询同一 ID。可切换阶段或刷新，再返回 Analysis。
4. 左栏统一的 **Analysis History / Analysis 历史** 同时展示当前来源的模型请求和独立人工标注；请求拥有结果时只展示一次。右栏不再有重复请求下拉框。Create 仅读取自己的确切操作收据，Edit 不导入其他来源。
5. 状态区分供应商 running / completed、阻断性 Validation Failed，以及已保存的 Reviewable（含诊断）。选择失败记录仍可查看 Trace / Raw、Usage 和原校验错误。已完成的旧失败请求可点击「恢复结果并 Review（不调用模型）」；已保存结果使用「进入 Review」。恢复本身不自动选中 Analysis，也不自动生成 Review / Plan / Assembly。
6. Review Inspector 中可展开「Analysis 标注诊断」。Trace / Raw 在 Analysis 和 Review 顶部均可打开；旧 Trace 保留原先 invalid_plan，正式 Analysis 的可审核状态独立记录。选择一个无结果请求时不展示另一条 Analysis 的标注，也不丢弃原 Review。

## Analysis 校验边界与主图重复字段

`server/magnetic-analysis-validation.mjs` 仅处理 Analysis。JSON/字段结构、归一化坐标范围、唯一 Observation/Feature ID、可解释的证据关联、来源图片 ID/Hash、引用存在性与 Catalog 版本仍必须正确。缺少来源关联、外部图片、悬空引用等不会通过“规范化”修补。模型新输出仍必须 V2，没有旧格式 fallback。

模型契约明确 root `bbox/features` 属于 `referenceImageId`。图片级主图入口是同一帧的重复表达；其与 root 不一致属于可审核标注诊断，不能等同于供应商失败或 Geometry Invalid。适配器保留完整原始输出，明确将 root 的已有 bbox/features 投影到同一主图 alias，并记录 Observation/Image ID、诊断与 `reference-alias-v1` 策略。其他帧、Step/Final 角色、坐标、Feature、文本不被改写，不跨图片借用。缺少对应主图入口时不创建伪造关联。模型输入也补充明确的重复字段一致性要求。

这不是几何修正：默认 `parseVisibleEvidence` 仍严格检查别名一致性，适配后数据必须再次通过它；正式 Review、Planning、Execution、Geometry Validator 和来源 Hash/CAS 沿用原规则。读取模型 Analysis 时会从原 Trace 重新推导投影及诊断，并核对不可变记录的 Hash，不能靠改写投影并重算记录 Hash 绕过来源。

原来右栏读 `requests`（有提交、完成、失败、Raw）；左栏读 `analyses`（仅有可用快照），所以后处理失败会一边有 completed、一边空。现在 UI 按原请求及其确切结果引用合并，无第二套历史存储。工作区按已有 requestId 找到恢复结果，不按相同照片、名称或 Project 猜归属。

2026-11-04 Truck-Ramp：Trace `a0cd6b1f-a2b0-4b50-b0a6-b15005f054b2`，Request `d602c6fe-4dd0-44ff-8ba0-75d82871e18a`。25 个 Observation 的 root 与主图 bbox 全部一致，但图片级 features 全为空，root 则有 features。结构化输出 Schema 允许此结果，Prompt 未明确要求两套 features 完全重复，而原语义 Validator 直接阻断，属于契约重复表达与错误分级问题，不能据此认定 25 个实例的几何错误。

该记录已通过真实 Source/图片 Hash 检查、本地恢复及读取回验，生成同 Trace ID 的一个 Analysis，25 个实例、25 条诊断。重复恢复幂等；Raw Trace 字节 SHA256 保持 `d6bffabff4cb33c6e320314d9a673395a8eed5bf668919ca53cacf989b85bcca`。没有模型调用、自动 Review、Spatial Plan、Geometry Execution 或 Assembly 改写。只更新该请求与新增它的 Analysis；未执行批量迁移。

## 测试与已知边界

- `npm run test:magnetic-analysis-validation`：主图 alias 诊断、投影与 Raw 保留；错误坐标/ID/图片关联阻断；旧 invalid_plan 离线恢复、幂等、Review 保存、来源 Hash、投影篡改拒绝和工作区收据隔离。
- `npm run test:magnetic-analysis-background`：真实请求链的本地 HTTP Fixture；包含新完成结果的诊断保存、单图后处理失败仍保留 Trace/Usage，以及原队列、断线、超时、身份与锁测试。Fixture 不进入正常 Runtime，不访问付费 API。
- `npm run test:magnetic-analysis-recovery:browser`：临时数据、真实 Studio/API，失败 Trace/Usage → 本地恢复 → Review 保存 → 刷新重开、单份历史和 Create 隔离；原 Trace 字节不变，没有 Provider 调用。
- 原 background、Create/Edit 工作区、多图、3D 引擎和 LEGO Gallery/Spatial 回归；TypeScript 和生产构建。具体本轮结果见交付报告。

本轮 Magnetic Node 297/297、3D Vitest 327/327、LEGO Gallery/Spatial 60/60 通过；恢复、后台请求和工作区浏览器回归通过。额外的既有多图浏览器脚本未通过：识别前搜索定位命中隐藏控件，临时收紧测试定位后又在图片上移菜单不可见处超时。没有因此修改图片菜单或把该脚本记为通过；多图 Node 9/9 和本次四图恢复浏览器测试通过。

规范化不会使识别正确、照片匹配或 Geometry Valid；不合规坐标、不可解释来源或缺失引用仍需解决。没有新增坐标推断、LLM 修复、审批系统、历史迁移或自动几何流程。
