# Spatial Planning V1：真实骆驼实验

结论：本次单次调用给出了与原图相符的最终空间布局，十项人工空间理解检查通过。输出足以约束一个名义 Stud Grid 平移候选；尚未做连接器配对、碰撞验证或 Assembly Viewer 验证，不能据此宣称已经完成三维重建。

## API 修复

失败 Trace：`ef8bf2f6-efa7-4919-9f99-17e78edc79fa`，历史文件原样保留。

实际 HTTP request 使用 `text.format.type=json_object`。顶层 `instructions` 有 JSON，`input` 中的文本却没有，服务端返回 HTTP 400、param=input。

只修改 `input.mjs` 的 OpenAI 输入文本，在原有序列化数据前加上：

> Return a JSON object only, following the business output contract in the instructions. No markdown.

沿用现有 Provider/Model Registry、Responses adapter 和 Wire recorder，未修改 Spatial Plan Schema、空间推理算法或 Generator V3。官方说明：[JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs)。本次实际请求证明该 input 前缀满足服务端要求。

## 实际执行

- `node --test test/brick-spatial-planning.test.mjs test/brick-model-registry.test.mjs test/brick-design-wire.test.mjs`：14 项中 13 通过、1 失败。
- Spatial Planning 全部 10 项通过，包括本轮新增的输入 JSON 指令、输入数据保留及准备请求持久化断言。
- Wire Trace 1 项通过，覆盖完整 HTTP 正文、图片尾部、错误响应和不保存认证头。
- Registry 3 项中 2 通过。失败是 `test/brick-model-registry.test.mjs:26` 的既有 Generator Gemini prompt 精确相等断言：实际 prompt 还包括现有 Free Generation V1 Profile。该测试不导入 Spatial Planning，本轮没有修改其代码依赖或断言。
- 单独运行 Spatial Planning + Wire：11/11 通过。
- `git diff --check` 无错误；新实验目录仍为工作区未跟踪文件，因此此检查不代替对新文件的测试。
- prepare-only 成功：`566bb2e1-1069-4ab2-ad60-f731a09254c2`，确认七个 ID、13 条关系、原图 14,778 字节、JSON 指令及 medium reasoning。
- 本轮仅一次真实请求：`node --env-file-if-exists=.env experiments/spatial-planning/run.mjs --model gpt-6.1-sol --run`。没有 Repair、再次识别、模型替换或抽样重试。
- Browser 连接列表为空；使用机器已有 headless Chromium 渲染 HTML，并查看截图，确认原图区域框、表格和状态可读。
- 未运行全项目构建：本轮没有 TypeScript、前端打包入口或依赖修改。

## 请求结果

| 项目 | 实际结果 |
|---|---|
| Trace / Generation ID | f1f84e96-8269-4132-807a-61c41243229f |
| 请求模型 / 响应模型 | gpt-6.1-sol / gpt-6.1-sol |
| Reasoning effort | medium |
| HTTP / finishReason | 200 / completed |
| 耗时 | 71,392 ms |
| Input tokens | 16,282 |
| Output tokens | 5,140（其中 reasoning 768） |
| Total tokens | 21,422 |
| 解析 / 校验 | parsed；valid=true，issues=[] |
| Wire / Conversion | response_saved / needs_resolution |

已逐项核对：raw request 等于保存的构造请求；raw response 等于保存的响应；HTTP 中图片与所选原图 Base64 完全一致；从响应提取的文本等于 rawOutput；JSON.parse(rawOutput) 等于 plan。

## 十项人工空间理解验收

以下为对照原图和数值的人工审阅，不是自动视觉评分或真实三维测量。

