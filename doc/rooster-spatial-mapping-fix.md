# 公鸡 Spatial Planning Mapping 修复

## 根本原因

报错 `正式 Mapping 不可用：4066` 并不意味着找不到 4066 的零件映射。

原 UI 调用 `games.review()`，它使用 Generator 的执行资格检查：只有支持色板中的颜色、有审核 Geometry Profile 的零件才能形成 target。公鸡的 `4066 / RB 70` 已找到 **4066a**，本地文件和共享几何正常，但 Reddish Brown 不在 Generator 的六色色板中，整行 target 被置空。Spatial 层随后仅显示型号，遗漏了实际颜色错误。

黄色骆驼使用相同官方映射 `rb_part_mappings`（4066 的唯一 export ID 是 4066a），且颜色 14 在执行色板内，所有零件均有已审核 Profile，因此通过。原实验从保存的正式 Mapping review 读取；UI 原先重新调用的 games.review 将“规划所需的身份信息”和“Generator 可执行范围”混为一项要求。

公鸡还存在两个之前被首条错误遮蔽的条件：

- RB Black 0 的官方 LDraw 记录是 0 / Black 和 256 / Rubber_Black，原检查把二者视为未解决歧义。
- RB 2302 的正式 export ID 是 LDraw 2302，本地文件存在；但共享 Catalog 没有经审核的 2302 Geometry Profile。

## 修复策略

新增通用 Spatial 身份解析器，继续复用现有 Application Server 官方元数据接口、`inspectBrickModel`、本地 `LDConfig.ldr`、共享 `geometrySupport`；不维护任何公鸡专用型号表。

- 零件只能从 `rb_part_mappings` 中选择唯一官方 export ID；若没有 export 标记，必须只有一个官方 ID。多义、不在已知颜色组合内、本地文件/依赖缺失均报错。
- 颜色必须来自官方 LDraw 外部 ID，且存在于本地 LDConfig。多种材质时仅使用官方描述与官方颜色名严格一致的唯一项（Black→Black，不选 Rubber_Black）；仍歧义则拒绝，不按 RGB 或数字相似性猜测。
- 已有共享几何直接复用，并核对来源文件 SHA256。损坏或变化的已审核数据不能降级为未知后继续使用。
- 没有审核 Profile 的零件在规划请求中明确保存 `geometry:null`、`dimensionsMm:null`、缺失原因；要求模型保留未知接口并报告 missingGeometry。没有生成替代碰撞体或估算接口。原严格实验输入路径保持默认拒绝未知几何；这是显式规划模式，不是旧 Schema fallback。
- Generator V3 和 Geometry Execution 的原校验未放宽。准备请求不等于 Geometry Valid。
- Mapping 失败现在显示 RB 型号、颜色 ID 和具体原因。
- UI 新增「检查 Mapping 并准备请求（不调用 LLM）」；与真实生成共用准备路径，但调用现有 runner 的 `execute:false`，无需 API Key、没有 Provider 请求。
- Trace 的 sources 保存完整本次 Mapping review 及选择依据；历史 Analysis/Review、库存均不修改。

## 真实公鸡 UI 验证

Analysis `848fe628-5766-4f8c-8f73-5cf9235ef76d`，生成的准备记录：

`generated/brick-spatial-traces/829992e5-7b9f-417c-a20f-43621f32f2cb.json`

|Observation|LDraw Part|LDraw Color|共享几何|
|---|---|---|---|
|red_top|3437|4|已审核|
|yellow_front|3437|14|已审核|
|brown_upright|4066a|70|已审核|
|orange_middle|3437|70|已审核|
|black_middle|3437|0|已审核|
|black_upper|3437|0|已审核|
|dark_lower|3437|0|已审核|
|brown_lower|3437|70|已审核|
|orange_base|2302|25|缺少 Profile，明确为未知|

通过真实 Chromium UI 点击准备，9/9 保留，全部正式 Mapping rows 无错误；得到包含照片、输入实例和输出合同的 gpt-6.1-sol 请求。状态 `prepared`、`parseStatus:not_run`、`rawOutput:null`。刷新后恢复。浏览器只 POST `/api/brick-spatial/prepare`，没有 `/plan` 或付费 LLM 请求，因此没有模型 Token Usage 或原始 Provider Response。

公鸡与骆驼原始 Analysis/Review 四个文件 SHA256 前后相同。

入口（本轮验证服务 5180）：

<http://127.0.0.1:5180/story-voice-test-audio/brick-test.html?workflow=spatial&analysisId=848fe628-5766-4f8c-8f73-5cf9235ef76d&spatialPlanId=829992e5-7b9f-417c-a20f-43621f32f2cb>

旧的 5173 Node 服务若未重启仍加载旧服务端代码；重启其 `npm run dev` 后可使用新路径。

证据：`output/rooster-mapping-fix/acceptance.json`、`prepared.png`、`tests.log`、`build.log`。

## 测试和文件

63 项通过，TypeScript / Vite 构建通过：

```sh
node --test test/brick-spatial-mapping.test.mjs test/brick-spatial-workflow.test.mjs test/brick-spatial-planning.test.mjs test/brick-geometry-execution.test.mjs test/brick-mapping.test.mjs test/brick-generator.test.mjs
npm run build
```

包括：官方导出身份解析、普通黑/橡胶黑明确区分、歧义拒绝、本地资源和 SHA 校验、缺失 Profile 保留未知、prepare-only 不调用 Provider、骆驼 512 候选回归、Generator 原规则回归。

新增 `server/brick-spatial-mapping.mjs`、`test/brick-spatial-mapping.test.mjs`、本文档。
修改 `server/brick-spatial-workflow.mjs`、`experiments/spatial-planning/input.mjs`、`src/brick-test/SpatialAssemblyPanel.tsx`、`test/brick-spatial-workflow.test.mjs`。

## 尚存边界

已验证的是 **9 块积木能够准备合法的 Spatial Planning 请求**，没有验证新的 LLM 推理质量，也没有宣称公鸡几何可执行。后续 Geometry Execution 仍需为 2302 审核共享 Profile，并处理执行色板支持；当前会拒绝这些未支持项，不会静默改变原造型。此轮到请求准备为止，不扩展几何算法。
