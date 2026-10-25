# Spatial Assembly Workflow V1

AI Design Lab (`brick-test.html`) 左侧的「设计工作流」可选择 Spatial Assembly。Part Explorer 的已完成且已保存审核结果提供「Spatial Assembly · 复原已审核照片」链接。未保存审核必须先在 Part Explorer 保存。

## 使用

1. 选择 Analysis / Review，展开查看已确认的 Observation ID、RB 型号和颜色。当前 V1 要求每个保留的 Observation 对应一块积木；数量大于一时明确阻止规划，不猜测新实例位置。
2. 可选模型及是否使用已保存视觉证据，主动点击「生成新的 Spatial Plan（调用模型）」。复用官方 Mapping、实际 LDraw 尺寸、连接器及原始照片。生成结果和完整请求、响应立即保存；不会自动 Repair、重试或执行几何。
3. 或在「已保存 Spatial Plan」选择历史计划，不需要调用 LLM。只读查看计划、不确定性、生成时审核快照、原始照片和 Raw Trace。当前审核变化不会覆盖历史快照。
4. 主动点击「执行 Geometry（不调用 LLM）」。结果保存后在原有 BrickViewer 展示首个合法候选。可切换 Geometry Candidate、查看其相对首候选的位置/朝向差异，以及连接、碰撞、区间、视觉约束和失败诊断。
5. 当前 Analysis、Plan、Geometry Result、Candidate ID 保存在 URL；刷新或重新打开该链接可恢复。也可通过历史下拉框加载。手动修改场景不自动保存，且会清除候选显示成功标记。

未完成、错误或无效计划不可执行；求解无解、信息不足、搜索超限、执行异常不会显示成功候选。视觉投影等不可执行约束仍标为未验证。HTTP 超时不自动重试；从历史查看已保存结果。每次显式新生成使用新的 request ID；相同 ID 的重复请求（包括服务重启后）不会重复调用模型。

## 实现与存储

- `server/brick-spatial-workflow.mjs`：轻量持久化和阶段编排，API 前缀 `/api/brick-spatial/`。仅通过已审核 Part Explorer 来源及官方 Mapping 准备新输入。
- `src/brick-test/SpatialAssemblyPanel.tsx`：阶段按钮、快照、历史、候选选择、诊断；复用 `ModelSelector`。
- `BrickTestPage.tsx`：工作流切换、共享原 BrickViewer/Assembly Validator；Generator V3 保持原面板。
- `ReverseAssemblyPanel.tsx`：已保存审核结果入口。
- 直接调用 `experiments/spatial-planning/{input,runner,plan}.mjs` 和 `experiments/geometry-execution/execute.mjs`，复用 Model Registry、Wire Capture、Brick Rules、Geometry/Connector 模型与 Validator。未新增求解算法或 LDraw 实现。
- `generated/brick-spatial-traces/<id>.json` 及 `.request.json` / `.response.txt`：原规划和完整 HTTP 正文；下载 Trace 包含两个原始正文。此轮未新增模型调用。
- `generated/brick-spatial-geometry/<id>.json`：完整求解结果、候选、布局分组、枚举/拒绝证据、源计划快照和 SHA256。
- `generated/brick-spatial-requests/<requestId>.json`：持久化请求状态和重复提交保护。

这些生成目录不纳入 Git；需要长期共享时应单独归档。历史实验的 `output/geometry-execution/` 保持不变；UI 的几何历史目前列出由工作流保存的新结果，旧计划可以直接再次执行确定性几何。

## 本次实际验收

输入 Analysis：`0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa`。
输入 Plan：`f1f84e96-8269-4132-807a-61c41243229f`。
对照独立实验：`a41d93d1-dd36-4741-a374-1cab4505fb00`。
UI 新生成 Geometry：`6f7f1241-a230-4c8c-89cd-92f6775a793b`。

