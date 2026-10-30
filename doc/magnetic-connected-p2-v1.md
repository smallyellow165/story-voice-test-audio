# Connected Construction：P2 几何诊断 V1

2026-10-30。本轮仅针对 Connected；保留 Flat Mosaic 原算法、所有 Profile、RMS 0.300、EPS 1e-7、碰撞/占边/整边规则及 P3 镜像修复。没有调用 Vision / LLM，没有修改真实 Analysis、Review、Selected 或历史 Reconstruction。

## 结论

**当前 Review 与执行尺度下，不存在同时满足每块 RMS≤0.300 和合法整边连通的 14 块布局。** 这不是根据最终失败 RMS 猜测：P2 仅有 P1/P3 两种可能的等长边邻居；即使让双方完全自由移动、旋转和镜像，最小联合 RMS 仍分别是 0.563521 / 0.563728。全作品若合法，P2 至少必须连接其中之一，但这两条必要连接均无法满足轮廓阈值。

P2 在原图附近的独立拟合 RMS 只有 0.001018；这是一个真实的 Profile Pose，却在当前 13 块布局中与 P1/P3/P4/P5/P6 内部重叠。因此“轮廓拟合正确”和“符合平面连接模型”是两项不同约束。

没有以增加搜索预算、放宽标准、强改连接意图、替换 Profile 或修改真实 Review 的方式生成 Candidate。输出仍是 0 个可采纳 Candidate；新增的是能解释根因的通用几何诊断。

## 输入与复现

- Source：`5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`
- Analysis：`ec08916f-a0d5-4be7-964e-f63a52df22b9`
- Review：`836c266b-1b94-40c9-aa96-a7631cd94d3d`
- Review hash：`770ffa53b109e65f3018ca9fdb99794411b4d1b2ff906687988ab86021c573e8`
- 修改前 V3 Connected：`bb305b8c-2b1b-436a-b50c-1c1b8941415d`
- 本轮追加执行：`14830f37-28a6-4aa9-8f0e-28b81a7fc7f8`

修改前后均为 **13 状态 / 708 次边对齐尝试 / 未截断 / 0 Candidate**。Diagnostic #1 的实际 trial 696、state 13；P2.e1→P1.e2；14 块几何摆放存在，但该 P2 的 RMS 为 `1.742852589630778`，不满足执行的图像约束。完整布局的纯几何 Validator 为 valid=true，并不代表满足了 Candidate 的全部要求。

P3.e0→P6.e2 镜像连接仍为 RMS `0.1583840162363413`，严格 Validator 合法；P1/P3/P4 已能放置。

## P2 Profile 和实际位置

Profile `large-equilateral-triangle@1`，顶点 `(0,0),(2,0),(1,√3)`，三边均长 2，三边全部 enabled。几何定义与 V1 Estimated 状态不变。

Review 归一化轮廓：

```json
[[0.5013,0.1372],[0.6439,0.3378],[0.3586,0.3378]]
```

在 792×977 图片、执行尺度 `113.01839999999993 px/unit` 下，世界轮廓为：

```json
[[3.5129642606867573,-1.1860405031393126],
 [4.512263489838826,-2.9201492854260915],
 [2.512964260686757,-2.9201492854260915]]
```

边长为 `2.001432542 / 1.999299229 / 2.001782523`。这与边长 2 的等边三角形非常接近，不能据此认定 Profile 尺寸错误。

原图附近的独立最佳 Pose：

```json
{"x":2.5126723023969975,"y":-2.9193621856959435,"angleRad":-0.00010110520677320726}
```

RMS `0.0010181661566341844`；基本水平底边、顶点向上，无须镜像。等边三角形及三个 enabled 边的镜像几何可由旋转表达；通用搜索正确地消除了这类重复镜像域。

但 Review 的 P2 evidence 明确说明两侧遮住其下方区域、底角为估计值；“Known / 已确认 Profile”不等于已证明该轮廓能在无层叠平面中与所有其他完整轮廓同时成立。P1/P2、P2/P3 的 intent 都是 uncertain，并非 connect；相关文本描述的是遮挡/重叠。P2 与 P4/P5/P6 没有明确连接约束。系统没有把 uncertain 伪造为已验证连接。

## 为什么被放到左上方

14 个现有 Profile 中只有 P1/P3 的 e2 长 2。其余正方形边长 1，标准等边三角形边长 1，均不能与 P2 的边长 2 完整连接。P1/P3 的其他边是 1 和 √5，同样不能匹配 P2。

在已接受的 13 块布局中：

