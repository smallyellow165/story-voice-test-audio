# Reading Position Tracker V1 对照实验

本实验用相同的模拟 STT 事件比较 B0、B1 与 V1。只处理文本，不使用麦克风、模型、付费 API 或 V4 Runtime。浏览器和 CLI 共用纯 TypeScript 核心及同一组逐事件目标。核心不依赖《静夜思》，场景也包括普通叙事、重复字符和 Unicode 文本。

## 启动与验收

页面：<http://localhost:5189/story-voice-test-audio/reading-tracker.html>

只启动本实验需要的 Vite，不需要 server.mjs 的 TTS 等服务：

```bash
(fuser -k 5189/tcp || true) && cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm exec vite -- --host 127.0.0.1 --port 5189 --strictPort
```

现有首页增加 Reading Tracker 链接。实验页面可选择策略/场景、单步、自动回放/暂停、重置回放、调整参数和导出三策略 JSON。自动回放使用事件间隔与速度倍率；停顿事件不触发推算进度。重置回放重建实验，真实核心 Restart 行为由 restart 场景单独验证。

CLI（Node 22.23.3 验证，使用原生 TypeScript stripping，与现有测试模式一致）：

```bash
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run reading:replay
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run reading:replay -- --scenario replacement --trace
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run reading:replay -- --scenario repeat --json
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run reading:replay -- --scenario skip-multiple --maxGap 2
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run test:reading
```

默认 CLI 是对照报告，存在预期的算法局限仍退出 0；`--strict` 在任何策略/事件未满足场景目标时退出 1，参数错误退出 2。纯 JSON 输出请直接执行 `node scripts/reading-tracker.mjs --json`，避免 npm banner。

人工验收顺序：

1. normal：逐步出现床、前、明、月；Partial 的 confirmed 保持 -1，Final 后结算到 4。
2. skip-one：V1 第一条只跟到床；随后跟到光，前为 skipped 而非 matched。切 B0/B1 看差异。
3. replacement：首次跟到月，文本改写后退到床；后续钱/前差异成为 uncertain；正确 Final 撤销 uncertain。
4. repeat：Final 到光后，再读床前明，V1 cursor/confirmed 回到 2，furthest 保持 4。B0/B1 保持 4。
5. false-end：Partial 暂到末尾不完成；Final 缩短后撤销尾部高亮。
6. restart：新 epoch 清空状态；上一轮迟到 Final 被忽略。
7. skip-multiple：默认未满足目标；maxGap=2 后可跨两字。long-input 把 lookAhead 调到 32 后可匹配。
8. 自动回放中点击暂停、切换策略和重置；比对事件表、三策略表及导出 JSON。

## 文件与接口

| 文件 | 职责 |
|---|---|
| `src/reading-tracker.ts` | `createTracker`、纯 reducer `track`、Unicode `tokenize`；无 DOM / IO / 时钟 / 网络 |
| `src/reading-tracker-scenarios.ts` | 22 个场景、60 个事件及人工编写的目标，`replay` / `compare` / `differences` |
| `src/reading-tracker-page.ts` | 页面和 CLI 同源回放结果的展示 |
| `scripts/reading-tracker.mjs` | CLI 表格、逐步轨迹、JSON、参数对照 |
| `test/reading-tracker.test.mjs` | 逐事件策略契约、独立场景目标、状态安全及 CLI 一致性 |

新增唯一运行依赖 `diff` 9.0.0（jsdiff，BSD-3-Clause）。`diffArrays` 复用 Myers 最小插入/删除路径，没有自行实现动态规划。候选限制、证据阈值和路径解释是本项目的工程策略。

最小调用：

```ts
import { createTracker, track } from './src/reading-tracker.ts'
let state = createTracker('床前明月光', 'V1')
state = track(state, { type: 'stt', epoch: 0, seq: 1, segment: 'a', at: 400, text: '床前', final: false })
state = track(state, { type: 'stt', epoch: 0, seq: 2, segment: 'a', at: 800, text: '床前明月光', final: true })
state = track(state, { type: 'restart', epoch: 1, at: 1200 })
```

输入约定：

