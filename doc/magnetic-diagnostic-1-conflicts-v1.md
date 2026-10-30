# Connected Diagnostic #1：实际几何冲突调查 V1

2026-10-30。本轮只调查和展示已经保存的布局，没有修改 Reconstruction 搜索、Geometry Validator、EPS、RMS 阈值、Profile、Review 或 Selected。浏览器全部只读，没有新增业务 Reconstruction / Review 写入，没有 Vision / LLM 调用。

## 确定结论

**Diagnostic #1 的真实 14 块 Pose 存在 4 处内部面积重叠、1 处连接区间重复占用、1 处同侧边接触错误。当前 Validator 与该 Snapshot 保存的 Validator 完全一致，未发现需要修复的通用 Validator Bug。**

它不是未连通或 RMS 问题：15 条可登记接触关系形成 1 个组件；Review 必须连接/不得连接的关系复核没有违例；14 块各自的轮廓 RMS 都低于 0.300，最大约 0.137600，布局 RMS≈0.066452，P2 RMS≈0.017997。连通接触图并不免除面积、区间及相反侧检查。

没有因为显示接近原图，就把 Diagnostic 改成 Geometry Valid 或允许进入 Assembly。

## 被调查的不可变记录

- Source：`5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`
- Analysis：`ec08916f-a0d5-4be7-964e-f63a52df22b9`
- Review：`836c266b-1b94-40c9-aa96-a7631cd94d3d`
- Review hash：`770ffa53b109e65f3018ca9fdb99794411b4d1b2ff906687988ab86021c573e8`
- 最新匹配截图的 Connected Reconstruction：`7274e2c2-9353-4382-b0b6-6cbb60583227`
- Reconstruction hash：`388bc90d212165ef3c8ed876bb29ce5bed286b1a694076db5de773f28d72fe37`
- Diagnostic：`diagnostic-1`，实际 attempt 3392 / state 24；全次执行统计仍是 132 状态 / 23422 次尝试。
- Profile 来自该记录自己的 `trace.input.profiles`，全部 14 块 Pose 来自 `diagnosticCandidates[0].tiles`。没有用当前 Review 轮廓或独立拟合 Pose 替代。

完整机器证据：[rose-diagnostic-1-conflicts.json](diagnostics/rose-diagnostic-1-conflicts.json)。其中包括全部 14 块 Profile ID/version/Pose、Source/Analysis/Review/Reconstruction ID/hash、原始 Validator、当前复核、交集顶点/面积/包围盒、区间和占用者、连接组件、按零件对汇总及独立拟合的单独对照。

## 当前候选的 4 处真实面积交集

单位是标准正方形边长=1 的平方单位。以下是 Profile + 已保存 Pose 的浮点几何计算值，完整精度及所有交点保存在 JSON。

| 零件对 | 交集面积 | 世界范围 X | 世界范围 Y |
| --- | ---: | --- | --- |
| P2 / P5 | 0.001057011879739278 | [3.501224957, 3.550632086] | [-2.901495300, -2.858707472] |
| P1 / P2 | 0.45348341321981867 | [2.512730670, 3.501224957] | [-2.901495300, -1.983971710] |
| P2 / P6 | 0.008660939214799157 | [3.545434702, 4.512730670] | [-2.901495300, -2.892493167] |
| P2 / P3 | 0.42958808896669254 | [3.545434702, 4.507533287] | [-2.892493167, -1.999470153] |

其中 P2/P5 是 P5 顶端跨入 P2 底部形成的小三角形，不是这个候选中的“仅点接触”；P2/P6 是底边相对位置造成的窄条形内部交叠。P1/P2 和 P2/P3 是明显较大的左右交叠区域。

不要把上一轮 Diagnostic #3 的 P1/P2≈0.477674、P2/P3≈0.450543 或输入轮廓的面积套到 Diagnostic #1；它们来自不同的 Pose。

## 区间占用：不是合法多短边被误判

真正重复使用的是 **P4.e1**，边长 1：

- P1.e0 已占用 P4.e1 的完整区间 `[0, 1]`。
- P2.e0 再占用 P4.e1 的 `[0, 0.9884942865848054]`。
- 两次占用的交集长度为 **0.9884942865848054**。
- 世界线段从 `(3.501224956988919, -2.9014953002125434)` 到 `(2.5127306704041135, -2.901495300212543)`。

