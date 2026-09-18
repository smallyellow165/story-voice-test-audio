# Storybook marker baseline

Physical Storybook = Story 内容 + 作者 section + 外部导航。本轮仅改 Test Audio，未改 V4，没有另一套 PhysicalBook 内容或播放服务。

## V4 实际结构审计

以下路径均相对 `story-voice-pipecat-poc-v4/`。

| 位置 | 实际职责 |
|---|---|
| `server/data/stories/story.json` | 故事数组；必需字段 `id/title/characters/tags/age/summary/content`。正文叫 `content`，没有独立顶层 `text/narration`。 |
| `server/src/story_provider.py` — `normalize_story`, `normalize_items`, `NormalizedStory`, `CuratedStoryProvider` | Python 校验、懒加载并缓存故事；可选 `items/media/metadata`。`items` 是 narration 或 sound；narration 有 `text` 和可选 `audio.asset_id`；sound 有 `sound_id`。media/metadata 是透传字典。 |
| `server/src/story_control.py` — `_try_curated`, `start_story`, `stop_story`, `continue_story` | curated/generated 选择与控制；stop 清空 curated story，continue 并非精确媒体游标恢复；仍有当前 curated story 时是整篇 repeat。 |
| `server/src/story_library.py` — `StoryLibraryRuntime.select/narration/act`, `publish_story_result` | 保存选中故事、使用记录、revision/speech_epoch；有 items 时输出整个 items，否则构造标题+全文+提问的字符串。repeat 是整篇。summary/characters/discuss 是 grounded 操作，没有内容内 interaction 节点。 |
| `server/src/story_library_llm.py` — `bind_story`, `speak_story`, `_flush_story`, `story_context` | emit 接收输出并暂存，revision/epoch 检查后输出 frames；story_context 包含当前故事内容。结构化 items 经预处理后形成一次播放响应。 |
| `server/src/story_audio.py` — `prerecorded_frames`, `NarrationSemanticOutput`, `PlaybackResponseOutput` | Option A：asset_id 读取 `server/data/sounds/<asset_id>.mp3`、解码、生成音频与语义帧。语义输出位于 TTS 之后；response 输出边界位于 transport 之后（`server/bot.py`）。 |

实际链路：

```text
story.json → CuratedStoryProvider / normalize_story
→ story_control._try_curated → StoryLibraryRuntime.select/narration
→ publish_story_result → runtime.emit (bind_story 绑定 speak_story)
→ pending + _flush_story → TTS / prerecorded frames
→ NarrationSemanticOutput → transport.output → PlaybackResponseOutput
```

`story_009` 已表达 narration A（预录）→ cat sound → narration B（预录）。`_flush_story` 在整个 item 序列外放一个 `PlaybackResponseFrame(True/False)`，所以它们属于一个 response；不是每个 item 独立 response。预录缺失/损坏只让该 narration 退回 `TTSSpeakFrame(item.text)`。注意 sound 准备失败的异常兜底目前会读 `runtime.current.content` 整篇；将来 section 接入时必须把这一分支也改成当前 section。

已有 `items` 能表达多段内容，但不是作者 section、物理页或可恢复游标。预录 narration 的 planned/completed 语义有段级进度；completed 表示服务端输出边界经过，不是扬声器确认；没有逐词 alignment，也没有一次完整 response 的 all-planned 预览。不能把一个 item 等同于一页。

长故事的实际限制：纯 content 路径输出整篇字符串（TTS 服务内部可能再切分，应用没有作者游标）；structured items 当前会预先准备整段序列音频，长内容增加解码内存与首播等待。当前 story context 投影含全文；stop/continue 不支持从中断位置精确继续。media 只是字典，没有换图时序；interaction 还没有内嵌执行模型；已有 narration 段级语义不等于词级时间戳或真实听完进度。

## 本轮最小增量

V4 `server/data/stories/story.json` 的 `storybook-demo` 记录是六页《瑞瑞和小种子》，保留 V4 Story 必需字段，并增加可选 `sections`。每个 section 只有 identity 和沿用的 `content/items/media`；narration 仍是 `{type:"narration",text:...}`，预录引用仍可用 `audio.asset_id`。没有新建 printedText/narration 平行字段。顶层 content 保留全文，便于旧模式兼容，但需要作者保持与 sections 一致；baseline 不自动同步或迁移旧数据。

