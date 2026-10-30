# Review → Reconstruction：二维输入确认与真实诊断

## 根因与阻断位置

实际数据：玫瑰花 Source `5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`，Analysis `ec08916f-a0d5-4be7-964e-f63a52df22b9`，原 Selected Review `7da2f5fb-1fb1-4b70-9d6d-fe62bf2f579c`。14 块均为 Known，P1 / P3 为 `tall-right-triangle@1`，P2 为 `large-equilateral-triangle@1`；**Analysis 和该 Review 的 `sourceKind` 均仍为 `unsupported`**。

调用链：

1. `ImageIntake.saveReview()` 保存完整 `draft`，包括已有 `sourceKind`，零件匹配只更新 Observation，不自动修改整图分类。
2. 服务端 `server/magnetic-intake.mjs` 的 `reviewed()` 校验 Analysis / Source 的 Hash 和来源链，`POST reconstruct` 实际调用 `reconstruct(review.evidence, ...)`。服务端没有将原 Analysis 的分类重新覆盖到 Review。
3. `intake/reconstruct.ts` 在读取 Review 后检查 Unknown 和 `evidence.sourceKind === 'unsupported'`，直接返回 `explored=0 / trials=0`。原错误拼接 `evidence.reason`，该理由从 Analysis 继承，因而看起来像是在反复引用原始 Analysis 判定。
4. Review 原本支持整图输入类别修正，但藏在折叠的高级区域。确认零件后，缺失的整图二维确认很难被发现。

因此不是新增 Profile 没有连接能力，也不是 Review 存储或来源关联错误。修复是让已有整图确认成为显式、可保存和可恢复的审核步骤，并区分准入失败与真实搜索失败。

## 最小修复

- 将已有「输入类别」从高级区域移到 Review 主区域，用紧凑同行选择框和 InfoHint 显示。字段、枚举及保存 API 不变。
- Reconstruction 对当前 Review / Draft 仍未确认二维时显示「重建输入待确认」与「确认重建输入」按钮；按钮只返回 Review，不自动改类别、保存或执行。
- 用户核实采用部分适合二维后选择照片 / 示意图，再保存**新 Review Snapshot**；生成仍只消费该已保存 Review 的 ID / Hash / evidence。未保存修改不能生成。
- 保留 `unsupported` 和 Unknown 门槛。全部 Known、改颜色或仅保存一次 Review 都不会自动让未经二维确认的 unsupported 输入通过。
- 输入准入失败明确说明**当前 Review** 未确认、如何修正；不再把继承的长篇 Analysis 理由作为当前几何失败结论。
- 搜索失败增加本次实际尝试的连接邻居、等长边对齐数量、最小轮廓 RMS 与原阈值、统一尺度、近似布局重叠提示。界面显示状态数与对齐尝试数。
- 没有调整 `MAX_ERROR=0.300`、EPS、Profile 定义、候选域、排序、搜索预算、连接意图、碰撞或 Validator 标准。新增统计不参与候选筛选。

## 真实玫瑰花结果

浏览器从现有 Selected Review 出发，仅将 `sourceKind` 从 `unsupported` 改为 `diagram`，其余零件、轮廓、颜色、关系、原理由完全一致，保存新 Review：`836c266b-1b94-40c9-aa96-a7631cd94d3d`。该快照**没有设为 Selected**；原 Selected 的 ID、revision 与时间戳均未改变。

| 模式 | 输入未确认时 | 确认后的状态 / 对齐尝试 | 合法候选 | 搜索预算耗尽 |
| --- | --- | --- | --- | --- |
| Connected Construction | 0 / 0，输入审核阻断 | 10 / 474 | 0 | 否 |
| Flat Mosaic | 0 / 0，输入审核阻断 | 10 / 165 | 0 | 否 |

