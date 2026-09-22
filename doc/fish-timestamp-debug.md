# Fish timestamp 独立调试页

启动（一整行，先释放两个端口）：

```bash
fuser -k 5173/tcp; fuser -k 24678/tcp; cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run dev
```

访问 http://localhost:5173/story-voice-test-audio/fish-timestamp-debug.html 。默认文本“到了狸猫叔叔家。狸猫叔叔说：”。点击 Generate with Timestamp，等待生成完成；音频播放器可播放完整结果。表格显示 segment text、字符数、local start/end、chunk seq/offset、global start/end（秒）。点击行或聚焦后 Enter/空格，从 global start 播放，继续播放后续音频，不做切片或自动停止。展开原始记录查看逐 SSE event 和各 chunk 最终快照；下载 JSON 不含音频 base64 或 credential。

后端 `/api/debug/fish-timestamp` 接收 `{text}`，使用现有 `FISH_AUDIO_API_KEY`、`FISH_AUDIO_MODEL_ID`（reference_id）与 `fishModel`（s2.1-pro-free）。直接 fetch 官方 `POST https://api.fish.audio/v1/tts/stream/with-timestamp`，请求 JSON，format=mp3。普通 Fish SDK 流程未修改。限制输入 8000 UTF-8 bytes、120 秒超时，debug 响应上限 32 MiB。生成在后端收齐后一次返回页面，无自动重试。

SSE 按流式 UTF-8 解码、行/空行分帧，支持 CRLF/LF/CR、跨网络 chunk、多 data 行和注释。每个 audio_base64 解码后按事件顺序拼接；null 或重复 alignment 不影响音频收集。保留每个 event 的已知 alignment 字段（音频改记 audio_bytes），同一 chunk_seq 的非 null 快照覆盖旧快照，null 不清除已有结果；空音频事件仍可更新 alignment。

官方语义：segment start/end 是 chunk-local 秒数，global = local + chunk_audio_offset_sec，仅相加一次。不将网络 chunk 当句子，不用总时长均分，不按音频容器时长重新缩放 alignment。来源：https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech-stream-with-timestamps

## 本次真实实验

通过本地新增 HTTP handler 实际请求默认文本成功：HTTP 200，6 SSE events，1 text chunk（seq=0、offset=0），最终 12 segments；所有 segment 为单个汉字，句号/冒号无独立 segment。快照字符数依次为 2、5、7、11、12、12，最后两个不应相加。

| text | global start | global end |
|---|---:|---:|
| 到 | 0 | 0.08 |
| 了 | 0.08 | 0.16 |
| 狸 | 0.24 | 0.40 |
| 猫 | 0.40 | 0.56 |
| 叔 | 0.56 | 0.72 |
| 叔 | 0.72 | 0.88 |
| 家 | 0.88 | 1.20 |
| 狸 | 1.84 | 2.00 |
| 猫 | 2.00 | 2.16 |
| 叔 | 2.16 | 2.32 |
| 叔 | 2.32 | 2.48 |
| 说 | 2.48 | 2.80 |

本次 49,318-byte MP3 完整 FFmpeg 解码通过，44.1kHz mono。alignment.audio_duration=3.01859410430839s；ffprobe 文件时长=3.082375s，两者约差 64ms。原因未确认，不擅自进行 offset 补偿。结果保存在 `generated/debug/fish-timestamp/default-alignment.json` 与 `default-response.mp3`；页面后续生成不自动修改这些实验文件，使用下载按钮自行保存。

该短样本证明本次返回单字级，不证明所有中文/中英混合文本均单字，也不证明模型内部 token 粒度。长文本多 chunk 的 local→global 依据官方契约；本次真实短句 offset 为 0，非零 offset 与最后快照覆盖行为由合成测试验证。

测试：`node --test test/fish-timestamp-debug.test.mjs test/fish-tts.test.mjs`（8 项通过）；`npm run build` 通过；页面 HTTP 200、空文本 HTTP 400、错误 method HTTP 405。当前 Browser 无可连接实例，未自动验证浏览器播放、行点击 seek 或主观 timing 精度。

人工验收：先生成默认句子，核对 12 个汉字各行（每次生成时间可变）；点击第一/第二个“狸”、两组“叔”以及“说”听是否落在对应音节附近。再测试不同文本和长段落，查看 seq>0 时 local/global 差值是否等于 offset、是否有缺失 alignment、标点或多字 segment。该工具仅提供原始时间观察，不保证逐字定位精度。

## 生成语速 Speed

页面增加 Speed 选择：1.0（默认）、0.9、0.8、0.7。改变后点击 Generate，发起一次新的生成，清除旧音频/alignment。后端将 numeric speed 放入官方请求的 `prosody: { speed }`；官方 OpenAPI `ProsodyControl.speed` 说明允许 0.5–2.0。服务端校验范围；省略时默认 1.0。结果区与下载 JSON 记录本次提交的 speed。没有修改 playbackRate、SSE/alignment 解析或 offset 换算，没有补偿/padding。

官方参数来源：https://docs.fish.audio/api-reference/openapi.json （timestamp request 引用 ProsodyControl）。

真实对比（默认中文，两次独立请求，均 HTTP 200，MP3 完整解码通过）：

| speed | ffprobe 音频总时长 s | alignment.audio_duration s | segments |
|---|---:|---:|---|
| 1.0 | 3.082375 | 3.01859410430839 | 12，全部单汉字 |
| 0.8 | 3.552563 | 3.4849433106575964 | 12，全部单汉字 |

均为一个 chunk、offset=0；逐条校验 global=local+offset、end 不超过音频总时长。0.8 音频比 1.0 长约 15.3%，减速方向合理；两次独立生成存在自然波动，不应要求比例精确为 1.25。没有重新缩放 API timestamps。该测试确认减速请求可生成可用逐字时间数据，未确认主观音节清晰度或 seek 听感改善。

本次 JSON、MP3 和汇总保存于 `generated/debug/fish-timestamp/speed-comparison/`。页面手测：分别选择 1.0、0.8 并重新生成，核对结果区 speed，点击两组“狸猫叔叔”与“说”试听比较。现有 8 项相关测试和 build 通过；非法 speed（0.4、2.1、字符串、null）均 HTTP 400。