`media.image.description` 只是 demo 的不透明元数据示例，不宣称 V4 已实现 image schema/显示或真实图片资产。

`src/story-content.ts` 的 `loadStory` 是浏览器侧小型 TS 内容校验器，参考 Python 的字段及 normalization 模式，**不是直接调用 Python loader**。Test Audio 原来没有 curated Story loader；现有 test-scripts 是音频测试文段，不是 V4 Story。未提供 sections 的短 Story 在内存中生成 `<storyId>:whole` 单 section，不修改源文件。与 V4 的容错策略有意不同：baseline 严格拒绝坏 items/audio，尽早暴露 demo authoring 错误；V4 可记录警告并回退 content/realtime。未来产品仍应扩展正式 Python loader，而不是引入第二个 TS 权威内容服务。

`createStorySelection` 只保存选中的 section ID，读取对应内容；没有播放、conversation、marker 或 transport 状态。这是 baseline 的内容选择助手，不是新的 Story Engine。

## 边界

| 概念 | 含义 |
|---|---|
| Content section | 作者分段，适合长故事逐段导航；可含多个 narration/sound items。 |
| Physical page | 实体版面的页；本 demo 与 section 1:1，长期不强制。 |
| TTS segment | 合成/播放切分单元，可小于 section，也不保证等于 item。 |
| Alignment segment | timestamp / spoken progress 的技术粒度；需要真实 alignment 数据，不能用页码代替。 |

V4 `server/data/stories/storybook-markers.json` 单独保存 marker → `{storyId,sectionId,pageNumber}`，不包含正文/音频。页入口加载时检查所有引用存在。未来 detector 只替换 simulator 的 ID 数组输入：

```text
simulator / detector IDs + monotonic timestamp
→ createMarkerNavigation.update
→ confirmed transition
→ createStorySelection.setCurrentSection
→ 显示已有 Story section
```

导航 runtime 不 import DOM、Story schema、TTS、LLM、Camera。每次输入表示当前采样，调用方持续采样（页面每 50ms 一次）；没有后台计时器。默认稳定 300ms 才切页，800ms 未见当前页进入无稳定 detection。候选改变或消失会重新累计确认时间。保留最后确认页及内容，即使长期丢失也不清空；同页恢复只恢复 detection，不重复 transition/narration。A→B 确认才增加 pageChangeCount。多个不同 marker 视为歧义、不选页；重复 ID 去重。unknown marker 等同没有可用页。reset 清空候选、当前页、计数、检测与时钟；timing 可在创建时配置，UI 应用新时间会重置。

## 页面与验证

