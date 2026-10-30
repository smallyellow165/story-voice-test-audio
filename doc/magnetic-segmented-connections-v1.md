# Connected Construction · 分段边连接 V1

本轮将正长度部分边接触接入通用几何链路，算法版本 `planar-outline-v4`，连接规则 `segmented-edge-v1`。保留五个 Profile、镜像 Pose、Review/Selected/URL/历史 Trace；EPS=1e-7、轮廓 RMS≤0.300、SAT 面积碰撞标准均未改变。付费 Vision / LLM 调用 0。

## 玫瑰花：实际几何关系

输入仍是 Source `5fc64c5c…`、Analysis `ec08916f-a0d5-4be7-964e-f63a52df22b9`、Review `836c266b-1b94-40c9-aa96-a7631cd94d3d`，Review hash `770ffa53b109e65f3018ca9fdb99794411b4d1b2ff906687988ab86021c573e8`。没有修改这些数据。

执行尺度保持 `113.01839999999993 px/标准单位`，世界坐标 X 向右、Y 向上，标准正方形边长为 1。

### 原 Review 轮廓

- P2 底边长约 1.999299；P4/P6 顶边与之基本平行，投影接触长度分别约 1.000000 / 1.008409。
- 两条轮廓线相隔 **0.008644610** 标准单位，约 0.98 图片像素，超出严格 EPS，原始轮廓不能直接认定为已连接。候选生成可通过刚体对齐消除这类轮廓间隙，仍需完整 Validator。
- P5 没有与 P2 构成正长度共线边，仅有顶点邻近；不登记磁力边连接。
- 原轮廓的 P2/P1 面积重叠 **0.461890119**、P2/P3 **0.459762687** 平方标准单位。P2 底边与 P1/P3 底边虽然共线，但内部位于同侧，不能登记为合法吸附。

这些是已保存轮廓的实际几何测量。P2 的隐藏底角在原 evidence 中明确是估计值，不能据此断言实物必然层叠，也不能把这类大面积交叠当成小于 EPS 的绘图误差。要区分真实层叠、Profile 选择及隐藏轮廓误判，需要人工核查原图证据，本轮未替用户改数据。

### 真实 V4 搜索结果

| 指标 | V3 整边基线 | V4 分段连接 |
| --- | ---: | ---: |
| 状态数 | 13 | 132 |
| 边对齐尝试 | 708 | 23422 |
| 合法完整 Candidate | 0 | 0 |
| Top 1 P2 RMS | 1.742852590 | **0.017997197** |
| Top 1 失败阶段 | outline | **geometry** |
| 是否预算耗尽 | 否 | 否 |

V4 的一次 trial 表示实际构造的离散偏移 Pose；旧计数主要是边对检查。预算仍为 6000 状态 / 100000 次尝试，没有调大。

Top 1 是真实 14/14 几何尝试：P2.e0→P4.e1，接触长度 **0.988494287**，RMS `0.01799719681493965`。该摆放已接近原图，而非旧版花头左上位置。仍发生区间重复占用及 P2/P1、P2/P3 等面积碰撞，不能应用为 Candidate。

**Diagnostic #3** 保留了真实的一长边接两短边尝试：P2.e0 同时接触 P4.e1 和 P6.e2，RMS `0.06076446526555705`。

P2 Pose：

```json
{"x":2.5127306704041144,"y":-2.858707471570377,"angleRad":4.440892098500628e-16}
```

| 相邻边 | 段长 | P2.e0 的归一化区间 |
| --- | ---: | --- |
| P4.e1 | 1.000000000 | [0.001518336837, 0.501518336837] |
| P6.e2 | 0.996963326 | [0.501518336837, 1.000000000000] |

两段在同一点相接，互不重叠，方向相反且严格共线。世界接触线约 Y=-2.858707472；P4 段从 X=2.515767344 到 3.515767344，P6 段从 3.515767344 到 4.512730670。此处“段方向相反”是两零件各自的有向边反向，不代表这两个区间之间需要反向。

该候选的真实剩余阻碍：

- P4.e1、P6.e2 的相应区间已被 P1/P3 的短边占用，新增 P2 在同一侧再占用会触发 `EDGE_OCCUPIED`。
- P2/P1 面积重叠 **0.477674185**，P2/P3 **0.450542511** 平方标准单位。
- P2 与 P1/P3 的共线底边内部同侧，触发 `EDGE_CONTACT`。
- 该方案没有 P2/P4/P5/P6 的内部面积重叠；P5 没有正长度共线连接。

这说明分段连接已经实际搜索到，剩余失败不再是“2 和 1 边长不等”。原几何验证正确拒绝了碰撞与非法占用。

此轮有限离散搜索没有找到 14/14 合法解。**不再用旧整边证明宣称新规则下全局无解。** 当前证据指出轮廓/空间布局冲突；不能证明所有连续偏移和全局布局都已穷尽。

## 通用几何规则

`edgeContact` 计算严格共线边的正长度交集；几何重合区间不单独代表有效连接。Validator 进一步要求：

