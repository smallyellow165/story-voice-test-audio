# Connected Reconstruction Search V1 / planar-outline-v5

本轮新增全局平移配准及搜索效率优化，旧 V1–V4 Snapshot / Trace 不重算、不迁移。Profile Registry、Review、Selected、Validator、Snap、Assembly、Build 几何规则不变。RMS 上限仍为0.300，EPS 仍为1e-7，预算仍为6000状态／100000次尝试。

## 全局配准

新 Connected 搜索在接入每块零件时，对整个已连接布局求同一个平移；不缩放、不拉伸、不改变相对旋转、镜像或任何单片的相对位置。V1 不增加整体旋转搜索。

固定朝向后，每块轮廓 RMS 可写成：

`RMS_i(d)^2 = q_i + |d - c_i|²`

`q_i` 为去质心后的形状／方向残差，`c_i` 为观察与当前几何的质心差。因此 RMS≤0.300 对平移 d 的可行范围是一个圆盘，整组同时合格等价于所有圆盘相交。

算法先测最小均方误差的共同平移；若它超出某块限制，则检查圆盘边界投影、圆盘交点及数值稳定的内部点，选取共同可行且尽量接近均方最优的平移。所有准入最终使用真实 Profile/Pose 顶点重算 RMS，严格比较原来的0.300；数值边界构造保护不会放宽接受阈值。成功后仍运行完整 Validator 和全部已具备两端的 Review connect/separate 约束。

配准后的**整组 Pose**进入搜索放置域、后续扩展及评分。它不是显示修正。Diagnostic 中的接触线端点同步平移，归一化接触区间和长度保持原义。正式候选继续按原方式平移到 Assembly 原点；Trace `acceptedCandidates` 保留归一化之前的图片坐标系 Pose 和逐块误差，防止混淆图片配准与作品坐标。

Palm 历史 Diagnostic #1 的反例由独立测试读取冻结的全部14块 Pose：原最大 RMS 0.309939618；算法自动求得平移约(-0.0142943,+0.0628327)，最大 RMS 降为0.257283351，整体 RMS 从0.115095753降至0.095366451。Validator 仍合法，13条连接、相对位姿、接触长度及区间保持一致。它不依赖手工指定调查中的平移量。

## 搜索效率

- 按当前放置域对等价物理几何去重，包含 Profile ID/Version、轮廓及实际启用边的位置。不会把同轮廓但连接边配置不同的姿态混为一谈。去重发生在尝试预算计数之前。
- 状态签名消除共同平移，保留真实相对几何和连接边。签名坐标精度1e-10，远细于 Validator EPS，不增加验证容差。
- 对轮廓方向计算缓存的中心化残差。如果残差已经超过0.300，任何共同平移或边上滑动都无法修复这一方向，整组偏移提案无需生成。
- 原来的固定质心距离3，替换为必要条件：观察质心距离≤双方 Profile 质心半径之和+2×RMS上限。该边界来自连接点及质心误差的三角不等式；动态大尺寸 Profile 不再被固定距离误排除。
- 已有 connect 证据优先，其次 uncertain，再按观察局部距离排序；不因为置信度低或没有明确关系就删除候选。
- Connected 逐个按需构造完整放置域，不先为全部待放零件枚举所有选项。可选连接顺序失败后可以尝试推迟该零件、让其他零件先提供锚点。单个放置域内不使用新增 beam 或候选数量硬裁剪。
- Flat Mosaic 保留原有模式及全边搜索，没有增加配准或新功能。

预算语义在 V5 Trace 中明确记为 `unique-placement-before-rms-and-validator-v1`。方向族和距离必要条件预筛、等价提案、独立状态去重分别计数；原始生成提案也独立计数，不把被跳过的工作隐藏为“零尝试”。缓存和统计仅属于本次执行，Top 10 仍来自真实执行提案。

## Trace

`search.parameters`：算法策略、配准方法及预算语义。

`search.stats.efficiency`：生成提案、去重、方向族／邻居预筛、放置域枚举、配准调用与 RMS 重新达标次数；按零件汇总 uniqueAlignments 等计数。`maxExpandedPieces` 是实际展开状态最大块数；`maxAcceptedProposalPieces` 是通过准入及完整 Validator 的局部提案最大块数，区别于 Diagnostic 中包含失败试放块的数量。

