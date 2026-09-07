# Gemini Developer API 官方图片 baseline

第二阶段已完成：`gemini-baseline.html` 现在承载 Ring Detection；原官方示例完整保留在
`gemini-official.html`，原 GET/POST `/api/gemini-baseline` 接口仍保留。
迁移与双圈真实验证见 [gemini-rings.md](./gemini-rings.md)。

本阶段仅验证 API Key → Files API 图片上传 → generateContent → 文字响应。
不包含 structured output 或 Ring Detection，不调用 Vertex。

## 官方来源

- Google 推荐的 SDK：https://ai.google.dev/gemini-api/docs/libraries
- baseline：https://ai.google.dev/api/generate-content#image 的 Node.js Image 示例。
- 对应源码： https://github.com/google-gemini/api-examples/blob/51979868abf95d062a149b62af92854b2a24f005/javascript/text_generation.js 中的 `textGenMultimodalOneImagePrompt`。
- 图片：https://github.com/google-gemini/api-examples/blob/51979868abf95d062a149b62af92854b2a24f005/third_party/organ.jpg
- 模型：https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash

核对日期：2026-09-07。使用官方 `@google/genai` SDK（锁定 2.21.0）。
保留示例的 `gemini-3.7-flash`、`Tell me about this instrument`、`organ.jpg`、
`files.upload`、`createUserContent`、`createPartFromUri` 和 `models.generateContent`。
没有自定义 generationConfig / response schema，没有模型自动回退。

相对官方示例的适配只有：本地图片路径、HTTP/UI 包装、缺 Key 检查、显式
`vertexai: false`、请求超时、调用结束删除本次上传文件。
SDK 报错只返回阶段和 HTTP 状态，避免泄漏请求配置。
本地样例图片和上游许可证位于 `public/gemini-baseline/`；上游
`third_party/LICENSE.txt` 原样保留，其中没有单独列出 organ.jpg 的许可说明。

当前图片理解指南的部分示例使用 Interactions API；这里特意选择官方 API
参考中的 generateContent 示例，以满足本阶段目标。Structured output 是另一示例，
留待这个最小图片 baseline 实测通过后再加。

## 配置与启动

在项目根目录 `.env` 中配置真实的 `GEMINI_API_KEY`（不要使用 VITE_ 前缀，
不要提交密钥）。可在 https://aistudio.google.com/apikey 创建。
此 baseline 不读取 ADC、GOOGLE_API_KEY、project 或 location。
修改 `.env` 后重启服务。

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
fuser -k 5189/tcp
PORT=5189 HOST=127.0.0.1 npm run dev
```

端口空闲时 fuser 返回非零是正常的；执行完仍继续启动。
必须使用 Node 服务 `npm run dev`，直接启动 Vite 只能提供页面，无法执行 API。

打开 http://localhost:5189/story-voice-test-audio/gemini-official.html 。

## 验证

1. 页面显示固定的 organ.jpg、prompt 和模型；配置检查只返回 Key 是否存在。
2. 点击“运行官方图片示例”。每次点击会上传该图片并进行一次真实模型调用。
3. 确认页面显示“真实调用成功”，文字正确描述图中的管风琴；展开调用信息，
   检查 `ok: true`、`finishReason: STOP`、`modelVersion` 与 token usage。
4. `ok: true` 仅说明模型正常返回非空文字，图片描述是否正确仍需人工确认。
   没有实际响应前不能宣称真实调用成功。

接口可单独验证：

```bash
curl -sS http://127.0.0.1:5189/api/gemini-baseline
curl -sS -X POST http://127.0.0.1:5189/api/gemini-baseline
```

GET 不调用 Google；POST 使用固定官方图片，不接收用户图片或 prompt。
缺 Key 返回 503；上游失败返回 502 和失败阶段；空输出或非 STOP 会返回 `ok: false`。
UI 展示的 JSON 是本地调用信息，不是 structured JSON 模型输出。

本地验证命令：`npm run build`、`node --test test/gemini-baseline.test.mjs`。
后者拦截真实 SDK 的 HTTP 请求，验证 Developer API 域名、API Key 请求头、官方图片
字节、prompt、无 schema、错误脱敏和文件清理；这是 mock 测试，不代表 Google 实调成功。

第一阶段初次交付时构建与 4 个测试通过，尚缺 Key；用户随后确认官方 baseline 实调成功。
第二阶段发现 Key 位于运行中的 Node 服务进程环境；沿用该环境重启后，新 Ring 页面已通过
无头 Chrome 完成真实调用、双圈识别、overlay 与交互验证（详情见 gemini-rings.md）。

## 后续阶段

inlineData + 原 ringSchema 的迁移已在新页面完成。旧 Vertex 实现仍保留，等待用户决定
是否删除。Cloud TTS 的 ADC 与 RingFeet/OpenCV 不属于该迁移。
