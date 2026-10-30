# P3 / P6 整边连接与镜像诊断 V1

2026-10-30。使用已保存真实数据；Vision / LLM 调用 0。原始 Analysis、Review、Selected、历史 Reconstruction 均未修改。新执行追加为新 Reconstruction。

## 可复现输入

- Source：`5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`
- Analysis：`ec08916f-a0d5-4be7-964e-f63a52df22b9`
- Review：`836c266b-1b94-40c9-aa96-a7631cd94d3d`
- Review hash：`770ffa53b109e65f3018ca9fdb99794411b4d1b2ff906687988ab86021c573e8`
- 原 Connected Reconstruction：`446d68f3-103f-46e2-b0ef-d6505f21ffeb`
- Reconstruction hash：`e70ecb8729f388fa0ee4d78c2b6358dba54a5e73e989425819e9d76c3524d850`
- `diagnostic-1`：trial 468 / state 10；11 块，未放置 P1/P2/P4；历史 `mirroring:false`。
- 冻结的完整历史执行位于 `test/fixtures/magnetic-intake/rose-p3-p6-connected.json`，测试校验原始 content hash。

坐标：标准正方形边长 1，图左上为原点，X 向右、Y 向上。执行统一尺度 `113.01839999999993 px/unit`；未改为 Matcher 的独立尺度。

## 旧失败的实际几何

P3 为 `tall-right-triangle@1`，局部 `(0,0),(1,0),(0,2)`；e0 长 1、e1 长 √5、e2 长 2。P6 为 `equilateral-triangle@1`，三边均长 1。两条连接边均 enabled。

| 边 | 世界 a | 世界 b | 长度 / 方向 |
| --- | --- | --- | --- |
| P3.e0 | `(3.5259285213735136,-2.8587074715703764)` | `(4.525928521373514,-2.8587074715703764)` | 1 / 0 |
| P6.e2 | `(4.525928521373514,-2.8587074715703764)` | `(3.5259285213735136,-2.8587074715703764)` | 1 / π |

两个端点的反向误差都是 0，严格整边连接成立。原始两块与完整 11 块子布局均 `draftValid=true, valid=true`，无碰撞或占边错误。失败来自搜索的图像轮廓 RMS 限制，而非几何连接规则。

旧 P3 Pose `(x=3.5259285213735136,y=-2.8587074715703764,angle=0)` 把长直角边放在左侧；Review 的长直角边在右侧。短边固定后，旋转和平移无法交换不等长直角边的手性。

旧顶点误差距离为 `0.0730940895 / 0.0629430662 / 1.0191279857`。第三顶点位于 X=3.525929，观测 X=4.512263；横向错开约 0.986335。RMS 为三项平方均值开方，精确重现 `0.5910235265278042`。

## 镜像实算

保持 P6 和其余 10 块 Pose 不动，将 P3 局部 X 取反，再旋转/平移，对齐同一个物理 e0：

```json
{"x":4.525928521373514,"y":-2.8587074715703764,"angleRad":0,"mirrored":true}
```

| 计算 | RMS（标准单位） | 严格 Geometry Validator |
| --- | ---: | --- |
| 独立最佳非镜像拟合 | 0.21459162940236026 | 未约束 P6 连接，不代表可行连接 |
| 独立最佳镜像拟合 | 0.08871130202158427 | 未约束 P6 连接，不代表可行连接 |
| 旧实际 e0→e2，非镜像 | 0.5910235265278042 | 两块及 11 块均 valid；搜索 RMS 拒绝 |
| 镜像 e0→e2，P6 固定 | 0.1583840162363413 | 两块及 11 块均 valid；通过 RMS≤0.300 |

镜像后的顶点距离 `0.0629430662 / 0.0730940895 / 0.2568110479`。仍有约 0.256 的顶端高度误差：观测高度约 1.805，Profile 高度为 2，且既定 P6/连接短边较观测上移约 0.061。不能把剩余误差都归因于镜像，也未修改 Profile 来消除它。

所有等长 enabled 边组合均实算（P3 只有 e0 与 P6 边长相等）：

| P3 / P6 | 非镜像 RMS | 镜像 RMS | 11 块上下文 |
| --- | ---: | ---: | --- |
| e0 / e0 | 1.7865409434234036 | 1.6972539014521508 | 均出现碰撞/占边错误 |
| e0 / e1 | 1.6234833141411766 | 1.7114330095997023 | 均几何 valid，但 RMS 超限 |
| e0 / e2 | 0.5910235265278042 | 0.1583840162363413 | 均几何 valid，镜像最接近原图 |

结论：主要根因是 Geometry Execution 的 Pose / 搜索缺少镜像域。边编号、连接能力正常；Review 支持镜像手性但仍有测量/规格近似误差。

## 最小通用修复

- `Pose.mirrored?: boolean`：先镜像局部 X，再旋转，再平移；旧 Pose 缺省 false。
- 保留 e0/e1/e2 的原局部顶点对身份。镜像时只反转世界边的有向端点，使内部仍在有向边左侧；`matched()` 继续严格要求反向端点完全重合。
- `alignEdge`、旋转、吸附、Assembly、Validator、Candidate Viewer、Build 全部使用同一 `vertices/edges/transform`。翻面以顶点中心为轴，走既有提交/拒绝/撤销路径；Build 保留 Pose 并显示翻面说明。
- `planar-outline-v3` 在既有拟合与边对齐循环枚举手性；只对无法用旋转表达的镜像几何/可连接边分布扩展搜索域。现有四种对称 Profile 不产生重复域，tall-right 两种域都搜索。显式 `mirroring:false` 用于原域确定性回放测试，不是第二套引擎或失败 fallback。
- EPS=`1e-7`、RMS=`0.300`、碰撞、整边、占边、预算和关系规则均不变；五个 Profile 未改。历史版本与哈希保持原值。