这不是两条短边分别占据长边的互不重叠区间。它们在几乎整个 P4.e1 上重复使用相同位置，现有 `EDGE_OCCUPIED` 判定正确。原始 Validator 错误只列出遇到冲突时的 P4/P2；新增只读证据补齐了已有占用者 P1.e0。

## 方向错误、连接图及其他检查

另一个错误是 **P1.e0 / P2.e0**：

- 两条边 enabled=true，严格共线且有正长度重合。
- 方向分别约 `-4.440892098500626e-16` 与 `-4.440892098500625e-16` 弧度，基本都向 +X；不是反向边。
- 两块内部在接触线同侧，不能互相登记吸附连接。
- 重合长度同为 0.9884942865848054；P1.e0 区间 `[0.011505713415194574,1]`，P2.e0 区间 `[0,0.4942471432924026]`。

因此这是 `EDGE_CONTACT`，不是缺失 enabled 边，也不是部分接触长度不足。

全部实际 Validator 错误按原顺序为：

1. OVERLAP P5/P2。
2. EDGE_OCCUPIED P4/P2（已有占用者 P1）。
3. OVERLAP P1/P2。
4. EDGE_CONTACT P1/P2。
5. OVERLAP P6/P2。
6. OVERLAP P3/P2。

没有 DISCONNECTED、缺 Profile、非法 Pose、颜色、实例身份或其他结构错误。接触图 1 个组件，包含全部 14 块。Review 关系复核违例 0；保存执行在 geometry 阶段已拒绝，新的关系检查只是额外只读复核，不冒充当时已执行的关系接受步骤。

## 与 Review 独立拟合严格分开

独立拟合的 14 块 Profile Pose 产生 25 对潜在重叠，其中 21 对没有出现在当前 Diagnostic 的实际重叠中：

`l1/l2, l1/s2, l2/s2, l2/s3, p1/p3, p1/p4, p1/p5, p2/p4, p3/p4, p3/p5, p3/p6, p4/p5, p4/s1, p5/p6, p5/s1, p6/s1, r1/r2, r1/s3, r2/s3, r2/s4, s2/s3`。

这些叶子、方片或花瓣的独立拟合提示不是 Diagnostic #1 的实际错误。当前 Candidate 的绿叶和花茎没有被这些输入提示标红。新的纯几何函数 `inspectLayoutConflicts(tiles,profiles)` 不接收 Review 参数；单元测试故意修改 Review 轮廓和移除拟合 seeds 后，当前冲突报告与红色交集仍不变。

## 原因归类

- **实际 Pose 冲突确定存在**，不是在独立拟合提示上推测出来的。
- 两处大的侧花瓣交叠与 Review 中“P1/P3 遮住 P2、隐藏底角是估计值”的说明相符，提示需要核查完整轮廓/空间解释。
- 两处小交叠属于这个具体摆放的位置误差；它们同样超过当前严格几何接受标准，不能因为整体轮廓接近而忽略。
- 分段连接规则未将合法相邻区间误判：无重叠的一长边接两短边测试无占用冲突；这个候选确实重复占用了同一区间。
- 现有证据不足以确定真实实物层叠、Profile 规格错误或应如何改 Review。本轮没有自动允许交叠，也没有改 Profile、Review 或搜索来制造成功。

## 低成本可视化与只读 Trace

完整 Candidate Viewer 默认开启“实际冲突”：

- 红色半透明填充只来自当前 Diagnostic 的真实多边形交集，并高亮涉事边界。
- 橙色粗线为重复占用的实际 P4.e1 子区间。
- 紫色虚线为 P1.e0/P2.e0 的同侧重合段；它没有被伪造成另一个红色面积。
- Inspector 首先显示“当前 Diagnostic 实际冲突”，列出 6 项错误、面积/区间长度、双方边 ID、组件数和关系复核结果。
- 点击条目定位涉事零件；“查看全图”返回完整 14 块。即使已关闭覆盖层或正在对齐/镜像对比，点击实际冲突也会回到真实候选视图。
- 原图选择联动仍保留；覆盖层不截获指针事件。“对齐 / 镜像叠加”继续保留原功能。
- 搜索/输入诊断折叠保留，标题明确不是当前候选错误列表。独立拟合的 25 对提示单独折叠，不用于红色覆盖层。
- Trace / Raw 新增紧凑的“Candidate 冲突”页签；原 Parts/Review、Spatial Planning、Geometry Execution 原文继续可查。