1. 两边均为 Profile 的 enabled 边。
2. 端点到彼此直线距离均不超过原 EPS，正长度交集大于 EPS。
3. 有向边反向，两个严格凸多边形的内部位于线的相反侧。镜像时维持原局部 e0/e1/e2 身份，反转世界边方向。
4. 原 SAT 内部面积碰撞检查仍通过；部分边不能绕过它。
5. 在每条边上记录占用区间；只拒绝交集长度超过 EPS 的重复占用。区间端点相遇、共线多边、多个端点重合均允许。
6. 只有顶点接触不生成连接；连接图按合法正长度段构建。

一条长边可以连接多条不重叠短边，也可以留空隙。不同长度和同长度错位边都适用；不涉及磁极、磁力、承重或物理稳定性。

## 数据、保存和 Build 兼容

完整整边连接保留旧 `Connection` 对象形式 `{a:{tileId,edgeId},b:{tileId,edgeId}}`。部分连接增加可选 `contact`：

```ts
{
  aRange: [startFraction, endFraction], // 相对 a 的规范有向边，范围 [0,1]
  bRange: [startFraction, endFraction], // 相对 b 的规范有向边，升序
  start: [worldX, worldY],
  end: [worldX, worldY],
  length: number
}
```

区间冲突比较转换回世界长度，使用原 EPS。来源依旧是 Profile + Pose，修改 Pose 后由同一 Validator 重新推导连接，不保留悬空手工连接。

Assembly 结构/旧 Pose/版本及不可变 source hash 机制保持不变。历史合法完整整边作品和 Build 可继续加载；以前无效的部分边布局现在可以成为合法新作品。

新含部分连接的 Build 使用 `segmented-frontier-v1`（Flat 手工分段作品为 `segmented-component-frontier-v1`），anchor 增加可选 `contact:{ownRange,targetRange}`，绑定已有实例与边 ID。导入时对照冻结 Assembly 重新计算区间，数值只容许原世界 EPS 的尾数差异；错误区间、假连接、来源不一致继续拒绝。旧完整整边教程继续使用原生成器版本。

Assembly 与 Build 的连接高亮都只画真实接触段，避免把一段接触画成整条长边。

## Reconstruction 与 Snap 使用一致的候选能力

共享 `segmentAlignments`：旋转/镜像/平移使边反向共线，再枚举有限的沿线偏移：

- 端点对齐。
- 边中心对齐。
- 依据 Review 轮廓质心求该方向下最佳沿线偏移。
- 现有共线顶点/区间分界端点提供的偏移提示。

每个 Pose 均由真实 Profile 计算，重新检查 EPS、RMS、SAT、占用、连通和 Review 关系；没有将 Review 轮廓直接当成最终作品，没有连续无约束平移网格，也没有玫瑰花/P2 专属分支。

Snap 沿用屏幕捕获距离和旋转窗口，但提交仍通过严格 Validator。在相近捕获分数内优先完整覆盖短边/闭合连接，避免普通整边拼接因手抖滑成两个细小部分连接；明显错位的真实部分连接仍保留。这个排序只影响交互捕获，不改变几何容差。

Flat Mosaic 不增加分段候选生成策略，继续原等长整边生成方式；共享 Validator、Assembly 和 Build 可理解新几何。Trace 分别记录 `bounded-segment-offsets-v1` 与 `whole-edge-offset-v1`，不掩盖策略差异。玫瑰花 Flat 仍为原 16 状态 / 264 次尝试 / 0 Candidate。

## 旧诊断与新诊断的适用范围

- 保留 `fitConnectedPair` 和 `connectivityAudit`。它们的下界仍是“等长完整边连接”问题的结果，新增 `connectionModel:'whole-edge-v1'` 和适用范围说明，不用于新规则的准入或剪枝。
- V4 执行保存 `search.parameters.connectionModel:'segmented-edge-v1'`。旧记录缺少该字段时，UI 按 `whole-edge-v1` 标示。
- `segmentAudit` 保存原 Review 轮廓与独立 Profile 拟合的接触测量、线偏差、方向、重叠面积/多边形。0.1 单位的 proximity window **只选择显示哪些近邻测量，不参与连接接受**。
- Diagnostic Top 10 来自真实搜索。每条实际连接包含偏移、区间和规则版本；记录 geometry/outline/relation 的真实失败。
- 排名仍是有限代表项，新增多段连接代表桶，避免“一长边接多短边”的真实尝试被重复低 RMS 的单段摆放挤掉。
- 搜索诊断中的 `overlapAreas` 是对实际 Pose 的裁剪面积复核，标记 `diagnostic-recheck`，不伪装成搜索过程新试次。只为保留的 Top 10 计算并限量保存。
- 历史 Snapshot 原始 Validator/Trace 不改写；叠加视图明确区分“历史执行规则”与“当前复核规则”。原始历史 JSON 始终可查看。

本轮不存储全部 23422 个尝试；只保存 Top 10 和必要输入/统计/测量。历史列表仍剥离大 Trace/Diagnostic 数据。

## UI 验收

