# Hopscotch / 跳格子 V1 baseline

独立页面：`http://localhost:5173/story-voice-test-audio/hopscotch.html`

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
fuser -k 5173/tcp; npm run dev
```

## 边界与规则

- `src/hopscotch-core.ts`：纯 TypeScript，负责 board、配置、合法目标、随机出题、位置、历史和状态转换；不导入 DOM、React、媒体或网络模块。
- `src/hopscotch.ts` / `.css`：读取 Core 状态，渲染棋盘和控制按钮。Repeat 的视觉强调只发生在页面，不改 Core 状态。
- `CLASSIC_BOARD` 使用 `initialCell` 和 `cells`。每格含 `id`、`label`、`level`、`lane`；lane 只控制展示，id/label 不参与距离计算。Core 可接收同结构的自定义 board，页面 V1 使用经典 1–10 布局。
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
node --test test/hopscotch-core.test.mjs
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
