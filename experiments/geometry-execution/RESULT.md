# 七块骆驼：Geometry Execution 实测

结论：最终 **Geometry Valid**，真实 LDraw 渲染与原照片的关键结构一致。没有调用 LLM，也没有修改原 Spatial Plan、历史审核数据或正式后端。

## 输入、执行与结果

固定输入：`generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.plan.json`。型号、颜色、原图和几何快照来自对应 Trace。读取后记录源文件 SHA256，完成后再次核对未改变。

执行命令：`node experiments/geometry-execution/run.mjs`。

最终输出目录：

`output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/`

最初运行目录 `cc237a0a-6251-4607-82e0-56c977d20bd2` 也保留；之后仅完善失败原因汇总并重跑离线转换，没有重新调用模型或修改预期结构。

- completeSearch=true，原网格域穷举完成。
- 512 个完整朝向组合，512 个合法候选，0 个拒绝。
- 只有 **1 个平移布局**，其余差异为 yaw 和对应接口编号。所有候选均保留，并非只保存一个“最优答案”。
- 七块实例完整；无额外零件或重复身份。
- 每个候选均为 6 对连接、18 个接合点；原区间、六个确定 mating intent 和八条世界轴空间关系均通过。
- 砖体/凸点碰撞检查均为 clear；组合最终连通。
- 没有执行 Build Order 或中间步骤支撑验证。

## 实际位置

相对原 anchor 统一 Y 加 96 LDU 以落地。该统一平移不改变任何相对位置。下表直接采用已有 Placement 单位：X/Z 为 Stud，layer 为 48 LDU 高度单位。

| Observation | Part | X | Z | layer | 首候选 yaw |
|---|---|---:|---:|---:|---:|
| head | 3437 | -2 | 0 | 4.5 | 0 |
| neck | 4066a | -1.5 | 0 | 2.5 | 90 |
| back | 3437 | 1 | 0 | 3 | 0 |
| upper_horizontal | 40666 | 1 | 0 | 2.5 | 0 |
| lower_horizontal | 40666 | 0 | 0 | 2 | 0 |
| left_leg | 4066a | -0.5 | 0 | 0 | 90 |
| right_leg | 4066a | 1.5 | 0 | 0 | 90 |

X/Z=0 等具体值来自原区间内唯一合法网格点，不是把隐藏深度无条件置零。仍不宣称单张照片从物理上证明了隐藏深度。

## 连接与碰撞

| 下方零件 → 上方零件 | 接合点 |
|---|---:|
| neck → head | 2 |
| lower_horizontal → neck | 2 |
| upper_horizontal → back | 4 |
| lower_horizontal → upper_horizontal | 6 |
| left_leg → lower_horizontal | 2 |
| right_leg → lower_horizontal | 2 |

每个 candidate 的 intents.pairs 保存 ownIndex、otherIndex 和世界 LDU 接合坐标。原计划的 null 接口没有被覆盖，这些是确定性执行产生的派生匹配结果。

## Viewer 与照片对照

[打开最终 Viewer](http://127.0.0.1:5178/story-voice-test-audio/experiments/geometry-execution/viewer.html?result=/story-voice-test-audio/output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/viewer.json)

若服务停止，用 README 中的 Vite 命令启动。本页面使用真实 BrickViewer + 本地 LDraw 文件，支持拖动旋转、正/背面按钮、候选下拉和相对首候选的差异显示。

本轮 Browser 会话列表为空，因此使用已有 headless Chromium + SwiftShader 渲染。页面 DOM 确认 data-ready=true、Geometry Valid、无加载错误；查看了首候选和 candidate-512 的实际截图。没有用示意图代替三维模型。

- [首候选与原图并排截图](../../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/viewer-photo.png)
- [candidate-512 对照截图](../../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/viewer-candidate-512.png)

candidate-512 截图来自第一次输出；已逐字节确认它的候选 JSON 与最终输出完全相同。最终首候选截图重新从最终输出路径渲染。

人工结构审阅：

| 验收项 | 结果 |
|---|---|
| 七块积木身份 | 完整，颜色均为 14 |
| 两块薄件在身体处上下叠放 | 符合；没有脚底薄件或同层相交 |
| 上薄件向右错位 | 符合；40 LDU=1 Stud |
| 双腿分离并从身体向下延伸 | 符合；中心距 80 LDU，间隙约 40 LDU，两脚同高 |
| 颈在下薄件左端 | 符合，正确使用高砖 90°/270° footprint |
| 头位于颈上且向左悬出 | 符合；中心相对颈偏左 20 LDU |
| 背砖位于上薄件中央 | 符合 |
| 原图和渲染的整体轮廓 | 结构一致；透视、光照和边线样式不同，未做像素级拟合 |

未逐一截图全部 512 个候选；所有候选都经过同样的几何验证，首尾两种朝向组合做了视觉复核。平移一致不被用于宣称所有原始 mesh 完全相同。

## 测试与检查

1. `node --test test/brick-geometry-execution.test.mjs test/brick-spatial-planning.test.mjs test/brick-geometry-solver.test.mjs`：24 项，23 通过，1 既有 Solver 测试失败。
2. 本轮 Geometry Execution 九项全部通过；完善失败汇总后再次运行九项，9/9 通过。
3. Spatial Planning 十项全部通过。
4. 旧 Geometry Solver 测试五项中四项通过；失败在 `test/brick-geometry-solver.test.mjs:58`：旧 Beam Search 返回的 16 个候选没有一个同时满足其额外的地面/支撑筛选。该测试仅引用未修改的旧 Solver、fixture 和共享几何，与新执行器无关；没有为了变绿修改它或原始 fixture。
5. 独立 Viewer TypeScript 检查通过：

   `node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types vite/client experiments/geometry-execution/viewer.ts`

6. Vite 实际服务与 Chromium 渲染成功；真实 DAT 资源完整加载。
7. `git diff --check` 通过；原始 Plan/Trace SHA256 未变。

没有跑无关全项目构建。本实验 HTML 不加入正式生产打包入口，通过现有 Vite dev 服务使用。

## 产物与改动

- [完整 report.json](../../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/report.json)：约 15 MB，保存每个尝试、源计划、几何、全部接口配对和拒绝汇总。
- [首候选 candidate-1.json](../../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/candidate-1.json)
- [Viewer 索引](../../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/viewer.json)
- 同目录 `execution-tests.log`、`combined-tests.log`、`viewer-dom.html`、`viewer-browser.log` 和两张截图。

新增：`execute.mjs`、`run.mjs`、`viewer.html`、`viewer.ts`、README、本报告、`test/brick-geometry-execution.test.mjs`。

共享代码只修改 `src/brick-test/viewer.ts` 的 fit 方法，增加可选观察方向参数，用于照片方向/正面/背面对照；原有默认方向保持不变。Generator V3、Part Explorer、后端和历史数据未修改。

## 剩余限制

- Valid 基于现有保守碰撞包络和已审核 mating contract，不是物理稳定性或实际夹持力认证。
- 原计划由照片和旧 Analysis/Relations 联合提供；本轮证明的是固定计划可执行并与原图结构相符，不是对所有照片的泛化能力。
- 没有处理连续倾斜、任意角度、未知深度补全或无标定相机的遮挡约束；这些情况不会被伪装为已验证。
- 512 个朝向全部保存便于审计，报告偏大。未来可以在明确验证 mesh/连接器对称等价后压缩展示，但本轮未擅自去掉候选。
- 本轮闭环已完成；无需再调用模型或立即开发儿童 Build Order。
