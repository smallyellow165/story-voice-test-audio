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
- 每个物理等价类调用同一最终几何校验；仅对有完整证据的成功结果复用计算，保留每个原始朝向的具体连接结果：砖体包络、凸点包络、连接类型/方向/半径/深度、支撑和最终连通。没有 Build Order、前缀连通或 50% 支撑门槛。
- mating intent 必须满足对应 top/bottom 接合；用户/模型提供的 connector index 必须严格满足。隐藏的 null index 通过共享引擎已验证的世界接合点映射回原接口数组，保存具体配对，而非补写原 Plan。
- above/left/front/separated 按声明的世界轴和实体尺寸硬检查。occludes/overlaps_projection 缺少标定相机，显式记作未验证；touches/uncertain 不冒充确定的卡接，存在这些项目时状态是 `candidates_with_unverified_constraints`。
- 全量保留所有合法位置及朝向组合，只按相同平移归组方便导航。不会仅因尺寸相同就合并不同 LDraw mesh 或接口索引。
- 默认完整物理验证预算 10,000 次，独立的原始朝向展开上限 100,000 组。没有对称证据时每个朝向独立计费；失败物理结果不跨旋转复用，耗尽实际调用预算也会停止。超出范围返回 `budget_exceeded`，未知输入返回 `insufficient_information`，不会声称无解。`no_solution` 仅表示已穷举当前计划限定的直立网格域而无解。
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

## Geometry Symmetry Optimization V1

- `prepareGeometryInput` 在现有 LDraw 依赖检查中展开面片。`symmetry.mjs` 对实际面片、完整碰撞包络、外包围盒、尺寸和 top/bottom 连接点的位置、方向、类型、半径与深度执行精确四分之一转集合比较，不使用尺寸或型号白名单，也不做近似舍入。
- 有独立颜色、贴图、印花基础几何映射、缺失证据或显式 Connector 索引的实例不共享旋转验证。所有原 yaw 候选都保留，单一 yaw 不会变成其他角度。
- 缓存只复用成功的物理验证。`geometry.connections.points` 按当前 upper 零件的原 bottom 数组重新排序；每个朝向重新计算具体 mating 索引、相对区间、空间关系及排名。pair 支撑判断单独复用，但不会复制代表朝向的索引配对。
- Candidate 对象、排序、Top-K、attemptIndex、有效布局数及 hash 的含义不变。原始朝向域照常完整展开，只有昂贵的物理计算复用。完整验证失败的诊断不跨旋转共享，避免错误改变首个碰撞原因。
- `search.symmetry` 保存各实例的类映射、连接器置换、Profile hash、LDraw 依赖 hash、物理类数、实际验证次数、缓存命中、pair 检查次数和朝向展开数。证明仅属于本次执行，不写入 Parts Snapshot 或共享 Profile。
- `policy.maxCombinations` 现在限定实际完整物理验证次数；`policy.maxOrientationExpansions` 独立限制展开/排名及报告规模。预检和运行中的计数都执行；不完整搜索不发布部分 Top-K。
- 新结果单独保存；历史 Geometry、Layout、Build Plan 不迁移。未认证 touches/occludes、照片相似度、物理稳定性和搭建顺序的限制保持不变。

验证：`node --test test/brick-geometry-symmetry.test.mjs`。测试对照 Rooster 全部 32,768 次字面朝向穷举，包括全部尝试证据与 Top 5/10 的逐字段/hash 比较，并在临时目录验证 Geometry → Layout Adoption → Build Order 来源读取。