1. 用现有玫瑰花 Review，在 Connected 点击“生成几何重建”；应看到 `planar-outline-v4` / `segmented-edge-v1`、132 状态 / 23422 次尝试及 0 Candidate。
2. Diagnostic #1 →“对齐 / 镜像叠加”：P2 接近原图，RMS≈0.018，显示接触段、红色面积重叠和具体拒绝代码。
3. Diagnostic #3：看同一 P2.e0 上 P4/P6 两段接触，RMS≈0.061，区间/段长与 P1/P3 碰撞证据。它仍是 Invalid，不能应用为作品。
4. Trace / Raw → Geometry Execution：查看实际 `attemptedConnection.contact`、`overlapAreas`、`segmentAudit`；旧 `connectivityAudit` 的说明明确限定旧规则。
5. 原有镜像/整边对比、历史 URL、刷新、新标签、Back、Catalog 继续可用；当前计算反事实不插入历史 Top 10。
6. 在 Assembly 中将一个边长 2 的大等边三角形底边与两个相邻标准方片的顶边拼接：应成为连通合法作品；连接线只标各自的接触区间。保存并生成 Build，验证分段步骤、区间高亮、导入/导出和刷新恢复。

生产验收前端在 5175，真实 API 在 5174。现有用户 5173 后端未被擅自重启，需正常重启开发服务后加载 V4；仅刷新前端不会替换 Node 已导入的几何模块。

## 修改文件

- `geometry.ts`：区间连接、占用、连通、共享偏移候选与 Snap。
- `build-plan.ts`、`BuildPlayer.tsx`、`main.tsx`：区间引用、生成器版本、严格校验、区间高亮及相关操作文字。
- `SupportedTiles.tsx`：更新连接能力 Hint。
- `intake/reconstruct.ts`、`contracts.ts`、`execution-trace.ts`：V4 搜索、实际接触 Trace、失败归因、多段代表项与面积证据。
- 新增 `intake/segment-audit.ts`；更新 `connection-fit.ts`、`connectivity-audit.ts` 的旧规则范围。
- `alignment-inspection.ts`、`AlignmentView.tsx`、`ImageIntake.tsx`：分段对比、区间/面积可视化、规则版本与关系文字。
- 新增 `test/magnetic-segmented.test.mjs`、`scripts/verify-magnetic-segmented.mjs`、package 测试命令。
- 更新原有几何/Build/镜像/Trace/准入测试中“所有部分边必须拒绝”或“当前必须仍输出 V3 统计”的过时断言；保留完整整边合法性测试及真实旧失败证据。
- 新增冻结的真实 V3 Connected/Flat fixtures，校验原始 hash，不引入旧算法或运行时 fallback。更新对应浏览器断言。

## 测试及限制

94 项单元测试通过（新增 7 项通用分段测试），含 unequal/equal partial、长接两短/留空隙、端点、碰撞、相反侧、区间冲突、旋转镜像、Snap、真实 Reconstruction 正向 Candidate、Origin 正式接入、Build/存档、坏区间及原始历史保护。TypeScript、生产构建、diff 检查通过；构建仍有既有大 bundle 提示。

浏览器结果和最新执行 ID 在完成后追加。浏览器测试只追加新的 Review/Execution（若脚本需要），不改写原始记录或 Selected，不调用模型。

限制：仍为二维零厚度潜在边吸附几何；不模拟磁铁分布、物理稳定性或层叠。离散候选不是连续全局完备搜索。玫瑰花仍未得到可采纳的 14/14；需要核查估计隐藏轮廓及其空间关系，不能因为部分边规则已支持就忽略大面积交叠。

## 最终验收记录

- 最新持久执行：`7274e2c2-9353-4382-b0b6-6cbb60583227`，Diagnostic #3 为一长边接两短边的真实失败布局。
- 专项最后一次浏览器运行逐字节核对了运行前 **587** 个已有历史 JSON；全部不变，Selected 不变。
- **11 组浏览器通过**：segmented、mirror、trace、connected-audit、review-reconstruction、tiles、build、mosaic、panels、relative-size、catalog。最终 Snap 修复复验了旧 6 块房子、7 条连接和指针抖动；新区间 Build 与分段专项在最终构建上再次通过。
- 单元 **94/94**、TypeScript / 生产构建 / `git diff --check` 全部通过；付费模型调用 **0**。
- Inspector 汇总也已修正为跨已搜索分支的全局最小观测值：P2 14112 个边接触对齐，最小 RMS 0.018，失败为几何/关系检查；不误显示最后一个失败分支的 0.061。

[打开本轮 Diagnostic #3](http://127.0.0.1:5175/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&reconstructionId=7274e2c2-9353-4382-b0b6-6cbb60583227&candidateId=diagnostic-3&observationId=p2&rightTab=inspector)。

截图：`/tmp/magnetic-segmented/rose-two-spans-collisions.png`、`assembly-one-long-two-short.png`、`build-clipped-interval.png`。最终测试明细：`/tmp/magnetic-segment-tests.log`、`/tmp/magnetic-segment-final-browser.log`、`/tmp/magnetic-segment-regression-*.log`。
