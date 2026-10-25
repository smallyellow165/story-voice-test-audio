# Spatial Assembly Planning V1

独立实验：原图 + 已审核实例 + 共享真实几何 → 一次多模态空间计划。保留 Generator V3，不调用新 Recognition，不运行 Solver / Repair / Build Order，不访问 My-Good-GYM。已完成一次真实骆驼推理与相关测试，详见 [实验报告](CAMEL_EXPERIMENT.md)。

## 手动入口

在 story-voice-test-audio 项目根目录执行。复用项目已有 Node 与依赖环境，无新增依赖。

```bash
# 查看当前项目注册的模型（不调用 Provider）
node experiments/spatial-planning/run.mjs --models

# 仅准备完整请求并生成 HTML；不需要 API key，不发网络请求
node experiments/spatial-planning/run.mjs --model gpt-6.1-sol

# 用户主动执行一次真实空间规划；从现有 .env 读取对应 Provider 凭证
node --env-file-if-exists=.env experiments/spatial-planning/run.mjs --model gpt-6.1-sol --run

# 用户手动运行回归测试；不调用真实 API
node --test test/brick-spatial-planning.test.mjs
```

以上模型 ID 来自当前仓库注册表，不代表已验证账户权限或服务可用性。OpenAI 需要 OPENAI_API_KEY，Gemini 需要 GEMINI_API_KEY；入口在缺少对应 key 时停止，不切换 Provider。未查看或修改 .env。

默认使用 Analysis `0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa` 与保存了正式映射的 Trace `0faf5079-d553-430f-9f12-fc95d190b769`。支持显式 `--analysis 文件 --trace 文件 --output 目录`。路径以 CLI 当前工作目录解释。每个 observation 必须有一个已确认、未排除的实例；数量与库存严格一致。

默认包含完整旧 Analysis、Review、13 条 Relations。可用 `--photo-only` 去掉旧视觉推断与关系，只给照片、确认身份、真实几何和映射来源；这仍保留原始 observation 名称，所以不是完全无标签盲测。不要为了获得漂亮结果重复抽样；先检查第一次 trace，必要时再有目的地比较输入模式。

CLI 打印本次 UUID、JSON 和 HTML 的绝对路径。直接用浏览器打开 HTML，无需新服务。prepare-only 报告没有模型计划；真实运行后打开该次新的 HTML。执行失败时退出码非零，已有 raw trace 仍保留；磁盘写入失败不能报告成功。

## 复用模块

- `experiments/geometry-solver/input.mjs`：已保存 Analysis/Review → observation 实例；复用官方 rb_part_mappings 证据和本地可用性检查，4066 → 4066a 不靠字符串猜测。
- `server/brick-rules.mjs`、共享 catalog/part-geometry：尺寸、LDU 单位、旋转、碰撞包络、top/bottom mating positions。没有第二套几何库。
- `server/brick-vision.mjs`：图片验证。image_reference.sha256 对应第一阶段发送的压缩 image，先校验该图片。空间规划优先使用保存的 originalImage，单独记录其 SHA256；两者因 JPEG 重新编码可以不同。原图关联依据是同一 Analysis 保存记录，不声称压缩图哈希验证了原图。原图缺失时明确记录使用 image；原图存在但无效时报错，不静默换图。
- `server/brick-model-registry.mjs`、`brick-model-call.mjs`、`openai-responses.mjs`：使用 design-capable 模型、Provider adapter、原有推理参数；不使用 Generator V3 prompt。
- `server/brick-vision-wire.mjs`：HTTP wire request/response 完整保存，禁止重复 HTTP 请求。

## 新文件与职责

- `plan.mjs`：V1 输出契约、完整字段校验、身份/引用/接口范围检查、转换可行性诊断。
- `input.mjs`：恢复图像、审核身份、实际尺寸与连接器，构造独立空间理解 prompt/request。
- `runner.mjs`：准备或单次调用、独立 trace 生命周期、解析和校验保存。
- `report.mjs`：离线 HTML，原图区域框、实例表、原始回答与诊断。
- `run.mjs`：手动 CLI，默认不调用模型。
- `../../test/brick-spatial-planning.test.mjs`：回归测试；测试数据只在测试中使用。
- 本 README：实验操作与验收说明。

没有修改共享模块、历史 Analysis、审核库存、现有 Generator 或正式后端。

## 表示与职责边界

以 observation ID 唯一标识实例；不让模型重新输出型号和颜色，从输入权威绑定。因此两个 3437、三个 4066a、两个 40666 不会因型号相同而合并。

每个实例包含角色、可见 bbox/特征点、遮挡、相对参考实例、三轴 LDU 偏移区间、朝向候选、连接意图、置信度和未知项。只允许一个 anchor，anchor 底部中心作为零点，其余实例构成无环相对引用。偏移使用世界轴，不跟随父零件旋转。可表达低于 anchor 的负 Y。