从 Part Explorer 点击新入口 → 加载旧 Plan → UI 点击执行 Geometry，得到 **7/7 块、512 个朝向候选、1 个位置布局、Geometry Valid、6 对连接、18 个接合点、碰撞 clear**。候选 1 的全部 Brick 字段与独立实验结果完全相同。照片与三维对照：头位于长颈上方，背部在右侧身体上方，两块 40666 上下叠放且水平错开，两条腿分离并向下延伸，主要结构一致。

通过实际 Chromium UI 测试切换候选 512 后刷新，恢复相同 Plan / Result / Candidate；服务重启后也能恢复。失败 API Trace 和 prepared Trace 均不可执行。切回 Generator V3 面板正常。手动编辑后不再声称正在显示保存候选。整个主验收只发出一次 `/execute` POST，零 `/plan` POST，零付费模型调用。

本机入口（需运行 `HOST=127.0.0.1 PORT=5180 npm run dev`）：

<http://127.0.0.1:5180/story-voice-test-audio/brick-test.html?workflow=spatial&analysisId=0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa&spatialPlanId=f1f84e96-8269-4132-807a-61c41243229f&geometryId=6f7f1241-a230-4c8c-89cd-92f6775a793b&candidateId=candidate-1>

截图、浏览器断言结果及日志：`output/spatial-workflow-v1/`。

- `01-explorer.png`：Part Explorer 新入口。
- `02-geometry.png`：共享 Viewer、候选和连接结果。
- `03-photo-assembly.png`：原始照片与 3D 骆驼对照。
- `04-restored.png`：候选 512 刷新恢复。
- `05-failed-plan.png`：失败计划禁用执行。
- `06-generator.png`：原 Generator 面板。
- `acceptance.json` / `final-check.json`：实际网络请求、结构比对和恢复结果。

## 自动化验证

```sh
node --test test/brick-spatial-workflow.test.mjs test/brick-spatial-planning.test.mjs test/brick-geometry-execution.test.mjs test/brick-generator.test.mjs test/brick-design-input.test.mjs test/brick-design-display.test.mjs test/brick-design-profiles.test.mjs test/brick-design-wire.test.mjs
npm run build
```

62 项通过；TypeScript 与生产构建通过。新增工作流测试覆盖真实骆驼、重复请求、重启、异常/无解、审核版本变化、完整 Wire 下载、原始输出与计划一致性，以及进行中的付费请求锁定。测试用依赖替身仅在测试文件内，正式链路无 Mock。

Generator 原测试文件缺少一个右花括号，已只修复语法，19 项通过，未改变断言。额外运行未修改的 `brick-reverse.test.mjs`，7/9 通过；两个既存失败分别是旧断言未包含现有 Prompt Profile，以及保存审核测试的候选不满足当前校验。这两项未放宽断言，未改动 Reverse 逻辑。

浏览器环境存在另一开发服务占用 Vite HMR 24678 端口，因此浏览器记录有开发热更新 WebSocket 警告；页面加载、API、3D 渲染、刷新均通过。未停止用户的另一个服务。

## 边界

- 本轮未重新验证付费模型生成质量；规划接入通过当前审核适配、请求编排回归和既有 Provider 流程复用验证。
- 几何有效是现有保守实体/接合模型的结论，不等同于物理稳定性；未实现 Build Order。
- 512 个候选是对称朝向组合，不是 512 种身体布局。未改变输入照片结构来换取有效结果。
- 历史输出较大（完整候选约 15 MB）；当前按需下载诊断，候选列表保留全部结果。暂不引入后台任务队列或复杂分页。
- 后续可处理既存 Reverse 测试债务和生成文件归档；无需为此轮继续扩展几何算法。

## 本轮文件清单

新增：`server/brick-spatial-workflow.mjs`、`src/brick-test/SpatialAssemblyPanel.tsx`、`test/brick-spatial-workflow.test.mjs`、本文档。

修改：`server.mjs`、`src/brick-test/BrickTestPage.tsx`、`src/brick-test/ReverseAssemblyPanel.tsx`、`src/brick-test/brick-test.css`、`test/brick-generator.test.mjs`（只补缺失括号）。

工作区已有的 `.gitignore`、`viewer.ts` 与独立 Geometry Execution 实验改动属于前阶段，本轮保留并复用。
