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

## Clean alignment 与手动片段导出

生成后新增 Download Clean Alignment / Download Full Audio。完整 clean JSON 仅含：

```json
{"text":"全文（含原标点）","speed":1,"model":"s2.1-pro-free","audio":"对应下载的MP3文件名.mp3","segments":[{"index":0,"text":"到","start":0,"end":0.08}],"duration":2.84725}
```

`segments` 取最终 `timeline` 的 global start/end，不保留 events/content/chunks 或中间快照，不改边界。index 按 alignment segment 顺序从 0 编号，不是含标点全文的字符偏移。完整音频 duration 使用播放器读出的时长；完整 JSON 与音频的下载文件名配对。原始 Debug JSON 下载和原始记录继续保留。输入为多字 segment 时保留原粒度，不拆字、不分词。

Start char / End char 下拉项带 index、文本、原时间，方便区分重复字。只能选择首尾均包含的连续范围，start index 必须 <= end index；同一字可单独导出。Selected range 实时显示拼接后的选中文字和原时间。无 alignment 的标点不提供选项。

点击 Export Selected Clip，服务端 `/api/debug/fish-timestamp/clip` 接收本次音频、clean JSON 和两个 index。边界严格为首 segment.start / 末 segment.end。FFmpeg 使用 `atrim=start=…:end=…,asetpts=PTS-STARTPTS` 解码后裁剪采样，仅对片段以 libmp3lame 128kbps 编码，不修改 TTS pipeline，不加 padding/fade、不做 forced alignment。输入/输出临时文件在处理结束后删除；不建立新的持久化存储系统。

导出完成后显示片段播放器、Download Clip MP3 和 Download Clip Alignment 两个下载链接，需分别点击保存。片段 JSON text 为所选 segment 文本拼接，index 重新从 0 编号，start/end 减去 clip start（小数最多 9 位以消除浮点减法尾差），duration=end-start。MP3 文件的容器时长可能包含编码延迟/尾部补齐，UI 单独显示该值，不据此拉伸 alignment。

### 本轮真实验证

使用默认句子、speed=1 重新生成，通过实际 HTTP clip handler 选择第一次“狸猫叔叔”（index 2–5），来源 0.24–0.88 秒。clip JSON：

```json
{
  "text": "狸猫叔叔",
  "speed": 1,
  "model": "s2.1-pro-free",
  "audio": "fish-selected-clip.mp3",
  "segments": [
    {"index": 0, "text": "狸", "start": 0, "end": 0.08},
    {"index": 1, "text": "猫", "start": 0.08, "end": 0.32},
    {"index": 2, "text": "叔", "start": 0.32, "end": 0.48},
    {"index": 3, "text": "叔", "start": 0.48, "end": 0.64}
  ],
  "duration": 0.64
}
```

解码后实际音频 0.640 秒，MP3 容器 0.679184 秒。与原音频精确对应区间的解码采样数一致、波形相关系数 0.999829，确认没有导出整句或错段；未进行主观试听。实际文件位于 `generated/debug/fish-timestamp/clean-clip-test/`：full.mp3、raw-debug.json、clean.json、fish-selected-clip.mp3、clip.json、verification.json。

11 项相关测试通过，覆盖 clean 字段、global 时间保留、连续范围、重复字、重编号、归零、非法范围以及原 SSE/Fish 功能；build 通过。真实反向范围请求 HTTP 400。当前 Browser 无可连接实例，页面 HTTP 与控件输出已检查，浏览器点击下载/播放需手测。

手工验收：重新生成 → 下载 raw 与 clean 对比（clean 无 events/content）→ 下载对应完整 MP3 → Start 选第一次“狸”、End 选其后第二个“叔” → 确认 Selected range 为“狸猫叔叔” → Export → 播放片段并下载 MP3/JSON → 核对首时间为 0、末时间等于截取区间时长。普通 Fish TTS、Storybook 和 Pipecat 均未修改。

## 服务器磁盘 History / Cache

`generated/fish-timestamp-history/<sha256-key>/` 每个条目包含：