- +Y 向上；+X 沿主体横轴朝画面右方；+Z 朝较近的深度侧。模型在 scene 中解释投影证据。
- bbox=[uMin,vMin,uMax,vMax]，左上角为 (0,0)，右下角为 (1,1)；不是把 bbox 直接当三维坐标。
- 每轴 {min,max} 表示可接受区间，null 表示未知；min=max 只是单一假设。
- yawCandidates 对应共享几何的局部轴；4066a 的局部 bodySize 是 80×96×40 LDU，不能直接沿用视觉“1×2”的正面朝向。
- top/bottom connector 为共享数组零基索引；隐藏接口允许 null。它们是几何模型的 mating positions，不是对实体底管逐一计数。
- scene.method 支持 near_planar / general_3d / uncertain。可利用已知尺寸、接缝与凸点做近二维/2.5D 推断，但没有强制正交化，也没有将未知深度写死为零。
- upright=false/null 可表达不受现有几何执行器支持的姿态；当前 yaw 表示不支持连续 pitch/roll，这会明确进入 unresolved，不能当成完整通用 6DoF 求解器。

LLM 负责视觉理解、相对位姿假设、朝向、连接意图和证据；程序负责读取权威事实、图片哈希、库存身份校验、相对区间相加、未知信息传播与保存。不做 CV、自动选候选、坐标修正或隐式四舍五入。

## Trace 与失败区分

默认目录：`generated/brick-spatial-traces/`

- `<UUID>.json`：完整构造请求、原图 Base64、确认零件与几何、Analysis/Review/Relations（按输入模式）、来源文件 SHA256、imageProvenance（所选来源、原图与压缩图独立哈希、压缩元数据）、model/settings、rawOutput、完整解析 plan、validation、conversion、usage、状态和错误。
- `<UUID>.request.json`：真实发送的完整 HTTP body（包括 Base64 图片）。
- `<UUID>.response.txt`：完整 HTTP 原始响应，在业务解析前保存。
- `<UUID>.html`：离线检查报告，含图片；应按含原图的数据处理。

prepare-only 只产生 JSON/HTML，因为尚无真实 HTTP request/response。实际调用沿用 wire recorder，保存失败不重试模型。不保存 API key / Authorization header。没有 Repair；geometryCorrection 始终 null，不用修正覆盖原始回答。

parseStatus 表示 JSON 是否可解析；validation 仅表示契约与引用是否有效；plan_ready_for_review 不是视觉验收通过。Provider/截断、JSON/Schema 错误各自可辨。conversion.geometryStatus 固定 not_run，因而不能把空间理解问题误称为 Geometry 执行失败。

## 七块骆驼验收

以下检查仅供人审核，不在 prompt 中作为目标答案注入；默认旧 Relations 本身提供了已有视觉线索。

1. 七个 ID 全部出现、无多余或重复。特别逐一核对两个相同型号实例。
2. 两个 40666 都在身体，上下分层；没有同层相交，也没有薄件位于脚底。
3. 上下薄件有横向错位。看偏移数值、朝向和图片端点证据是否互相支持。
4. 双腿在身体下面且分离，颈在身体一端，头在颈上，背砖在身体上。
5. 图片框、接缝、特征点确实对应被解释的实例；不能只看文字关系。
6. 未见接口没有被标为明确观察到；深度/偏移不确定时保留区间、null 或 alternative。
7. 检查 scene 的尺寸标定与视角解释，尤其 4066a 朝向及两块薄件的真实 24 LDU 厚度。
8. 查看 conversion.unresolved：是否仍缺深度、精确错位、朝向、隐藏接口；与旧 13 条粗关系相比是否给出了可操作数值。

## Geometry 转换可行性与限制

本阶段刻意止于计划与诊断，不自动生成 Assembly 或搭建顺序。

`assessConversion` 将相对区间累计为各实例世界坐标区间。区间未知、多个 yaw、非直立、alternative、模型报告缺失项时返回 needs_resolution；否则 single_pose_hypothesis 仅表示单一位姿假设，**不保证合法 Stud Grid、接触一致或无碰撞**。隐藏接口单列，并不自动填入连接器。

后续可把单一位姿统一平移到地面，将 x/z 除以共享 STUD_LDU、y 除以 BODY_LDU，再绑定原始 part/color，交给现有 Assembly Placement、碰撞/connector 校验和 BrickViewer。必须先检查网格、朝向、视觉关系一致性；不允许为了合法而静默改结构。存在区间时，可复用现有 Solver 的接口对齐枚举保留多个候选，但需要新增硬约束适配来保留原始空间证据，当前没有实现这一层。

已验证：脚本运行、Spatial Planning 十项测试、一次 gpt-6.1-sol 实际请求、计划解析和校验、骆驼人工空间审阅及 HTML 浏览器渲染。扩展检查仍有一项既有 Generator prompt 测试失败，详见实验报告。当前没有基于照片的自动评分、物理稳定性认证、完整几何转换或 Build Order，也未验证其他 Provider 的实际请求或其他模型案例。
