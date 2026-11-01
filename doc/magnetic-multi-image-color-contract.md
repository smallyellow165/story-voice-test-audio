# Multi-Image Recognition · 颜色契约修复

## 已确认的根因

调查对象为 Trace `9be836a5-870c-448e-a89f-f7e8f3cc0688`，原 Prompt `magnetic-multi-image-analysis-v1`，Model `gpt-6.1-sol` / reasoning medium。实际 HTTP 调用成功、JSON 已解析，23 个 Observation 均使用颜色名称。

| 层 | 原始实际实现 | 问题 |
|---|---|---|
| 多图 Prompt | 没有单图 Prompt 中的 Hex 颜色说明 | 模型不知道 color 必须使用 Hex |
| 3D 输出 Schema | `color: {type: 'STRING'}` | 允许任意文本 |
| 实际 OpenAI 请求 | `text.format.type: json_object`；Schema 仅追加在 instructions | 只保证 JSON，没有启用严格 Structured Outputs |
| Canonical Parser / Validator | `^#[a-fA-F0-9]{6}$` | 正确拒绝全部颜色名称；本轮不修改 |

因此这不是 HTTP / JSON Parser 故障，也不是 Geometry Solver 问题。上游契约没有表达下游已经存在的严格要求。

## 原始字段调查与离线结论

| 原颜色 | Observation ID | 数量 |
|---|---|---:|
| purple | t01、t02、t07、t08 | 4 |
| blue | t03、t04、t05、t06、t17、t18、t19、t20 | 8 |
| orange | t09、t10 | 2 |
| green | t11–t14 | 4 |
| red | t15、t16 | 2 |
| red/pink | t21 | 1 |
| yellow | t22、t23 | 2 |

测试副本只把这 23 个 `observations[*].color` 改成**同一个中性占位值 `#808080`**。这不是实测颜色、颜色名称映射或模糊颜色的自动消歧。所有其他字段原样保留，测试程序核对逐字段一致性。

颜色问题排除后，下列完整 Recognition 检查全部通过，未发现其他阻断项：

- Visible Evidence V2：字段、数量、ID、角点 / 边、bbox、归一化坐标、Shape Family、空间解释与证据引用。
- 每图证据：来源集合、主图 ID、主图坐标及 Feature 对应。
- Profile 候选：准确 ID@Version 均存在于原请求记录的 Catalog。
- 独立 Python `jsonschema.Draft202012Validator`：新 Schema 有效；原输出的违规字段均为 23 个 color；测试副本无 Schema 错误。

Schema 同时使用 pattern 和长度 7，避免不同正则实现对末尾换行的解释差异。原输出触发 pattern / minLength / maxLength 的多个诊断，仍只涉及同一组 23 个颜色字段，不是其他字段错误。

这些结论仅说明输出契约可用，不证明实际有 23 个不同物理 Tile、跨图匹配正确、颜色准确、最终几何可重建或人工审核已通过。

## 最小修复

- `server/magnetic-multi-image-vision.mjs`：版本更新为 `magnetic-multi-image-analysis-v1.1-color-contract`；明确每片必须直接输出六位 Hex。颜色不确定性放到 evidence / uncertainty，不在 color 中写 `red/pink`。不提供固定默认调色板。
- `multiImageSchema`：仅替换多图 Schema 的 color 节点，添加相同 pattern、minLength=7、maxLength=7 和说明。避免修改基础 Schema 共享的 STRING 节点，从而不影响 ID、文本或单图 Schema。
- `openaiMultiImageFormat`：复用现有 2D 严格输出方式，供多图 2D / 3D 使用。转换为 OpenAI 小写类型，Object 关闭额外属性；Gemini `nullable` 转为 `anyOf` 的显式 null 分支。
- `server/magnetic-visible3d-vision.mjs`：只对 OpenAI **多图 Analysis** 设置 `text.format={type:'json_schema',strict:true,...}`。单图和 Planning 分支不变。
- `server/magnetic-intake-vision.mjs`：多图使用上述转换器，原有单图 Prompt / Schema / 请求分支不变。

未修改 Canonical Validator、颜色数据、解析后的生产结果、Registry、Spatial Planning、几何或 Assembly 算法，也没有名称到 Hex 的运行时映射、额外模型调用、修复阶段或重试。