- `text` 是当前片段的完整可替换快照，不是增量，也不是跨片段累计整轮文本。
- `seq` 在每个 epoch 内递增；同片段重复序号/乱序被忽略。Final 封存 segment；不同 segment 即使同文也是真实新输入。
- 同时只接受一个未结算片段；新 segment 不能越过未 Final 的片段，返回 `unclosed-segment`。Provider 的片段拼接/交叠必须由将来的适配层明确处理。
- `at` 是回放到达时间，不用于猜位置。`pause` 不清空、不推进。
- `restart` 必须提供更大的 epoch；STT 事件不能自动启动未来 epoch。旧事件不会改变状态。

位置都是去标点后 token 的零基索引；-1 表示尚未定位。`tokens[].start/end` 为原文 UTF-16 偏移，可映射跨 surrogate pair 的字符。匹配文本逐 code point 做 NFKC、小写转换，保留字母/数字，忽略标点、空白和 emoji；不做繁简、拼音、数字读法或同音纠正。

输出约定：

- `cursor`：当前估计光标。Partial 可以暂定推进、回退；Final 也只能说明当前识别片段已结算。
- `confirmed`：上次 Final 结算后的光标；不是正确发音认证，也不是连续全部读对的前缀。
- `furthest`：本 epoch 历史最高已结算位置，局部重读不回退；从未结算的 Partial 不计入。
- `matched/skipped/uncertain`：历史已结算标记叠加当前 Partial 的可撤销标记。matched 仅表示文本匹配。后续实际匹配可以覆盖之前 skipped/uncertain；重读中的不一致不抹去历史匹配记录。
- `tentativeIndices`：当前片段暂定涉及的字；修订时从检查点重新计算，不从上一次 Partial 继续累加。
- `complete`：已结算到原文末尾且无暂定位置，不代表所有字符均匹配。漏读后仍可能到达末尾。
- `decision`：动作、原因、前后位置、候选数量；Revise 专门表示撤销先前暂定结果。

## 三种策略

三策略共享 Partial 替换、Final 结算、去重、Restart 安全层。不会故意让 B0/B1 重复消费 Partial 以制造 V1 优势。

- B0：只匹配下一个目标字；不匹配的识别字不推进。后续输入仍可匹配该目标字。
- B1：在 B0 上允许跨过一个目标字匹配其后的字；每个孤立缺口可发生在同一事件中。跳过标记不会变 matched。
- V1：对当前位置附近的候选原文片段调用 jsdiff，不做全篇 Search。按精确匹配量、编辑量与连续性排序；同分而不同终点 Hold。仅有受支持的内部缺口才解释为 skip；删除与插入同时出现记 uncertain。保留可识别的连续前缀，不将未读的原文尾部当漏读。

V1 局部回读必须以足够长的精确匹配起始，并被 Final 或连续 Partial 的一致前缀支持。一致前缀不是不可撤销提交；后续修订仍从片段开始前的 `committed` 检查点重算。同一 Partial 的重复发送不增加证据。

| 参数 | 默认 | 含义 |
|---|---:|---|
| lookBack | 12 | 相对下一个预期字允许回看的字数 |
| lookAhead | 24 | 候选长度/当前片段输入长度上限；超长输入明确 Hold |
| maxGap | 1 | 每个原文缺口长度上限；整段候选的长度差也受此值约束 |
| support | 2 | 缺口后所需连续精确匹配字数 |
| repeatSupport | 3 | 局部重读起始精确匹配长度与稳定证据长度 |
| minCoverage | 0.6 | 精确匹配字数 / 输入字数下限 |
| maxExtra | 3 | 一个输入插入块允许的额外字数 |

候选评分固定为 `3×精确匹配数−2×编辑数−回读惩罚`，回读惩罚为 `0.5+0.05×回退距离`。这些权重及上述参数都是工程假设，不是论文验证的最优值。没有统一 200ms 等待，没有音频时间推算。大跨度无法定位时 Hold，当前 V1 不提供自动全局重新定位。

## 研究来源与实验解释

Rasmussen et al. 2011，`doc/references/Evaluating-Tracking-Accuracy-of-an-Automatic-Reading-Tutor.pdf`：§2.1（PDF 1–2 页）是 B0/B1 的策略来源。§4–5（3–4 页）的实验是离线最终假设，且策略参考轨迹不同。中文字符适配不宣称完整复现原论文。