- P1.e2 是左侧竖直长边，P3.e2 是右侧竖直长边。
- P2 原图侧边方向约 ±60°；原图独立拟合中的 P2 与两块侧三角形存在内部交叠。
- `alignEdge` 必须将 enabled 等长边的端点反向重合，让两块的内部处于边的两侧。把 P2 放在 P1 长边外侧便落到花头左上，而非原图中央。
- 最接近原图的实际固定邻居连接仍是 P1.e2（P2 RMS 1.742853）；P3.e2 连接为 1.766657。三条 P2 边因等边对称给出等价轮廓，不代表漏了某条特殊边。
- 这些完整外侧摆放的严格纯几何 Validator 可以通过；搜索在轮廓 RMS 阶段已将它们拒绝。Top 10 事后几何复查与搜索接受标准明确区分。

原图附近的 P2 Pose 没有被“错误碰撞”拒绝：把该真实拟合 Pose 放回冻结的 13 块状态，实际 Validator 返回 OVERLAP p2/p1、p2/p3、p2/p4、p2/p5、p2/p6，以及 P2 未连接造成的 DISCONNECTED。这个对比标为计算结果，不冒充历史搜索尝试，也不插入真实搜索 Top 10。

## 不依赖搜索锚点的必要条件检查

新增通用 `fitConnectedPair`：

1. 枚举两个 Profile 的所有 enabled 等长边对及所有不同镜像域。
2. 将它们按严格反向端点连接，形成两块刚性子布局。
3. 枚举各自轮廓的所有循环起点/正反绕序。
4. 对整个双块子布局用闭式二维 Procrustes 求全局最优旋转和平移。两块均不固定；没有使用原 root、当前邻居 Pose、扩展顺序或距离剪枝。
5. 用原 `vertices/edges/validate` 复查实际 Pose。联合 RMS 按全部顶点加权。

若每块均满足阈值 T，则 `jointRms² = (nA*rmsA²+nB*rmsB²)/(nA+nB) ≤ T²`。因此全局最小 jointRms>T 能排除该连接，无须穷举整件作品。浮点比较留出小于几何误差量级的数值余量；它不改变 Validator 或执行阈值。

| 可能连接 | 不同边/镜像配置 | 顶点对应拟合次数 | 最小联合 RMS | 最优解两块 RMS |
| --- | ---: | ---: | ---: | --- |
| P2 ↔ P1.e2 | 6 | 216 | 0.563520638707865 | P2 0.465931598；P1 0.646543708 |
| P2 ↔ P3.e2 | 6 | 216 | 0.5637283871282054 | P2 0.465550615；P3 0.647180047 |

最优双块连接本身纯几何合法，但轮廓阈值仍不满足；而且移动侧三角形还会影响其与其余布局的关系。它们是必要条件检查的真实计算证据，不是可应用的 Candidate。

所有可能整边邻居都被这个更宽松的问题排除，P2 因而在“未被必要条件排除”的连接图中孤立。其余 13 块在该图中同属一个组件。这个结论只针对当前轮廓、Profile、尺度及阈值；不宣称原物理玩具本身不可搭建，也不证明估计的隐藏轮廓就是事实。

## 搜索策略调查和修改边界

- Root 确实固定为一块正方形的独立最佳 Pose；搜索也只保留有限组解，不能声称一般情况下穷尽所有布局。
- Connected 的局部解上限 3 作用于完整组解；本次没有完成任何组，因此它不是 P2 被排除的原因。
- 两个可能长边锚点均在距离剪枝范围内，均被实际尝试。P2 的旋转、三条边以及非等价镜像情况已覆盖。
- 当前预算 6000 状态 / 100000 尝试，实际只有 13 / 708，未耗尽。
- 无 connect frontier 时按可行域选择扩展，P2 被延后到其他 13 块之后。它的确切无可行域诊断原先没有显示，因为旧诊断仅处理明确 connect frontier 的失败；本轮修复这处通用诊断遗漏。
- **没有改变候选生成、扩展顺序、锚点、剪枝、局部解数量或预算。** 双方自由拟合下界已排除任何可行的 P2 连接，针对这个输入调整这些搜索策略无法生成合法 14/14。
- 对其他输入，固定 root 等策略仍是有限搜索的限制；本轮没有证据支持为解决当前玫瑰花而重写它们。

## UI、Trace 与保存

沿用中栏 Diagnostic Viewer →「对齐 / 镜像叠加」：

- “已保存实际尝试”：原 P2 错误完整摆放与 RMS 1.742853。
- 原有非镜像/镜像边对齐选项：固定邻居的真实计算方案。
- **“原图独立拟合（未约束连接）”**：P2 RMS 0.001018，显示附近其他零件、OVERLAP 列表及 context valid=false；不绘制虚假的连接边。
- **“双方自由拟合”**：展示两块同时移动后的 Pose、镜像、连接边、各自 RMS、联合 RMS 和实际 Validator。切换 Diagnostic #2 可比较 P3 邻居。
- 折叠的 **Connected 连接轮廓诊断**：新记录的下界、孤立零件、独立拟合和几何证据；也可从 Trace / Raw → Geometry Execution 查看 `trace.search.connectivityAudit`。

