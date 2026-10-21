# DUPLO Prototype V3 — AI Design Generator

## 模型选择与 MAX_TOKENS 调整（2026-10-20）

原生成配置为 `maxOutputTokens: 8192`，未设置 `thinkingConfig`。JSON Schema 限定 5–12 块和 5–12 步，字段为名称、位置、型号、颜色、旋转和指导；原始可见 JSON 不能代表全部生成 Token。Google 文档明确该上限包含推理与最终输出，因此模型可能在完成 JSON 前耗尽预算。用户报告的小桥请求约 41 秒返回 MAX_TOKENS，说明生成上限终止；不能把它当成网络超时或 Validator 错误。

本轮没有获得该次请求的 `usageMetadata`。项目原来只在浏览器内存保留诊断，检查项目 generated/data/doc 中的积木相关文件未找到这次记录。因此“推理消耗了多少、JSON 消耗了多少”尚不能确认，推理挤占预算是有依据的解释而非已测得的 Token 分解。若旧页面仍保留记录，可下载原诊断 JSON 查看 `thoughtsTokenCount`、`candidatesTokenCount` 和 `totalTokenCount`。

调整：

- Flash `gemini-3.6-flash`、Pro `gemini-3.1-pro-preview` 使用 `maxOutputTokens: 32768` 和 `thinkingConfig: {thinkingLevel: 'MEDIUM'}`。不同时设置 `thinkingBudget`，不关闭推理。两者官方输出上限均为 65536；32768 为本轮实验预算，不保证永不截断。MEDIUM 是相对推理力度，不是严格额度，不能保证为 JSON 硬性预留指定 Token。
- DUPLO 请求通过同一客户端的请求级 `httpOptions` 设置 180 秒超时、`attempts: 1`；页面等待 195 秒。共享客户端及其他功能配置未改。
- Schema、Prompt、库存规则、V2 算法及 Viewer 不变，方便相同输入比较模型。未增加“小桥”模板或语义后处理。
- 模型列表采用项目 `gemini-rings.mjs` 已有的上述两个 ID，并通过官方模型文档核对。未使用账户凭据执行模型发现或生成；Pro 是否对当前 Key 开放、配额和实际延迟需手动验证。
- `DUPLO_LLM_MODEL` 仍决定默认选项，页面所选 `model` 随 POST 提交。未知客户端模型返回 400 且不发起生成；显式配置的自定义服务端默认模型也会列出，它保留服务商默认推理设置，不假设支持 MEDIUM。
- 结果展示请求模型、实际 `modelVersion`、服务端耗时、输入/推理/输出/总 Token、结束原因与预算。未返回的统计显示“未返回”，不假造零。诊断 JSON 另保留完整 usageMetadata、responseId、finishMessage、generationSettings、原始文本和 Validator 报告。
- 非 STOP 结果仍拒绝应用，即使部分 JSON 看似可解析；不自动重试、续写或换模型。

