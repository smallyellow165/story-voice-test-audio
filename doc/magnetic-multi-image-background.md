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
| completed | 供应商执行完成；仍需通过原 Parser、Validator、图片证据和 Catalog 校验才保存 Analysis |
| failed | 明确的提交拒绝、供应商终态失败、拒答、不完整输出或输出契约错误；显示实际原因 |
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
- `.../analyses/{id}.json`：仅通过所有原检查后创建的原有 Analysis 格式；后台完成采用稳定 ID，避免保存成功但关联中断后重复创建。

调用链：`Visible3DWorkflow.modelAction → recordedSpatialOperation → runVisibleModel → runStructuredSpatialModel → callBrickModel → 单次后台 POST`；查询为 `resume-analyze → resumeSpatialOperation → resumeVisibleAnalysis → 同一 ID 的 GET → 原 validate / saveModelResult → 原 Analysis History`。

查询端不接受新的 Prompt、图片、模型参数或任意 Provider URL；只读已保存任务的 ID，独立核对 Source ID / Hash 和 Trace 关联。不同 Response ID 返回的内容被拒绝。提交和查询共用文件锁，避免并发写入；服务进程退出后的锁可恢复。完成后的正式 Trace 不继续轮询或修改，来源 Hash 校验仍有效。

## UI 操作

1. 更新并重启 `npm run dev`，进入 3D → Analysis，选择四张图片。
2. 用户确认余额后主动点击 Analyze 一次；看到 Submitting，随后 Running 与 Response ID。
3. 页面运行时只查询同一 ID。可切换阶段或刷新，再返回 Analysis。
4. 在「识别请求（已有记录）」选择对应请求；这个选择器只读取已有 requests，不创建新的 History。点击「查询 / 恢复已有识别任务」不会重新识别。
5. 完成且契约通过后点击「打开已完成识别并 Review」；不会自动替换已有 Review 或推进几何重建。
6. 右上角 Trace / Raw 查看 submission、各次查询、最终 Raw Response、Usage 与验证诊断。旧颜色失败和旧超时都能单独选择查看，未知费用状态不会显示成余额不足。

## 测试与已知边界

本轮真实模型调用 **0 次**，未覆盖正式存档。HTTP Fixture 只存在于测试和隔离浏览器脚本，不进入正常 Runtime。

- `npm run test:magnetic-analysis-background`：10 项确定性测试通过，含 >180 秒虚拟时间、queued → in_progress → completed、断线 / 超时恢复、HTTP quota / schema / auth / 5xx、ID 不符、来源 Hash、并发查询、死进程锁、完成关联中断恢复、坏 JSON / 颜色、单图前台及旧 Trace 不变。
- 全部 Magnetic Node：202/202 通过。
- 3D Vitest：20 个文件、216/216 通过。
- 相关共享 Spatial / wire / OpenAI 回归：210 项中 209 通过；唯一失败是既有 Brick `gpt-4.1 / step` 错误文案断言，在当前 HEAD 独立源码副本中同样失败，未扩改该模块。
- TypeScript / 生产构建通过。浏览器使用真实四图资源、真实应用及 API 流程，供应商 HTTP 被拦截：一次生成 POST，后续均为同一 Response ID 的 GET；自动查询、选择已有请求、切换阶段、刷新、查询断线恢复、完成 → Review、Trace / Usage、1650 / 1100 / 680 布局通过。合成识别输出不代表真实四图识别准确率。
- 旧失败 Trace 浏览器回归覆盖多个正式失败记录的明确选择、刷新恢复、文件定位及 2D 入口；正式文件字节不变。

仍需真实 OpenAI 调用才能确认：本账户支持 Background + 当前 strict schema、实际排队及生成耗时、实际 Usage / 费用、账户保留策略，以及真实识别质量。本轮不会自动开始这次调用。