## 可重复验证

```sh
npm run test:magnetic-multi-image-color
npm run replay:magnetic-multi-image-color
```

回放脚本读取原始 Trace、实际 `.request.json` / `.response.txt`，核对原始响应与已解析结果，以及 Source Hash，使用保存的原图字节与顺序准备新请求，但**从不发送请求**。只在 `/tmp/magnetic-color-contract-audit` 写入：

- `replay-report.json`：原失败原因、23 个违规字段、新旧输出格式与 Prompt 版本、完整契约结果和原文件不变证明。
- `test-only-neutral-colors.json`：带 `testOnly` / `notForImport` 标记的包装副本，不能当成 Recognition Result 直接导入。
- `openai-output-schema.json`：本轮新请求实际会携带的严格输出 Schema。

本轮还生成了 `independent-schema-report.json`，记录独立标准 JSON Schema 校验结果。永久回归 Fixture 位于 `test/fixtures/magnetic-intake/multi-image-color-contract.json`，保存原始颜色名称和未改动的 23 个 Observation，而不是一份修正后的模型输出。

单图 Prompt SHA256 保持原值：2D `4ade9875…ee8fb`；Visible 3D `d9cfbad8…9366`。回归也检查单图 / Planning 请求格式、合法大小写 Hex、不合法名称 / 模糊颜色 / 缩写 / alpha / 换行，以及最终 HTTP Body 的严格 Schema。HTTP 测试在发送前拦截，不访问付费模型。

## 实际测试结果

| 检查 | 结果 |
|---|---|
| 新增颜色契约 Node 测试 | 6/6 通过 |
| 全部 Magnetic Node 回归 | 192/192 通过，包含上述 6 项 |
| 3D Engine / Viewer / Editor / Tutorial 等 Vitest 回归 | 20 个文件、216/216 通过 |
| TypeScript 与生产构建 | `npm run build` 通过；独立 3D 类型检查通过 |
| 多图 UI 浏览器回归 | 通过；实际 car 四张图片资源 + 离线 Provider Fixture，不是真实模型识别准确率测试 |
| Analysis Trace 浏览器回归 | 通过；原始失败 Trace 可关闭、重开、刷新及切换阶段恢复，宽度 1650 / 1100 / 680 下入口正常 |
| 全项目 Node `test/*.test.mjs` | 979 项中 968 通过、11 失败；未宣称全量通过 |
| 原始文件与差异检查 | Trace / Request / Response / Source 字节不变；`git diff --check` 通过 |

全项目 Node 的 11 项失败均属于既有 Brick / DUPLO 测试（含缺少 `BRICK_GAME_ARTIFACT` 配置、旧几何 / 映射 / Prompt / 模型断言）。在当前 HEAD `c73111fdb272b8a7d438f3114968f87310865c27` 的独立只读源码副本上重跑对应 9 个测试文件，11 项全部复现；该副本因未携带工作目录的忽略资源，另有 1 项映射测试失败。本轮没有更改这些模块来扩大修复范围。

本轮新增真实模型调用 **0 次**，新增模型费用 / Token Usage 为 0；浏览器测试只写隔离临时目录，不覆盖生产历史。没有验证新 Schema 的真实供应商在线接受情况，也没有评估新 Prompt 的实际颜色或跨图识别准确率。

## 历史与正式使用边界

原始 Trace 仍为 invalid_plan，SHA256 为 `5c56c593dad449794eb816422d626dacb64d9ef1eafe120f7bab021c79a8cf41`。原始实际 Request / Response 和 Source 文件均未覆盖。没有创建或推进当前案例的正式 Recognition / Review / Geometry / Assembly。

测试占位色副本即使契约通过，也不能作为实际颜色的模型输出。若复用现有识别内容进入正式流程，仍需要用户明确确认实际颜色并使用标记清楚的人工修正入口；本轮不自动执行。也可在开发服务更新后，用户手动发起一次新的四图 Analysis，检查 Trace 中新版本、`json_schema` / `strict:true` 和所有 `#RRGGBB` 值，再按现有流程 Review。新 Prompt 的真实模型输出尚未在线评估。