- `metadata.json`：text、voice 指纹、model、speed、cache_key、created_at（UTC）、duration、服务器专用请求配置及文件校验和。不保存 API key；服务器保存原 reference_id 用于历史 Regenerate，API/UI 仅返回 voice 指纹。
- `audio.mp3`：完整音频。
- `alignment.json`：clean schema，audio 为 `audio.mp3`，duration 由服务器 ffprobe 测量，segments 来自最终 global timeline。
- `debug.json`：原始逐 event/chunk/timeline 调试数据，不重复保存 audio base64。

key=SHA-256(JSON.stringify(request))。request 由固定顺序字段构建：version、原样 text（包括空格和标点）、reference_id（voice）、model、numeric speed、format=mp3、timestamp endpoint。voice/model/speed/text 变化均产生新 key。以后添加影响生成的参数时扩展该对象或升级 version。

Generate with Timestamp 先校验服务器磁盘结果，有效则显示 `Loaded from history`，不调用 Fish；miss 才调用 Fish、写入文件并显示 `Generated from Fish Audio`。Regenerate 按钮强制重新请求并更新当前表单参数对应的条目。新结果生成/校验完成后才交换目录；生成失败保留旧有效结果。同 key 在一个 Node 服务进程内串行处理，并发普通 Generate 不重复调用 provider。此开发工具按现有单 Node 服务运行，不提供跨多进程锁。

History 显示最近 30 条有效记录的文本摘要、speed/model/voice/created time。Load 只读磁盘，即使服务端 API key 暂时不可用也无需请求 Fish；损坏条目 Load 返回清晰 404，可按表单 Generate 重新建立。History Regenerate 使用该条目原始 text/voice/model/speed，即便服务器当前 voice 配置已改变也不会误用新 voice。Refresh History 重新读目录，无 localStorage/IndexedDB。

读取会确认四个文件都存在、JSON 可解析、key/配置一致、音频非空，核对 audio/alignment/debug 的 SHA-256，并检查 clean alignment 与最终 debug timeline 一致。失败当作 miss，列表忽略损坏条目。没有自动历史清理策略；同 key 强制更新只替换该条目。

历史加载走同一展示函数，完整音频、raw/clean 下载、alignment 表、range selection、clip export 全部保留。导出的 clean/audio 文件名配对；下载时仅修改 clean 的 audio 文件名，不改时间。片段导出不调用 Fish。

### 本轮真实 A–E 验证

默认句子，真实服务端 HTTP 测试：

| 步骤 | 结果 | 累计 Fish 请求数 |
|---|---|---:|
| A 首次 speed 0.7 | generated；四个文件落盘；音频 4.101125s | 1 |
| B 相同请求 | history；音频字节和 clean JSON 完全一致 | 1 |
| C speed 0.8 | 不同 key，generated；两个条目分别 Load 成功 | 2 |
| D 原 0.7 Regenerate | generated；同 key，created_at 更新，后续 Load 为新结果 | 3 |
| E 从 history 截取首次“狸猫叔叔” | 有效时长 0.800s，片段解码通过，时间归零 | 3 |

证据：`generated/debug/fish-timestamp/history-test/verification.json`。终端每次尝试实际 provider 生成打印 `[fish-timestamp] FISH_REQUEST key=…`；命中为 `HIT`，历史 Load 为 `LOAD`。真实测试逐步检查 FISH_REQUEST 数量，第二次请求与 Load/clip 均没有增加。测试期间服务端日志为 `/tmp/fish-history-server.log`。

`node --test test/fish-timestamp-history.test.mjs test/fish-clean-alignment.test.mjs test/fish-timestamp-debug.test.mjs test/fish-tts.test.mjs` 共 12 项通过；覆盖新 store 实例的磁盘复用、并发请求去重、speed/voice/model key 区分、强制更新、失败保留旧条目、缺文件/音频损坏以及现有功能。`npm run build` 通过。Browser 无可连接实例，本轮没有自动完成浏览器按钮点击，需现场手测。

人工验收：在页面输入默认句子、speed=0.7，Generate（本环境已有测试缓存，应直接 Loaded from history）；再次 Generate 查看同样状态与日志 HIT。切换 0.8 查看另一个条目；在 History 点击两个 Load 检查文本/speed/表格更新。点击 0.7 条目的 Regenerate，确认 Generated from Fish Audio、created time 更新。Load 后选择字符导出片段，确认不出现新的 FISH_REQUEST。重启服务后再 Generate/Load，应继续读到磁盘缓存。