统一尺度为 **113.0184 px / 标准单位**，所有采用零件通过初始刚体轮廓拟合，之后真正进入搜索。当前最先报告的不可行放置域是 **P3 对明确连接邻居 P6**：两种模式均实际尝试 3 个等长边对齐，最小 RMS 分别为 **0.591 / 0.607**，超过保留的 **0.300 标准单位**上限。此处存在等长边，失败发生在对齐后的图像轮廓误差检查。

| 类别 | 实际证据与解释 |
| --- | --- |
| 输入审核 | 原 Review 未确认二维；显式确认并保存的新 Review 已进入搜索，未被原 Analysis 的 unsupported 再阻断。 |
| Profile 尺寸 / 刚体拟合 | 初始拟合全部通过既有阈值。独立测量 P1 RMS 约 0.0888，P2 约 0.0010，P3 约 0.2146；不能把当前失败直接归结为新增尺寸不正确。此 RMS 与 Shape / Size Score 是不同量。 |
| 轮廓与遮挡 | P2 的底角来自原 Review 中标注的遮挡估计，未重新描绘或消除不确定性。应核实实际可见边界和 P3–P6 的整边连接意图。 |
| 重叠 / 碰撞 | 原图独立拟合位置产生 22 对内部重叠（包括 P1/P2、P2/P3，也含细微相邻边界误差）。这是近似位置诊断，**不是**搜索接受的布局或 22 次碰撞剪枝；本次搜索实际碰撞/局部几何剪枝为 0，很多对齐先被轮廓阈值排除。平面拼图仍不允许正面积重叠。 |
| 连接边 | 五种 Profile 数据不变。P3 与 P6 有长度 1 的连接边；单元测试验证 Tall–Square 的长度 1 连接及 Large–Tall 的长度 2 连接均通过原 Validator。没有缺少连接边注册的证据。 |
| 搜索 / 表示限制 | 未耗尽预算不等于已枚举所有几何可能。当前搜索仍固定近似根姿态、按原图刚体误差剪枝；更关键的是 `Pose` 只有 x/y/angleRad，没有翻面，而 Shape Matcher 会比较镜像。P3 的图像朝向需要重点复核。 |

补充的只读几何测量：在相同尺度下，P3 仅旋转平移的最小独立拟合 RMS 约 **0.2146**，假设可反射后的 RMS 约 **0.0887**。这支持进一步调查翻面表示的必要性，但并不证明加入翻面就能得到完整合法玫瑰花。该测量没有添加 Profile、没有写入候选或修改主链路；本轮没有扩展 Pose / Assembly Schema。只读测量结果及复现脚本分别为 `/tmp/rose-rigid-fit-diagnostic.json` 与 `/tmp/rose-rigid-fit-diagnostic.mjs`。

下一步优先复核 P3 的翻面语义和 P3–P6 连接证据，再审查花头的遮挡与重叠是否适合严格二维平铺。需要翻面或层叠时应单独设计表示能力，不能通过拉伸 Profile、伪造连接或修改真实轮廓来强行通过。

## 数据保护与兼容

新增快照使用既有 schemaVersion、ID / Hash 和不可变存储。原 Analysis、Selected Review 及验收开始前 **423 条 Analysis / Review / Reconstruction 文件逐字节一致**。真实 Selected API 响应（含 revision）前后一致；本轮没有调用真实 Selected 写入 API。CAS 测试仅在临时目录执行。

旧的 unsupported Review 及其历史 Reconstruction 保持原样，打开旧 URL 仍恢复旧来源和旧诊断；没有回填、迁移或改写历史。新 Current URL 引用确认后的 Review，与 Selected 独立。仅打开 Source 时依旧可能恢复原 Selected unsupported Review，这是保持用户选定记录的预期行为。

## 修改文件

