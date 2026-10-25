# Spatial Plan → Geometry Execution V1

独立离线实验。只读取已保存 Spatial Plan 和同次 Trace 中的权威零件身份、原图、几何快照，不导入 LLM 调用链，不需要 API key。

## 运行

从 story-voice-test-audio 根目录执行：

```bash
node experiments/geometry-execution/run.mjs
node --test test/brick-geometry-execution.test.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5178 --strictPort
```

CLI 默认读取 `generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.plan.json`，以及对应 `.json` Trace。可指定 `--plan file --trace matching-file --output directory`。Plan 必须与对应 Trace 的解析结果一致；不覆盖任何历史数据。每次执行创建一个新 UUID 目录。

将 CLI 输出的 viewer 路径接在 `http://127.0.0.1:5178` 后打开。也可打开 `/story-voice-test-audio/experiments/geometry-execution/viewer.html` 并选择输出目录的 `viewer.json`；文件上传模式可显示全部候选并重新校验几何，但无法读取同目录的完整候选报告，请另外打开 `report.json`。URL 模式自动读取完整候选报告。

最新实际执行结果和截图：[本轮报告](RESULT.md)。

## 实现边界

- `execute.mjs`：薄转换层。复用 `loadBrickRules()` 提供的 Catalog、单位、连接器、最终 `validateAssembly()`；复用旧 Geometry Solver 的 `assessRelations()` 验证支撑/配对方向。没有调用旧 Beam Search，因为它采用软关系评分，可能移动位置，不适合执行硬区间计划。
- 世界区间由已有 Spatial Plan 相对引用累计；X/Z 枚举半 Stud 网格（20 LDU），Y 枚举整数 LDU。完整组合仍必须重新满足原始**相对**区间，不能只检查累计包围范围。
- 仅允许原 yawCandidates 中的直立方向；不把未知方向或深度自动设为零。不做区间外 snapping、rounding、repair。只统一平移 Y，让最低底面落地。
- 对所有候选调用同一最终几何校验：砖体包络、凸点包络、连接类型/方向/半径/深度、支撑和最终连通。没有 Build Order、前缀连通或 50% 支撑门槛。
- mating intent 必须满足对应 top/bottom 接合；用户/模型提供的 connector index 必须严格满足。隐藏的 null index 通过共享引擎已验证的世界接合点映射回原接口数组，保存具体配对，而非补写原 Plan。
- above/left/front/separated 按声明的世界轴和实体尺寸硬检查。occludes/overlaps_projection 缺少标定相机，显式记作未验证；touches/uncertain 不冒充确定的卡接，存在这些项目时状态是 `candidates_with_unverified_constraints`。
- 全量保留所有合法位置及朝向组合，只按相同平移归组方便导航。不会仅因尺寸相同就合并不同 LDraw mesh 或接口索引。
- 有限组合默认上限 10,000。超出范围返回 `budget_exceeded`，未知输入返回 `insufficient_information`，不会声称无解。`no_solution` 仅表示已穷举当前计划限定的直立网格域而无解。
- `run.mjs`：来源 SHA256、原始计划、输入几何、全候选与失败明细保存。
- `viewer.html` / `viewer.ts`：复用真正的 BrickViewer、LDrawLoader 和本地 DAT 库，原图并排展示。共享 Viewer 仅增加可选 fit 方向参数；原默认调用效果保持不变。

## 输出

- `report.json`：源路径/哈希、原 Plan、原图、权威身份与几何、枚举域、每次尝试、区间/关系检查、连接配对、碰撞结果、拒绝汇总、所有合法候选和分组。
- `candidate-N.json`：`assembly: {name, bricks}` 使用已有 Brick Placement 字段；含最终 geometry/collision、具体接口配对和原区间验证。不创建伪搭建步骤。
- `viewer.json`：轻量候选索引、原图和原 Plan；Viewer 按需读取具体候选。
- 无解时同样保存报告和诊断，CLI 返回非零；Viewer 显示冲突，不显示伪成功模型。

## 测试

九项测试覆盖固定真实骆驼、所有旋转保留、无网格点、真实碰撞、指定接口不吻合、视觉关系冲突、多位置候选、累计区间不替代相对约束、未知信息/几何漂移/预算及不可执行投影约束。反例只修改测试内的深拷贝，历史数据保持原样。

限制：现有引擎使用保守几何包络，不是精确实体布尔或物理稳定性仿真。图片区域和文字证据保留供人检查；没有相机拟合或自动照片评分。通过 Geometry 不能代替原图结构验收。