启动（按当前项目 server.mjs，未新增服务）：

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio && fuser -k 5173/tcp; npm run dev
```

页面：<http://localhost:5173/story-voice-test-audio/storybook-marker.html>

左栏为持续 marker 输入、unknown/no marker、时间配置与 Reset；中栏为标题、页/section、content、narration、media 元数据；右栏为完整导航状态和最近 30 条事件。数据都来自 JSON，不硬编码正文。点击 101 等待确认；快速点击 102→101 不切页；No Marker 超时后仍显示旧内容；重新 101 恢复 detection，计数不变。

```bash
node --test test/storybook-marker.test.mjs
npm test
npm run build
```

24 个定向测试覆盖 mapping/content 联动、unknown、确认阈值、幂等、A→B、抖动、短/长丢失、恢复、reset、时间配置、多 marker、Node 无 DOM 执行、输入校验/隔离、旧短 Story、audio/sound 顺序、坏 schema 和内容选择。不使用真实时间等待，直接控制单调时钟边界。

## 下一步复用正式播放

最自然的路径是扩展 V4 `NormalizedStory` 可选 sections，并在原 `StoryLibraryRuntime` 增加当前 section 选择，使用现有 revision/speech_epoch 保护。把 `narration()` 的输出范围缩到当前 section 的 items/content，然后继续走现有 publish/emit/_flush_story/Option A/TTSSpeakFrame。一个确认的 section 可作为一个 response，内部多个 items 保持现有语义；不要写 PhysicalBook TTS 服务。

同时必须处理已有音频取消/中断及 epoch 更新，保证翻页后旧队列不继续读；仅改逻辑 ID 不会自动中止正在播放的音频。审查所有整篇 fallback（特别是 sound 准备失败）和 LLM context 投影，改为明确当前 section 范围。精确 pause/resume、逐词进度及换图另行设计；本轮没有声称能从时间点恢复。

长期 Story/Storybook 适合渐进采用作者 sections；无需立刻全量迁移、建立通用 Engine/Framework/Output Adapter。此轮不接 V4、prerecorded、TTS、Voice Guide、LLM，也不做真实 camera/ArUco、OCR、手指点读、坐标或 alignment。

本轮验证结果：定向测试 21/21；完整 `npm test` 161/161；`npm run build` 通过；额外把 V4 当前 JSON 的 9 条故事逐条传入 TS loader，全部通过。开发服务器已启动，新增 URL 的 HTTP 返回正常。未进行浏览器可视化/点击自动化验收，也未测试真实摄像头或音频（本轮无此实现）。V4 工作树保持无修改。


## 多 item demo 验证

结构仍为 `Story → sections[] → items[]`。demo 的一个 physical page 对应一个 section，但一个 section 不等于一个 item。marker mapping 仍只包含 storyId/sectionId/pageNumber，导航代码及 schema/loader 均无需修改。

| Section / marker | 有序 items |
|---|---|
| section-1 / 101 | narration（进入花园） |
| section-2 / 102 | narration（发现种子）→ narration（种下种子） |
| section-3 / 103 | narration（浇水时听到猫叫）→ sound `cat` → narration（邀请小猫一起等发芽） |
| section-4 / 104 | narration（嫩叶出现）→ narration（观察数叶子） |
| section-5 / 105 | narration（观察蝴蝶） |
| section-6 / 106 | narration（带着收获回家） |

`cat` 沿用 V4 `story_009` 的 sound_id，现有 sound provider 可按 animal/tag 解析到 registry 的 cat-01；这里只显示字符串，不加载或播放音频。demo 的 audio.asset_id 随 V4 主数据维护；本 baseline 不加载或播放这些音频。

`section.content` 是完整正文，`items[]` 是该 section 内的有序表现/播放单元。两者语义一致即可，loader 不要求 content 等于 narration 拼接；sound 不需要对应正文。更新 section-3 后同步了顶层全文、角色与图片描述。

UI 保留完整 content 和 narration 汇总，并增加带序号的 Items 列表，显示总数、每条 type，以及 narration text 或 sound_id。选择 section 时一次取得完整 items，内部 item 不触发导航。

最短人工验证：打开页面，依次点击 101 → 102 → 103，每次等约 300ms；Items 应分别显示 1、2、3 条，103 中间是 sound_id: cat；再切回 102，顺序与内容保持。页面全程不播放声音。

本次新增三项回归检查，覆盖 demo 三种序列、marker 切换后完整有序 items（含返回原页）、content 与 narration 不必逐字拼接相等；原有 mapping 测试也改为比较完整 items，移除只检查第一条 narration 的假设。

多 item 更新验证结果：定向测试 24/24，全量 Test Audio 测试 164/164，production build 通过，页面 HTTP 200。未做浏览器点击自动化验收。


## V4 section 接入后的数据来源

导航 core 通过 `storybook-navigation` export 保留。内容唯一来源已收敛到 sibling V4 的 `server/data/stories/story.json`（id=`storybook-demo`）；baseline 页面直接 import 该数组选取记录，marker mapping 直接引用 V4 的独立 JSON。本项目的两份 JSON 副本和原同步脚本已删除，因此本实验页面/测试需要 sibling V4 数据目录。这里只展示内容，不播放音频。

V4 接入现已收敛到原 Story catalog/start_story，V4 专用 Debug UI 和 demo loader 已删除；本实验页面不再被描述为 V4 的播放入口。真实 marker provider 尚未接入 V4。

V4 catalog 现已统一为 sections/items；普通点播默认 sequential，实体绘本明确使用 marker navigation policy。sections 不再隐含等待 marker。本 Test Audio baseline 仍只验证 marker 选择内容，不承担播放策略。