- `src/magnetic-tiles/intake/ImageIntake.tsx`：显式输入类别、返回审核提示、对齐次数展示。
- `src/magnetic-tiles/intake/reconstruct.ts`：准入错误文字与诊断统计，搜索规则不变。
- `src/magnetic-tiles/intake/contracts.ts`：区分输入审核未完成与无几何候选的状态摘要；未改数据类型。
- `src/magnetic-tiles/style.css`：紧凑的输入确认提示样式。
- `test/magnetic-review-reconstruction.test.mjs`：新增准入、不可变来源、Selected、实际连接、玫瑰花搜索测试。
- `scripts/verify-magnetic-review-reconstruction.mjs`：真实浏览器 / API 验收，拒绝 Vision 请求。
- `scripts/verify-magnetic-review-ui.mjs`：输入类别现在直接可见的断言更新。
- `package.json`：注册新增单元与浏览器命令。
- 本报告 `doc/magnetic-review-reconstruction-v1.md`。

## 验证与手动步骤

`npm run build`（TypeScript + 生产构建）通过；保留既有大 bundle 提醒。`node --experimental-strip-types --test test/magnetic*.test.mjs` **71 / 71 通过**。新增浏览器验收通过，检查真实 Selected 玫瑰花前后两种模式、一次新 Review、四次 Reconstruction、完整历史字节保护、URL / 刷新 / 新标签 / Back / Forward / 旧 Reconstruction、Catalog 切换、430px 布局。新增类别控件后，Find Matching Profile 仍在首屏；P1/P2/P3 分数维持 87.8/92.3、100.0/100.0、86.3/92.6。

新增验收之外的 **12 组浏览器回归全部通过**：Review UI、Workflow UI、Relative Size、Profile Matching、URL、Catalog、Mosaic、Intake（MAGNETIC_LIVE=0）、Build、Build Source、Build Viewer、Panels。真实 17 片作品仍重建为 3 个组件、17 条连接并完成完整 Build 回放。

相关回归结果：`/tmp/magnetic-admission-regression-results.json`；截图和实际 API 返回：`/tmp/magnetic-review-reconstruction/`。相关回归不执行真实 Selected 写入；没有 Vision / LLM 请求，付费调用为 **0**。

```bash
npm run test:magnetic-review-reconstruction
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-review-reconstruction:browser
```

运行中的 Node 服务若没有文件监听，需要重启来加载新的服务端诊断代码；前端刷新加载新 UI。验收使用更新代码的独立本地服务和生产构建。

1. 打开原 Selected 玫瑰花 Review，确认全部 Known 但「输入类别」仍未确认；在 Reconstruction 点击生成应得到输入审核提示、0 搜索，而非几何失败定论。
2. 点击「确认重建输入」，在 Review 核实后选择「平面示意图」，保存新快照。确认 Selected 星号仍指向原记录，零件 / 轮廓 / 关系未变。
3. 进入 Reconstruction 分别运行两模式，看到真实状态 / 对齐次数与 P3–P6 RMS 诊断，不再出现原始 unsupported 长理由。
4. 刷新、复制 URL 新开标签，检查新 Current 及新分类；打开原历史 Review / Reconstruction 时应保持旧数据。
5. 可直接打开本轮已确认的 [新 Review 与 Flat Mosaic 搜索结果](http://127.0.0.1:5173/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction&sourceId=5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f&analysisId=ec08916f-a0d5-4be7-964e-f63a52df22b9&reviewId=836c266b-1b94-40c9-aa96-a7631cd94d3d&reconstructionId=c5072e0a-7c1f-4910-bed4-e303c88ceec6&observationId=p1&rightTab=inspector)。该链接不修改 Selected，也不发起模型或自动生成。

## 未解决事项

当前仍没有 Geometry Valid 的完整玫瑰花。需要进一步核实翻面表示、遮挡/重叠和真实连接意图；本轮没有通过放松约束来制造候选。人工二维确认是必要审核，不等于保证输入可以完整重建。原 Selected 保持 unsupported，后续是否将新的 Review 设为 Selected 由用户决定。