官方依据：[Flash 型号与限制](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)、[Pro 型号与限制](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview)、[推理与输出共用预算](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[Pro 的推理级别](https://ai.google.dev/gemini-api/docs/gemini-3)。本地已安装 SDK 的 `ThinkingConfig`、`GenerateContentConfig.httpOptions` 类型也已阅读核对。

### Flash / Pro 小桥对比验收

1. 用户重启 `npm run dev` 并打开 `/brick-test`。沿用同一份库存，描述固定为例如“设计一座容易辨认的小桥，有桥墩、桥面和桥面下方留空；使用库存中的 5–12 块积木，给出简短搭建指导”。
2. 选 Flash，手动点击一次 Generate。保存该次诊断，记录结束原因、Validator、耗时、四类 Token，以及桥墩/桥面/留空是否可辨认。
3. 不修改库存和描述，仅选择 Pro，再手动点击一次。分别下载两次记录；历史列表显示请求模型，便于切换。对每个成功设计查看完整场景和搭建步骤，不只比较名称。
4. Network 中每次 Generate 应恰好一次 POST；页面加载、刷新配置和步骤查看不调用生成。MAX_TOKENS、权限失败或非法设计应保留原场景，无自动切换或补救请求。
5. **保留规则带来的限制**：先放两个互不连接的地面桥墩、最后架桥面的传统顺序会在第二步被拒绝；本轮不会为桥放宽每个前缀连通的规则。最终 Valid 只证明现有几何/库存/顺序规则成立，不证明造型真的像桥或下方留空足够，这些需人工查看。

本轮仅写代码与模拟测试，没有执行命令、测试、构建或真实 LLM 请求。新增测试覆盖两种模型路由、预算/推理级别、非法模型零调用、截断时诊断保留和无重试、缺失统计处理。用户可手动执行 `npm run test:brick-generator` 和 `npm run build`；尚无 Flash/Pro 实测对比结论。

V3 在现有 Test Audio 服务和 `/brick-test` 上增加 Gemini 自由设计。V1 的真实 LDraw Viewer、V2 的连接算法保持复用；没有新增客户端 SDK、服务、数据库或依赖。V1/V2 已由用户人工验收；本次 V3 只开发代码、测试和文档，未执行任何命令、构建、测试、服务或真实模型请求。

## 用户启动

在现有项目 `.env` 中沿用 `GEMINI_API_KEY`，可独立设置：

```dotenv
DUPLO_LLM_MODEL=gemini-3.6-flash
```

未设置时默认 `gemini-3.6-flash`，沿用项目现有 Gemini 模型选择。模型权限、当前可用性和输出质量本轮未通过真实请求验证。修改环境变量后需重启服务；不会影响其他功能的模型变量。

由用户手动执行：

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
npm run dev
```

访问 `http://localhost:5173/brick-test`（端口以现有 `PORT` 配置为准），仍由原页面别名跳转。**V3 使用 `npm run dev`，不是 `dev:brick`**；后者只启动 Vite，不提供生成 API。依赖沿用当前安装，无新增包。LDraw 路径和 `LDRAW_LIBRARY_PATH` 仍沿用 V1。

由用户选择运行以下检查；新测试全部模拟模型，不访问 Gemini：

```bash
npm run test:brick-generator
npm run test:brick
npm run build
```

建议沿用支持当前 Vite 的 Node 22.18+。服务端先原生加载 TypeScript；不支持 `.ts` 的 Node 通过现有 `typescript` 开发依赖在内存中转换 `catalog.ts`、`assembly.ts`，无子进程、无临时文件、无另一份连接算法。此兼容层只解决规则加载，不改变项目自身的 Node/Vite 版本要求。

## 数据流与接口

`虚拟库存 + 描述 → server.mjs → gemini-client.mjs → JSON → 同一份 V2 Validator → Viewer`

- `GET /api/brick-test/generate`：仅返回配置模型、Key 是否配置、限制和 Prompt 版本；不返回 Key，不调用模型。
- `POST /api/brick-test/generate`：描述 1–500 字，库存为 `{part,color,quantity}[]`。型号/颜色必须来自共享 catalog，每项整数 0–100，同型号颜色不可重复，总库存 5–100。
- `server/brick-generator.mjs` 通过原 `createGeminiClient()` 发起一次 `models.generateContent`，使用独立模型变量、system instruction、`responseMimeType: application/json` 和 `responseSchema`。原客户端的 `retryOptions.attempts: 1` 禁用 SDK 重试。没有修复请求、模板、删砖、坐标修正或自动重试。
- 成功 200：`ok/model/modelVersion/promptVersion/rawOutput/finishReason/usageMetadata/validation/design/elapsedMs`。设计校验失败或非 JSON 为 422，模型请求或未完成为 502，配置/规则加载失败为 503，输入错误为 400。无效设计不会带成功的 `design`，但保留原始可见文本及验证报告。
- `model` 是请求模型，`modelVersion` 是服务返回版本；没有返回版本时明确显示“未返回”。不把配置名伪称为已确认的服务版本。

输出 Schema 的核心结构：

```ts
{
  name: string,
  bricks: Array<{
    id: string, part: '3437' | '3011' | '2300',
    color: '4' | '1' | '14' | '2' | '15' | '0',
    x: number, z: number, layer: number,
    rotation: 0 | 90 | 180 | 270
  }>,
  steps: Array<{ brickId: string, instruction: string }>
}
```

Prompt 明确库存、整数中心网格、旋转、占位、上下层接合、逐步连通、数量/高度/支撑限制，并要求简短中文名称和指导。用户描述作为任务数据，不作为修改规则的权限。没有固定造型示例或模板。模型自行设计，服务端验证是最终准入条件。

## 几何与基础难度规则

尺寸、单位及接合依据沿用 [V2 说明](./brick-test.md)：凸点间距 40 LDU / 16 mm，砖体层高 48 LDU / 19.2 mm，中心 X/Z 为整数，底部 layer 非负，正放且仅直角旋转。3437、3011、2300 的 X×Z 分别为 2×2、4×2、6×2，90/270° 交换宽深。

V3 直接调用 `assembly.ts` 的 `validateAssembly` 和 `footprint`：完整组合及搭建顺序的每个前缀均需通过占位冲突、下方支持和连接图校验。仅侧面、边界、共同地面接触都不算连接。步骤必须覆盖所有 ID、每块恰好一次；不会排序、跳过或补齐错误步骤。

附加应用限制：5–12 块，中心 X/Z 在 ±6 内，底部 layer 0–3（最多四层砖体），名称最多 80 字，单步指导最多 180 字。每个上层砖放置时，从 V2 `connections` 累计其下方接合点，至少覆盖该砖 `footprint` 的一半。该比例是保守的产品约束，不是经实验得出的稳定阈值。库存按型号+颜色精确计数，不自动扣减下一次设计的库存。

所有前缀要求单连通意味着先放两个独立地面支座、最后架桥的顺序会失败，即使最终结构在 V2 合法。这是本版简化搭建过程的明确限制。

## 页面行为与诊断

- 可编辑 3 型号 × 6 颜色库存和描述；Generate 运行中禁用重复提交和手动修改场景。
- 验证成功后以现有 `BrickViewer.replace` 加载整套真实模型。几何通过但资源加载失败时明确报错，不造替代模型，不提交部分造型。
- “从空场景开始 / 上一步 / 下一步 / 显示完整造型 / 查看第 N 步”直接使用返回的 steps，不调用模型。当前 Brick 清单对应当前可见前缀，库存消耗表对应完整设计。
- 查看 AI 设计时隐藏手动候选和预览。返回手动编辑、Reset、阶梯示例继续可用；旋转、缩放、平移不变。
- 每次结果保留在本页生成历史，包括请求库存快照、原始可见输出、模型版本、逐步验证和错误。可以下载完整诊断 JSON；**刷新后内存记录消失，没有服务端持久化**。网络中断/浏览器等待超时时，客户端可能拿不到服务端已产生的输出，不会自动发第二次请求。

## 人工验收

1. 启动现有服务，打开页面。应显示配置模型和 Key 状态；只打开页面或刷新模型配置不产生模型生成请求。
2. 使用默认库存填写简单动物/交通工具描述，点一次 Generate。Network 应仅有一次 POST。验证成功后显示名称、真实砖体、使用模型、库存消耗和 Valid；若失败则保留之前场景并展示原因及原始输出。
3. 成功结果从空场景逐步前进/后退；每步清单与返回 brickId 对应，最后与完整设计一致，不新增 POST。
4. 将一个颜色库存改为 0，再独立生成：成功结果不得消费该颜色。库存总量不足 5 时按钮禁用，接口也应拒绝；错误设计不能被自动修成成功。
5. 查看和下载诊断，核对原始输出、库存快照、完整及每步验证。切换历史结果后需明确点击显示，不能把历史验证状态误认为当前场景已切换。
6. 在服务端临时设置一个无权限或不存在的模型并重启：应明确失败且不重试；恢复环境配置后再验收。缺少 Key 时界面显示缺失，Generate 禁用。
7. 阻止 LDraw 资源并刷新以避免模型缓存掩盖错误：只能出现真实加载失败，无占位积木。成功生成但显示失败后可重新显示已有结果，无需再次调用模型。
8. 返回手动编辑，回归候选吸附、非法位置拒绝、阶梯示例、Reset、相机控制。逐步加载期间 Reset 后不得恢复旧结果。

## 本轮验证范围

已写 `test/brick-generator.test.mjs`：共享规则加载兼容、合法输出原样返回、库存及字段错误、碰撞/悬空、顺序/覆盖错误、基础支撑限制、JSON/截断/安全拒绝、配置和模型异常、单次调用及无修复重试。测试夹具只在测试中存在。

仅完成静态阅读检查，**以上测试未运行**，TypeScript 构建、浏览器交互、模型 Schema 接受情况、真实生成成功率及造型可辨识性均未经本轮运行验证。规则不判断名称是否匹配造型、指导语义是否完全正确，也不模拟摩擦、重心、承重、装配运动路径或抗倾倒；3–6 岁适用性仍需成人检查与实体搭建验收。