Li & Mostow 2012，`doc/references/Evaluating-and-Improving-Real-Time-Tracking-of-Childrens-Oral-Reading.pdf`：印刷页 489–490 的 Partial 与 lag 分析支持测试修订、延迟和位置恢复。本文 0.2 秒 lag 使用后续证据估计过去位置，不等于收到文本后固定 sleep 200ms。本项目的一致前缀、窗口和重读阈值是独立工程假设。

## 当前结果与限制

默认参数下，22 场景 / 60 事件：

| 策略 | 满足全部目标的场景 | 满足逐事件目标 |
|---|---:|---:|
| B0 | 13/22 | 49/60 |
| B1 | 13/22 | 49/60 |
| V1 | 19/22 | 57/60 |

目标同时比较 cursor、confirmed、matched、skipped、uncertain，包含安全 Hold 和标记语义。因此 B1 即使定位成功，也可能因抢先 skip 或把不一致标成 skipped 而有偏差。这是人工设计的诊断集合，不是无偏基准、论文准确率复现或儿童准确率结论。

B0/B1 有偏差的场景：skip-one、skip-multiple、substitution、repeat、partial-repeat、replacement、large-jump、off-task、ambiguous-short。正常朗读、完整句、Partial 修订清空、去重、片段接续、停顿、Restart、标点映射、末尾修订等通过。

V1 的三个公开限制：

- skip-multiple：默认一个缺口不足以跨两字；maxGap=2 在此样例恢复，但可能增加误跳风险。
- ambiguous-short：原文“哈哈笑”，两段“哈”可以是继续或重读；纯文本不可辨识。顺序先验会前进，人工设定为重读的目标因此失败。
- long-input：27 字单片段超默认 24 字窗口；lookAhead=32 恢复。本轮没有隐藏截断或自动扩大全局范围。

程序契约测试与目标满足率分开：77 项专项自动化测试通过，覆盖所有策略的每个事件位置、标记及决策原因，另验证边界、安全和 CLI 一致性；全量 257 项通过；`npm run build` 通过。HTTP 页面及 Vite 转换的页面模块均可读取。当前会话没有可连接的浏览器，尚未进行真实按钮点击和视觉验收。

真实 STT 接入还需要：Provider 专属片段快照适配、seq/epoch 管理、重复/迟到/交叠结果约定，以及包含儿童语音的实际事件日志回放。可先复用 V4 已有 RTVI Transcript，但不能假定每家 Provider 都按本实验 segment 规则输出。真实准确率、端到端延迟及阈值需要另外验证；不需要新增 STT 模型。

## 逐事件可观察性

页面打开及重置后直接显示第 1 条事件；“下一步”推进至第 2 条。
当前事件展示原始 STT、规范化字符对照、Actual / Expected 字符状态及契约 Pass / Fail。
全部 Sequence 默认显示为表格（包括尚未播放的事件），点击任意行可选中查看；当前播放步骤高亮。宽屏左侧为 Sequence，右侧为实际字符状态与 Decision Reason。原文保留标点，顶部只显示一次连续文本。Actual / Expected / Pass-Fail、详细 Alignment、三策略比较、索引、参数和 JSON 收入默认折叠的 Debug。

- Actual 来自原有 replay / TrackerState，包含历史接受状态和当前暂定状态，不等同于本次 STT 的逐字映射。
- Expected 来自 reading-tracker-expectations.ts：从原测试原样迁移的 overrides / contracts，加上原场景 goal。测试、页面和 CLI 共用这些常量，没有从 Actual 生成期望。
- Pass / Fail 比较原测试的五个状态字段及 action / reason；不表示所有独立不变量测试已在浏览器执行。
- 理想跟读目标单列显示，已知局限不会因为契约 Pass 而被隐藏。
- 自定义 V1 参数显示 N/A，默认参数期望仅供参考。Expected 未定义的暂定着色不从 Actual 推导。
- 核心未暴露候选路径，报告 candidateAlignment 为 null。Reference / STT 字符表是已有 jsdiff 的独立展示对照，不是内部候选，也不是实际接受路径。全篇重复文字可能与 Tracker 选择不同位置。
- 字符对照使用核心 tokenize 的规范化结果（略去标点）；原文仍显示在上方。缺口显示 —，不自动判为 Skip。额外输入标为字面 Mismatch，不等于孩子读错。