| 检查 | 结果与依据 |
|---|---|
| 1. 两块 40666 均属于身体 | 通过；分别是 upper/lower body layer，均在腿顶以上。 |
| 2. 薄件上下叠放 | 通过；upper 相对 lower 的底部 Y=24 LDU，恰为薄件厚度；没有放到脚底或同层。 |
| 3. 薄件水平错位 | 通过；upper 相对 lower 的 X=[36,44]，名义值 40 LDU=1 Stud。 |
| 4. 双腿向下并保持分离 | 通过；两腿相对 lower 的 Y=-96；名义 X=-20、60，中心距 80、宽度各 40，间隙约 40 LDU。 |
| 5. 颈在身体一端 | 通过；颈名义 X=-60、Y=24，quarter-turn 后横向宽 40，与 lower 左端对应。 |
| 6. 头在颈上 | 通过；相对颈 Y=96、X≈-20，正确表达半 Stud 中心偏移与左侧悬出。 |
| 7. 背砖在身体上 | 通过；back 相对 upper Y=24、X≈0，位于上薄件中央。 |
| 8. 不新增零件 | 通过；恰好七个已确认实例，part/color 由输入权威绑定。 |
| 9. 不混淆重复型号身份 | 通过；head/back、三块高砖、两块薄件均保留各自 Observation ID。 |
| 10. 隐藏连接保留不确定性 | 通过；六条 mating intent 都为 inferred，connector indices 均为 null；深度保留区间和文字限制。 |

这不是一次新的零件识别验收：型号已经人工确认。本次采用默认完整旧 Analysis/Review/Relations，输出 bbox 与旧 Analysis 相同，所以不能把结果解释为“模型仅凭图片独立恢复全部信息”。更准确的结论是：在确认身份、真实几何和既有视觉证据帮助下，第二阶段成功给出了相容且更精确的数值布局。

## 能否指导几何放置

可以指导生成名义候选，但不应直接宣称执行完成。使用现有半 Stud 网格（X/Z 每 20 LDU），每个累计坐标区间内只有一个网格位置，且这些位置也满足各自相对区间。此为离线区间检查，没有修改原计划，也没有运行几何求解器。

以下坐标是以 lower 底部中心为原点的**派生网格候选**，不是覆盖模型区间的新答案：

| ID | X | Y | Z | 模型 yaw 候选 |
|---|---:|---:|---:|---|
| head | -80 | 120 | 0 | 0/90/180/270 |
| neck | -60 | 24 | 0 | 90/270 |
| back | 40 | 48 | 0 | 0/90/180/270 |
| upper_horizontal | 40 | 24 | 0 | 0/180 |
| lower_horizontal | 0 | 0 | 0 | 0/180 |
| left_leg | -20 | -96 | 0 | 90/270 |
| right_leg | 60 | -96 | 0 | 90/270 |

若后续转换到 Assembly，可统一 Y 加 96，使两腿底部落地，再用 x/40、z/40、y/48 转成已有 Placement 单位。多数 yaw 歧义对应当前矩形几何的对称朝向；这需要几何执行阶段确认，不能凭文字自动改写或丢掉候选。

当前 `needs_resolution` 同时包含真实未知项和保守诊断：多个对称 yaw；隐藏接口；alternatives 中部分只是轴约定说明；missingGeometry 中甚至有“No additional part dimensions are needed”。当前诊断把这些都列为 unresolved，不能把这一状态简单解释为视觉理解失败。本轮不修改 Schema/算法，也不自动消除它们。

## 文件与路径

产物均位于项目根目录下 `generated/brick-spatial-traces/`：

- [HTML 报告](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.html)
- [完整 Trace JSON](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json)
- [原始计划导出](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.plan.json)：从 plan 原样导出，没有几何修正。
- [Raw Request](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.request.json)
- [Raw Response](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.response.txt)
- [浏览器截图](../../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.report.png)

本轮源文件修改：`input.mjs`、`../../test/brick-spatial-planning.test.mjs`；更新 README 的验证状态，新增本报告。其余为独立实验产物。历史失败 Trace、Analysis、Review、正式后端和 Generator V3 未修改。

## 停止点与后续

本例布局基本正确，本轮到此停止，不继续付费调用，不开发 Geometry Execution 或 Build Order。后续若继续，优先对本次固定计划做确定性网格候选、对称朝向与接口配对验证，再使用共享几何检查碰撞并接入 Viewer；不需要先更换视觉模型。单张图的隐藏深度、实际卡接与物理稳定性仍未被验证；单个有历史证据辅助的案例也不能证明对其他模型的泛化能力。