旧实际摆放、原图轮廓、对比摆放使用不同颜色。旁边保留 Source 原图。对比明确标记“非历史搜索尝试”，不可进入 Assembly；其他零件保持历史 Pose，并显示 context Validator，避免把双块 valid 误当成完整作品 valid。

新 `connectivityAudit` 随新 Reconstruction 的不可变 hash/lineage 保存；历史列表继续去除大 Trace。旧记录只读对比可以确定性重算，但不写回旧 Snapshot，不伪造其执行统计。自由拟合不是原搜索的新增 trial，统计在自己的 `fittedCorrespondences` 字段；本次全图检查 80 对等长边邻居、36036 次对应拟合，几何 witness 最多保存 10 对。旧 Diagnostic Top 10 仍全部来自实际搜索。

## 手动验收

1. 使用现有玫瑰花 Review `836c266b…`，进入 Connected，点“生成几何重建”。应仍为 13 状态 / 708 次尝试 / 0 Candidate，并明确指出 P2 的必要连接条件冲突。
2. 选择 Diagnostic #1，点“对齐 / 镜像叠加”，切换上述三类方案。原图独立拟合应接近中心且出现碰撞；双方自由拟合下界约 0.563521。
3. 查看 Diagnostic #2 的 P3 方案、几何 JSON 和 Trace；P3/P6 镜像连接保持有效。
4. 刷新、复制 URL 到新标签、Back/Forward、Catalog 切换，确认 Review/Execution 来源一致。返回实际布局仍是原真实 Diagnostic，不能作为有效候选应用到 Assembly。
5. 原有合法作品的 Assembly/Build 仍可保存、播放；本玫瑰花没有被伪装成成功作品。

生产验收入口 5175：
`/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&reconstructionId=14830f37-28a6-4aa9-8f0e-28b81a7fc7f8&candidateId=diagnostic-1&observationId=p2&rightTab=inspector`

现有 5173 进程未被擅自重启，仍需正常重启开发后端才能使用最新服务端诊断；只刷新前端不更新 Node 已导入的模块。

## 修改文件

- 新增 `src/magnetic-tiles/intake/connection-fit.ts`：通用精确双块自由连接拟合。
- 新增 `src/magnetic-tiles/intake/connectivity-audit.ts`：Connected 失败输入的必要条件检查、紧凑证据与独立拟合 Validator。
- `reconstruct.ts`：无 frontier 且全部域空时补充真实失败标记；只在 Connected 未截断失败后追加只读检查。
- `execution-trace.ts`：可选类型字段，兼容旧历史。
- `alignment-inspection.ts`、`AlignmentView.tsx`：接入独立拟合/双方自由拟合、上下文碰撞叠加。Flat 不新增这些选项。
- 新增单元测试 `test/magnetic-connected-audit.test.mjs` 和浏览器脚本 `scripts/verify-magnetic-connected-audit.mjs`。
- `package.json`：相应测试命令。本报告。

## 验证与限制

- TypeScript / 生产构建：通过；既有 bundle size 提示仍存在。
- 全部 Magnetic 单元测试：**87/87 通过**，包含 6 项新测试：原失败复现、双块全域下界、近图碰撞、通用旋转/镜像/不同顶点数、关系约束不绕过、不可变 Trace/API 持久化。
- 专项真实浏览器：通过。旧失败、近图碰撞、双块自由 Pose/SVG/边、持久 Trace、刷新/新标签/Back、Catalog、430px、不能应用无效布局、逐字节历史保护、Selected 不变、付费调用 0。
- 相关浏览器回归结果在执行后追加。

仍未达到可采纳的 14/14。下一步应人工核查 P2 遮挡区域的完整轮廓，以及 P1/P3 与 P2 的真实空间关系，确定当前 2D 无层叠模型是否适用；若需要改 Review 或 Profile，必须基于新的几何证据另行明确处理。仅将 uncertain 改成 connect、增加搜索预算或保留更多局部解，都不能解除上述必要条件冲突。本轮没有擅自做这些数据修改，也未扩展 Flat Mosaic。

浏览器最终结果：专项 P2、P3/P6 mirror、Trace、Review→Reconstruction、原有拖拽吸附、Build、既有 Flat Mosaic、分栏 panels 共 **8 组通过**。新诊断文本的最终核对也已重跑专项；历史快照逐字节不变、Selected 不变，付费调用 0。最终生产构建及 87 项单元测试通过，`git diff --check` 通过。分栏测试覆盖 1024/1280/1600/1920/430 宽度与独立滚动。