页面（仅 Vite，无 API 服务）：

```bash
(fuser -k 5189/tcp || true) && cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm exec vite -- --host 127.0.0.1 --port 5189 --strictPort
```

http://localhost:5189/story-voice-test-audio/reading-tracker.html

CLI 保留原有 --json / --trace / --strict；新增 --alignment 展示字符表。
JSON 保留原始 comparison / rows，并新增 eventReports（与浏览器 eventReport 相同）。
--strict 仍按理想跟读目标决定退出码，不改为策略契约。

```bash
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run reading:replay -- --scenario skip-one --alignment
```

验收：选择“漏一字”及 V1，第一条“床明月”只接受“床”；下一步“床明月光”暂定接受“床明月光”并 Skip “前”；再次下一步 Final 结算。三条契约应均为 Pass。直接点击 Sequence 任意行回看；切换 B0/B1 检查其不同输出，在 Debug 查看理想目标差异；修改 V1 参数查看 N/A，导出 JSON 核对 eventReports。

## 2026-10-11 真实朗读停滞诊断（截图重建，非原始 STT 录制）

新增 scripts/reading-tracker-diagnose.mjs、test/fixtures/reading-jingyesi-observed.mjs 和 test/reading-tracker-diagnostic.test.mjs。不改核心、默认参数或原有 22 场景期望。

证据：V4 server/.local/logs/server-2026-10-11_16-49-20.log 的 395/409/423/432 行有四句对应的最终聚合文本（床前明月光 / 一世地上霜。 / 举头望明月 / 低头思苦香），但没有完整 Partial、Deepgram start/duration 或 Reading segment。13 条输入及 P/F 按用户截图重建；片段按每个 Final 切分，epoch/seq/时间为明确标注的合成元数据，未把 VAD segment 当作 Deepgram segment。

离线输出为逐事件累计 matched/skipped/uncertain，带原文索引、cursor、confirmed 和 reason。运行：

```bash
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && node scripts/reading-tracker-diagnose.mjs
```

附加 --json 获得完整状态和受控探针；独立测试：

```bash
cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && node --test test/reading-tracker-diagnostic.test.mjs
```

结论：

- maxGap=1：13 步 cursor 为 0,1,4,4,4,4,4,4,4,4,4,4,4；第 5–13 步 no-local-match，只有首句匹配。
- maxGap=2：cursor 为 0,1,4,4,4,4,9,10,12,14,16,18,17；第二句 Final 将疑/是（5/6）标为 Uncertain，地上霜（7/8/9）Match；所有事件 skipped 均为空。
- 第 6 步虽然有地上霜，但前后 Partial 公共前缀只有“一室”两字：stableLength=2，小于替换后的 h+support=2+2。Final stableLength=5 后才允许跨越；coverage=3/5 正好达到 0.6。
- maxGap 同时限制 removed 与 added，故当前既限制漏字，也限制替换。Uncertain 的决策 action 仍可能叫 Skip，不能把 action 名称当作 skipped 索引。
- 第二句失败后 anchor=4，候选 start 只允许 <=next=5；第三句真正起点=10，需要跨 5 字。maxGap=2 仍无法直接从光恢复第三句，lookAhead=64 也不解决。仅作诊断的 maxGap=5 能跳过整句到月，但这不是推荐配置。
- 第四句 Final 的苦香对应末尾故乡，完整候选缺少 following support，被拒；更短候选匹配低头思、把苦香作为多余输入（2<=maxExtra=3），覆盖率仍为 3/5，最终停思。故的 Partial 高亮撤销，故乡保持 Unread，不自动判错或标 Skip。
- 仅播放四个 Final：默认 cursor=4/4/4/4，maxGap=2 为 4/9/14/17，committed 与完整 Replay 一致。把第二句 Final 改为准确文本的受控对照，默认策略也能继续第三句。这些验证排除了重建数据中的跨 Final 状态丢失，不能代替缺失的真实 Provider 事件审计。

建议：保留生产默认；下一轮单独评估两字符 substitution 容忍（与纯 Skip 限制分开）、有证据的局部重新定位、尾部不一致展示。没有发现可在不改变策略取舍的前提下直接修复的核心状态缺陷。