`search.registrationWitness`：一条有代表性的、经配准从 RMS 不合格变成合格且通过完整 Validator 的真实搜索提案，保存 Pose、实际连接、平移、前后误差、试次／状态索引、Validator。标记为 `accepted-search-proposal`，不能代替完整正式候选。

`diagnosticCandidates[].registration`：该真实试放的共同平移、可行性、前后最大／整体 RMS 及限制零件。UI 候选选框在 V5 优先显示配准后的最大单块 RMS，避免将新试放块的低 RMS 误当成全组准入。

所有新增数据随现有不可变 Reconstruction 保存；History 列表仍剥离完整 Trace。旧 Snapshot 没有这些可选字段，不补造数据，也不改变原始算法版本或解释。

## 实际隔离验证

| 输入 | V4 | V5 |
|---|---|---|
| Palm 状态数 |71|1050|
| Palm 对齐预算 |100000，耗尽|100000，耗尽|
| Palm 最大保存 Diagnostic |14/22|19/22|
| Palm 正式候选 |0|0|
| Rose 状态数 |132|247|
| Rose 对齐尝试 |23422|3876（减少约83.5%）|
| Rose 最大保存 Diagnostic |14/14|14/14|
| Rose 正式候选 |0|0|

Palm 实际展开及通过几何准入的局部提案均达到18块；配准使1503个提案重新满足全部单块 RMS（随后仍检查 Validator）。方向预筛337092个方向族；362个等价 Pose 在计费前跳过，206个重复状态跳过。#1 的19块最大 RMS约0.292746，但试放t13后与t15、t12、t11发生面积重叠，仍非法；未放置t1、t2、t14。它没有被当作19块成功作品或正式候选。

Rose 从10046个生成提案中去重6170个，实际计费3876；首个14块 Diagnostic 仍有p2相关面积重叠、重复区间占用和同侧接触问题。没有降低标准制造成功。

以上全部使用隔离目录和真实 API；测试结束删除临时 Snapshot。正式 Review、Selected、Registry、历史 Reconstruction 不写入。重复相同输入／配置的纯搜索输出深度相等；搜索统计不记录不确定的墙钟时间。

## 验收入口与测试

在现有 Studio 的几何重建 Inspector 选 Connected Construction，使用已保存 Review 点击“生成几何重建”。新记录算法为planar-outline-v5。打开“Trace / Raw → Geometry Execution”，查看上述统计与配准证据；选择 Diagnostic 查看实际布局及既有冲突叠加。复制 URL、刷新仍读取同一个保存执行。旧历史记录继续显示原来的 V4 数据，不会自动升级。

测试命令：

```
npm run test:magnetic-search
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run build
npm run test:magnetic-search:browser
```

单元测试覆盖 Palm 冻结反例、圆盘约束／相切／零半径／不可行情况、镜像、整体配准确实进入准入、平移前后非法几何不变、标准作品、动态大 Profile、预算前去重、确定性及真实 Palm/Rose V5 搜索。既有分段连接 V4 的精确数值断言改为检查冻结 V4 fixture；V5 的执行行为由新回归独立测试。

文件：`intake/global-registration.ts`、`intake/reconstruct.ts`、`intake/execution-trace.ts`、`intake/contracts.ts`、`intake/ImageIntake.tsx`（仅新 RMS 标签含义）、`test/magnetic-search-v5.test.mjs`、`test/fixtures/magnetic-intake/palm-connected-v4.json`、`test/magnetic-segmented.test.mjs`、`scripts/verify-magnetic-search-v5.mjs`、`package.json`、本说明。现有 Profile Editor／Workflow UI 浏览器脚本的初始 Catalog 比较改为使用真实 Registry 长度，以支持用户已经保存的额外 Profile。

V1 仍是有限预算和有限边偏移采样；没有全局旋转、连续全局布局优化或完整性证明。没有实现未来 Manual Assembly / Manual Reconstruction。Palm 22/22 不是本轮成功条件，当前也没有声称它无解。

最终检查：111项 Magnetic 单元／集成测试通过；TypeScript 与生产构建通过（仍有项目原有大 chunk 提示）。新搜索 UI、旧候选冲突、Build、Selected、Review Toolbar、Workflow UI、Profile Editor 共7组浏览器验收通过。截图及机器统计在 `/tmp/magnetic-search-v5/`。正式 Palm Review／Reconstruction hash 保持不变，Registry仍为revision 1（含用户新增等腰规格），正式目录未写入V5测试记录。付费模型调用0。
