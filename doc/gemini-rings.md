# Gemini API Key Ring Detection

## 页面与调用链

新页面：http://localhost:5189/story-voice-test-audio/gemini-baseline.html

`gemini-baseline.html` → 共用 `src/ring-llm.ts` 上传/绘图 →
`POST /api/gemini-baseline/rings/detect` → `server/gemini-rings.mjs` →
`server/gemini-client.mjs` → `@google/genai` 的 `models.generateContent` →
`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`。

客户端显式使用 `GEMINI_API_KEY`、`vertexai: false`，90 秒超时、不重试；
不读取 ADC、Cloud project/location，不自动回退 Vertex 或其他模型。
GET `/api/gemini-baseline/rings/models` 提供默认模型、label/id 和 Key 是否已配置。
默认 `gemini-3.6-flash`，可通过服务端 `GEMINI_RING_MODEL` 覆盖。
模型列表保留旧版的 2.5 Flash、3.5–3.8 Flash、3.1 Pro Preview。
官方模型文档：https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
SDK 与 schema 参数参考：https://ai.google.dev/api/generate-content

旧页面 `ring-llm.html` 与 `/api/ring-llm/*` 继续保留。官方管风琴示例移到
`gemini-official.html`，其接口 `/api/gemini-baseline` 未变。

## 保留的业务行为

- 原 prompt、尺寸提示、responseSchema、geometry validation 按原样复用。
- `id / center / bbox / polygon / colorGuess / confidence / explanation` 全部保留。
- 同一 canvas 显示并编码 JPEG（最长边不超过 2000）、相同归一化坐标映射。
- 原 bbox/center/polygon overlay、显示开关、网格、点击坐标诊断、raw JSON。
- STOP 检查、排除 thought 文本、无圈、无效 JSON、几何错误处理保持一致。
- 只将 Vertex 请求参数 `generationConfig` 放入 SDK 的 `config`；增加响应
  `modelVersion` 供实测核对，其余返回字段保持兼容。

为保留旧实现作为对照，服务端业务片段暂时复制到新模块，测试断言 prompt/schema/
校验片段与旧实现逐字一致；新模块不会 import 旧 Vertex 模块。
前端直接共用旧 TS、CSS 和坐标模块，仅用页面 `data-ring-api` 选择新接口。
Cloud TTS、RingFeet、OpenCV 未改动。

## 启动

在根目录 `.env` 设置 `GEMINI_API_KEY`，或在启动进程的环境中配置。
本次沿用了既有 Node 服务进程的 Key 环境，没有输出密钥或写入文件。

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
fuser -k 5189/tcp
PORT=5189 HOST=127.0.0.1 npm run dev
```

直接运行 Vite 不提供模型 API。端口空闲时 fuser 非零退出是正常的，继续执行启动命令。

## 实际验证（2026-09-07）

通过本地无头 Chrome 操作新页面的文件上传、模型选择和检测按钮，没有绕过页面直接构造
正样本请求。未使用 mock 返回值。请求实际 model 与响应 modelVersion 均为
`gemini-3.6-flash`，UI label 是 `Gemini 3.6 Flash`。

双圈原图：`/home/umi/Downloads/29c4779e-44fa-478f-a843-01ec3348903b.png`，971×756。
使用未加红线的截图；没有将另一个红线标注参考图发送给模型。
HTTP 200，页面耗时约 11.3 秒，检测 2 个圈：

| ID | 颜色 | center (x,y) | bbox (xMin,yMin,xMax,yMax) | polygon |
| --- | --- | --- | --- | --- |
| ring-1 | gray-blue | (0.401,0.415) | (0.308,0.352,0.491,0.479) | 8 点 |
| ring-2 | black | (0.597,0.447) | (0.501,0.392,0.695,0.503) | 8 点 |

两圈 confidence 都为 0.95（模型自评）。所有字段和归一化校验通过。
人工检查页面截图：bbox 包围对应圈，中心点落在开口内，polygon 画回各自轮廓，
没有整体偏移、宽高轴混用或重复 DPR 缩放。8 点 polygon 是近似轮廓，非像素级分割。
另以官方 organ.jpg 作为无圈负样本：真实请求 HTTP 200、`rings: []`，约 2.7 秒。

浏览器自动检查通过：模型 label/id、raw JSON、raster 映射、overlay 开关、网格开关、
点击坐标、390px 窄屏缩放后 normalized geometry 不变；无页面 JS 错误。

本地证据（位于已忽略的 generated/，不提交场景图片/响应）：

- `generated/gemini-ring-verification/two-rings-response.json`
- `generated/gemini-ring-verification/two-rings-overlay.png`
- `generated/gemini-ring-verification/two-rings-mobile.png`
- `generated/gemini-ring-verification/browser-checks.json`

`npm run build` 通过；`node --test test/gemini-baseline.test.mjs test/gemini-rings.test.mjs`
共 15 项通过。这些单元测试 mock HTTP，覆盖 schema/字段保持、错误输出、鉴权脱敏、
缺 Key、model ID 和显式 Developer API（即便环境设置 Cloud 标志）；与上述实调证据分开。

本次功能覆盖未发现退化；未重新运行 Vertex 做相同输入的 A/B 测试，因此不宣称模型
准确率或延迟优于旧版。新页面是新入口，旧书签仍会使用旧 Vertex 接口。

## 下一步可清理的旧实现（本次未删除）

用户决定正式切换后，可以删除旧 `server/ring-llm.mjs`、`/api/ring-llm/*` 路由与 import、
旧 `ring-llm.html` 和对应 Vite entry，去掉旧 RING_LLM_MODEL 的支持；同时调整暂时引用
旧源文件的 parity 测试。

`src/ring-llm.ts`、`src/ring-llm.css`、`src/ring-llm-coordinates.ts` 已是共用业务文件，
不能随旧页删除。可在之后单独重命名。

package.json 的 `google-auth-library` 直接依赖在旧 Vertex 模块删除后可以移除；但它仍是
Cloud TTS 和官方 @google/genai 的间接依赖。SDK 包含 Cloud 能力不等于新 route 使用 ADC。
Cloud TTS 使用的 Google 凭据/项目环境配置必须保留，不在此清理范围内。