只读 API：

`GET /api/magnetic-intake/trace/reconstructions/:id/conflicts/:diagnosticId`

结果绑定不可变 ID/hash，标记 `read-only-recheck-of-saved-diagnostic-poses`、`persisted:false`、`adoptable:false`。`persisted:false` 表示未回写 Snapshot；本报告附带的 JSON 是另存的只读诊断工件。刷新或重开历史时从原冻结输入确定性重算，不引入新 Snapshot、数据库或 fallback。

## 手动查看和代码级复现

[打开 Diagnostic #1 验收地址](http://127.0.0.1:5175/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&reconstructionId=7274e2c2-9353-4382-b0b6-6cbb60583227&candidateId=diagnostic-1&observationId=p1&rightTab=inspector)。

1. 选 Diagnostic #1，默认直接看到全图红色交集和橙色区间。
2. Inspector 点 P1/P2 面积条目或 P4.e1 占用条目，再点“查看全图”。切换“实际冲突”只影响显示，不能使布局成为合法 Candidate。
3. Trace / Raw → Candidate 冲突，查看完整当前复核和单独的独立拟合对照。
4. 切换 Diagnostic、刷新、复制 URL、新标签、Back、Catalog；确认不会混用其他候选的冲突。
5. 原有 Geometry Valid Candidate 没有 Diagnostic 覆盖层，仍走原 Assembly/Build 流程。Diagnostic 仍不能应用为正式作品。

命令行不运行搜索：

```bash
npm run inspect:magnetic-candidate -- 7274e2c2-9353-4382-b0b6-6cbb60583227 diagnostic-1 /tmp/rose-conflicts.json
```

命令首先检查原 Snapshot content hash，再读取真实 Pose/Profile 复核。

5175 为本轮生产构建验收前端，代理实际 API 到 5174。已有用户 5173 后端未被擅自终止；如使用日常开发端口，需要重启后端才能加载新增只读 Trace 路由，单纯刷新前端不会更新已导入的服务端模块。

## 修改文件与验证

新增：

- `intake/candidate-conflicts.ts`：纯实际布局复核、面积/占用者/边方向/组件/关系/独立对照。
- `intake/DiagnosticConflicts.tsx`：SVG 覆盖层和紧凑 Inspector。
- `scripts/inspect-magnetic-candidate.mjs`：只读 CLI。
- `test/magnetic-candidate-conflicts.test.mjs`、真实 V4 Snapshot fixture、专项浏览器脚本。
- 本报告与 `doc/diagnostics/rose-diagnostic-1-conflicts.json`。

接入修改：`AssemblyPreview.tsx`（可选 overlay/focus，正常调用不变）、`AlignmentView.tsx`、`ImageIntake.tsx`、`TraceViewer.tsx`、`style.css`、服务端只读 Trace 分支及 package 测试命令。三个已有浏览器脚本改为按 `[data-preview-piece]` 数真实零件，避免把新增红色交集多边形也数成磁力片。

**未修改** geometry.ts、reconstruct.ts、Profile Catalog、Review Schema、Snapshot 保存、Selected CAS、RMS 或 EPS。

验证：100/100 单元测试、TypeScript/生产构建、diff 检查通过。新增 6 项测试覆盖真实 14 Pose/hash/面积、占用者、方向、独立拟合隔离、合法多段/端点/原 EPS 边界无假红区、结构错误和只读 API/历史保护。

6 组浏览器通过：candidate-conflicts、mirror、tiles、build、panels、catalog。专项只读检查了默认全图覆盖、精确 SVG 坐标、定位/全图、关闭与对比模式下重新定位、Trace/API、切候选、刷新/复制 URL/Back、430px、合法 Viewer 无覆盖层、全部历史字节与 Selected 不变；POST 0、业务 Reconstruction 执行 0、付费调用 0。

既有大 bundle 构建提示仍存在。没有进行新的玫瑰花优化或断言全局无解；本轮只说明这个已保存候选为何非法。