## 新搜索的真实结果

| 模式 | 状态 / 边对齐尝试 | 结果 |
| --- | --- | --- |
| Connected | 13 / 708 | 0 完整合法候选；真实已接受 13 块，P1/P3/P4 均可放置。Top 1 包含第 14 块 P2 的失败尝试，不能称为 14 块已接受作品。 |
| Flat Mosaic | 16 / 264 | 0 完整合法候选；局部组件可解，组合 13 块时发生几何冲突，P2 尚未加入。 |

Connected Top 1：P2.e1→P1.e2，intent uncertain，长度均 2，RMS `1.742852589630778`，在轮廓关卡失败；另一 P2.e1→P3.e2 为 `1.7666565628681394`。不是 unsupported 准入或新增 Profile 没有连接边。P2 独立拟合 RMS≈0.001018，很接近图片；它与周围件的平面无重叠/整边连接同时成立仍有困难。当前有限搜索无解不等于数学上穷尽无解。

Flat Top 1：原图位置锚定的两个局部组件组合后，实际 Validator 报 `OVERLAP s1/p6`、`s1/p5`、`s1/p4`，附带两个未连组件的 DISCONNECTED（Flat 允许独立组件，阻断的是前三项内部重叠）。下一步应核查组件相对位置、轮廓和 P2 的连接意图/遮挡证据；不应再改 P3 的短边规则或放宽阈值。

新持久执行示例：Connected `bb305b8c-2b1b-436a-b50c-1c1b8941415d`，Flat `d51b8639-6093-435c-bdc7-9bec104abdfa`。每次执行生成独立记录。

## UI 与持久化

1. 打开原 Reconstruction URL，候选选择 Diagnostic #1。
2. 中栏点击“对齐 / 镜像叠加”。灰虚线=Review，红虚线=历史实际 P3，绿色=固定 P6，蓝色=对比 Pose，橙色=顶点残差；连接边标注 P3.e0 / P6.e2。
3. 下拉切换“非镜像 e0→e2”与“镜像 e0→e2”；查看 RMS、pair/context valid、逐顶点 ΔX/ΔY/距离，展开 JSON 查看完整端点、独立拟合与 Validator。
4. “返回实际布局”恢复原 11 块 Candidate Viewer。对比方案明确为计算反事实，不能应用为正式 Candidate，也不混入历史 Diagnostic Top 10。
5. 点击“生成几何重建”执行 V3，新历史中可检查 P2 或组件碰撞的实际失败布局。Assembly 的“翻面选中”走常规校验，碰撞会拒绝，支持撤销和保存。

原 URL（host/port 按本地服务替换）：

`/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&reconstructionId=446d68f3-103f-46e2-b0ef-d6505f21ffeb&candidateId=diagnostic-1&observationId=p3&rightTab=inspector`

历史 Trace / Top 10 原样持久化；新 V3 Pose/Trace 通过原不可变 Reconstruction 保存，Assembly/Build 通过原存档保存。对齐对比由冻结的 Profile/Review/尺度/Pose 确定性重算，未另写历史：只读 API `GET /api/magnetic-intake/trace/reconstructions/:id/alignment/:diagnosticId`。刷新回到历史实际尝试，下拉对比选择不写 URL，不要求恢复。

## 变更文件与测试

核心：`geometry.ts`、`intake/reconstruct.ts`、`intake/contracts.ts`、`intake/execution-trace.ts`。
诊断：新增 `intake/alignment-inspection.ts`、`intake/AlignmentView.tsx`；接入 `intake/ImageIntake.tsx`、`style.css`、`server/magnetic-intake.mjs`。
一致性：`main.tsx` 翻面编辑、`build-plan.ts` 翻面说明。
验证：新增 `test/magnetic-mirror.test.mjs`、真实历史 fixture、`scripts/verify-magnetic-mirror.mjs`；更新旧刚体域回放与 V3 Trace/准入浏览器断言、浏览器导航 helper、package scripts。保留已有未提交的 Trace V1 等修改。

- `npm run build`（含 TypeScript）：通过。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs`：81/81 通过。
- 专项浏览器：旧 trial 468 实际叠加、镜像边重合、逐点残差、严格验证、Raw API、刷新/新标签/430px、Assembly 保存/加载、翻面/撤销、Build 播放通过；历史文件逐字节未变，Selected 未变，0 paid calls。
- Trace 与 Review→Reconstruction 浏览器：通过；两模式真实 V3 Top 10、10 个不同布局、历史 URL/Back/Draft/来源 Hash 通过。
- 其他相关浏览器回归结果见下方追加记录。

限制：没有透视校正/轮廓补全/遮挡建模；镜像不代表磁极或物理稳定性；旧客户端不认识新 Pose 的可选字段；旧历史不会自动重跑。完整玫瑰花依然不合法，需进一步审查 P2 和组件位置证据。当前诊断只反映有限搜索，不宣称穷尽所有解。

浏览器回归追加：原作品拖拽/吸附（tiles）、Build、17 块 Flat Mosaic、Relative Size Matching、全局 Catalog、三栏与上下分栏（panels）、Workflow UI 均通过。没有运行会更改实际 Selected 映射的星号写入测试；该机制由既有单元测试及真实浏览器只读恢复检查覆盖。

最终：Review toolbar 回归也通过，合计 11 组浏览器测试通过。现有用户 5173 后端进程仍为 `planar-outline-v2`，未擅自终止；5175 生产验收前端代理至已重启的 5174 V3 后端。日常使用 5173 需要重启该后端进程；仅刷新 Vite 前端不会热替换服务端已导入的 Reconstruction 模块。
