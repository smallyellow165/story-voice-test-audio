# Hopscotch / 跳格子 V2 baseline

独立页面：`http://localhost:5173/story-voice-test-audio/hopscotch.html`

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
fuser -k 5173/tcp; npm run dev
```

## Random Mode 与共享规则

- `src/hopscotch-core.ts`：纯 TypeScript，负责 board、配置、合法目标、随机出题、位置、历史和状态转换；不导入 DOM、React、媒体或网络模块。
- `src/hopscotch.ts` / `.css`：读取 Core 状态，渲染棋盘和控制按钮。Repeat 的视觉强调只发生在页面，不改 Core 状态。
- `CLASSIC_BOARD` 使用 `initialCell` 和 `cells`。每格含 `id`、`label`、`level`、`lane`；lane 只控制展示，id/label 不参与距离计算。Core 可接收同结构的自定义 board，页面使用经典 1–10 布局。
- 合法条件：不同格子，`1 <= abs(target.level - current.level) <= maxJumpSteps`；关闭 backward 时还须 `target.level > current.level`。不允许同层跳跃。
- 默认 `maxJumpSteps=1`、`allowBackward=true`。改变配置立即重算合法目标，保留仍合法的任务，否则重新出题；不移动当前位置、不增加完成/跳过历史。
- 从合法目标中随机选择；存在替代项时排除上次发出的目标，只有一个合法目标时允许重复。
- Done：记录 `from → target DONE`，位置变为 target，生成下一题。
- Skip：记录 `from → target SKIP`，位置不变，重新出题。
- Repeat：读取当前任务、重新强调显示；不变更位置、目标、历史、计数或随机序列。
- Reset：回到 board 起点、清空历史/计数/上次目标，重新出题；保留所选配置。
- 没有合法目标时 `targetCell/task=null`，Done/Repeat/Skip 禁用。经典 board 关闭后退并到达 10 时会出现此状态；开启后退或 Reset 即可继续。
- `currentCell` 是家长确认的逻辑位置，没有检测意义。初始为 1；刷新页面重新开始，不保存游戏进度。

## 共享入口

沿用现有 library build，无新 package 或依赖：

```bash
npm run build:module
```

导出入口为 `story-voice-test-audio/hopscotch-core`，类型指向唯一 TS 源码，运行时指向 `dist-module/hopscotch-core.js`。本轮没有接入或修改 V4。

## 验证

```bash
node --test test/hopscotch-core.test.mjs test/hopscotch-script.test.mjs
npm run build
npm run build:module
```

手工验收：

1. 打开页面，board 从下到上为 1、2/3、4、5/6、7、8/9、10；当前位置为 1，目标为 2 或 3。
2. Done 后，原目标变为当前位置，完成计数加一，新目标必须在虚线合法范围内。
3. Repeat 后，对比 Debug/History，全部不变；任务短暂高亮。
4. Skip 后，当前位置不变、跳过计数加一；有替代目标时换题。
5. 设置 Max Jump Steps=2，从起点 legalTargets 应为 2/3/4；改回 1 时不能保留目标 4。
6. 关闭 Allow Backward，所有目标都在更高层。一路 Done 到 10，出现无合法目标提示；开启后退可继续。
7. 连续操作几十次后 Reset，回到 1，历史和计数清零。

页面显示最近 50 条历史（最新在前），Core 保留本轮全部历史。全程不需要 LLM、TTS、Camera、Pipecat 或额外凭据。


## V2 Primitive Actions + Script Mode

页面默认仍是 Random Mode，保留 V1 的无限随机玩法。选择 Game Mode → Script Mode 后开始当前选中脚本（默认“基础跳跃”）。切换模式或脚本都会回到起点并清空本轮历史，跳跃配置保留；在 Random/Script 间切换会保留之前的脚本选择。

结构化数据：

```ts
type HopscotchTask = Readonly<{
  id: string;
  type: 'jump_to' | 'jump_to_and_clap' | 'jump_to_and_turn';
  target: string;
}>;
type HopscotchScript = Readonly<{
  id: string;
  title: string;
  tasks: readonly HopscotchTask[];
}>;
```

`formatHopscotchTask(task, board)` 按 label 生成“跳到 X”“跳到 X，然后拍拍手”“跳到 X，然后转一圈”。每项只有一个 target、一次 Done，不跟踪拍手/转圈中间步骤。Core 仍提供 V1 的 task.text/action 便利投影，但结构化 type/target 是真实数据。

`src/hopscotch-scripts.ts` 只保存人工设计数据，Core 不导入默认脚本。两份脚本各 12 项，默认 config 下从 1 执行都无需 fallback：

| 项 | 基础跳跃 | 动作混合 |
| --- | --- | --- |
| 1 | 跳到 2 | 跳到 3 |
| 2 | 跳到 4 | 跳到 4，然后拍拍手 |
| 3 | 跳到 5 | 跳到 6 |
| 4 | 跳到 7 | 跳到 7，然后转一圈 |
| 5 | 跳到 8 | 跳到 9 |
| 6 | 跳到 10 | 跳到 10，然后拍拍手 |
| 7 | 跳到 9 | 跳到 8 |
| 8 | 跳到 7 | 跳到 7，然后转一圈 |
| 9 | 跳到 6 | 跳到 5 |
| 10 | 跳到 4 | 跳到 4，然后拍拍手 |
| 11 | 跳到 3 | 跳到 2 |
| 12 | 跳到 1 | 跳到 1，然后拍拍手 |

这是人工准备的固定顺序，不保证真实时长；用实际玩耍判断能否达到 3～5 分钟，没有倒计时或自动完成。

### Core progression

- 每项激活前调用同一个 `getLegalTargets()`。原 target 合法时直接保留；非法时从 legalTargets 选择替代值，保留 id/type，存在替代项时避开上次目标（包括刚 Skip 的目标）。
- `originalTask` 是原定义的副本，`resolvedTask` 是真正执行的任务；原脚本不会被改写。fallback 选择仍可随机，规则和动作文案不依赖 LLM。
- Done：按 resolved target 更新 current，记录 DONE，index + 1，然后 resolve 下一项。
- Skip：不改 current，记录 SKIP，index + 1，然后按实际 current resolve 下一项。
- Repeat：只返回快照，不变更 index/target/history，也不消耗随机数。
- 最后一次 Done 或 Skip 后 `status=finished`，active task 清空。之后 Done/Skip/Repeat 不推进，config 修改也不生成随机任务。
- Reset/再来一轮：回 initialCell、index=0，清空历史和计数，保留所选 Script 与 config，重新 resolve 第一项。
- config 修改不改变 current/index/history。合法 active task 保留，非法时重新 resolve 当前 script 项。
- 没有合法目标时 `status=blocked`，index 不前进，保留 originalTask；调整配置或 Reset 恢复。blocked 与 finished 在 UI/Debug 中明确区分。
- `completedScriptTaskCount` 只统计 DONE；SKIP 单独统计，scriptTaskIndex 表示已消费多少项（DONE + SKIP）。

Debug 显示 mode/status/scriptId、零基 index、总数、原始与 resolved task。History 显示动作类型、DONE/SKIP，以及 fallback 的 planned → resolved target。Board 始终高亮 resolved target。

### V2 手工验收

1. 默认 Random 模式继续验证 Done/Skip/Repeat/Reset，确保 V1 行为保持。
2. 切 Script → 动作混合，确认 current=1、Task 1/12、“跳到 3”。连续 Done 玩完，确认每项文案和位置、最后显示“这一轮完成啦！”。
3. 结束后改变 jump config，确认仍 finished、没有偷偷出题；再来一轮后回到 Task 1/12，计数/历史清零。
4. 默认配置下 Reset，然后第一项点 Skip：current 仍为 1，下一项 planned 4 非法，resolved 应为 2（避免刚跳过的 3），仍要求拍拍手。检查 Debug 与 History。
5. Repeat 后检查 index、目标、历史、计数全不变。
6. Max Jump Steps=2 下 Reset，Skip 第一项使第二项合法目标为 4；改回 1，当前项应重新 resolve 到 2/3，index 和位置不变。
7. 按默认配置 Done 到 10，在第七项关闭后退，应 blocked；开启后退恢复当前项，进度不重置。
8. 中途切到另一个 Script，确认回 initialCell、index=0，保留 jump config。
