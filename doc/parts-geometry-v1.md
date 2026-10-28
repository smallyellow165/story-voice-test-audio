# Parts Geometry V1

## 调查结论与边界

- Catalog (`server/brick-games.mjs` 的 catalog transport) 提供正式 Rebrickable 零件、颜色、LD 导出编号和 P 印花关系。它不表示图片中某一块积木。
- `src/brick-test/catalog.ts` / `part-geometry.ts` 已是共享几何定义：尺寸、碰撞体、连接点、LDraw 坐标转换和来源文件 hash。`assembly.ts` 是既有几何 Validator，本次未修改。
- `server/brick-library.mjs` 检查本地 LDraw 文件和递归依赖，返回实际资源 hash。文件存在不等于存在受支持的 Geometry Profile。
- 原先 `spatialMapping()` 将以上能力包在 Spatial 的 Mapping Review 创建流程中。本次把解析逻辑移入共享模块，保留原函数作为运行级适配器。
- Mapping Review 仍是 Inventory Session 的映射证据：`source` 含型号、颜色、数量，`target` 是正式映射；检查、官方映射原文和印花绑定是输入证据；Review UUID / Session ID 是运行身份，不是共享定义身份。图片中的实例仍由 Analysis observation ID 标识。

## 模块与只读 API

`server/brick-parts-geometry.mjs`：

- `resolvePartsGeometry(items, rules, dependencies)`：批量解析，Spatial 和独立查询共用。
- `createPartsGeometryService().resolve(partNum, colorId)`：独立读取和校验，无需 Analysis、Session 或启动规划。
- `GET /api/brick-parts-geometry?partNum=2302&colorId=25`：颜色是 Rebrickable ID，必须明确提供。参数错误返回 422；映射/Profile 不支持时返回 200 和真实诊断；读取异常返回错误。无写入接口。

响应 `schemaVersion: 1`：

| 字段 | 内容与身份 |
| --- | --- |
| `partDefinition` | RB / LD 型号、官方映射记录、已验证印花基础几何绑定、内容 ID |
| `geometryDefinition` | Profile、单位、坐标约定、实际 LDraw 资源路径与 hash、内容 ID |
| `colorMapping` | RB / LD 颜色与官方证据、内容 ID |
| `support` | 分别表示 mappingValid、geometrySupported、usable，并列出 issues |
| `row` | 与现有 Mapping Review 同源的完整解析证据 |

定义 ID 是 `sha256:` 加上递归排序对象键后的 JSON SHA-256（不含自身 `id`）。数量、Analysis ID、Session ID、运行 UUID 不参与定义身份；Profile 或资源内容改变会改变几何身份。不存在定义时为 null，不生成默认几何。V1 不新增定义数据库，也不保证跨请求免查询：复用的是同一 canonical 定义与内容身份，不是永久缓存。

新生成的 Mapping rows 添加 `definitionReferences: { schemaVersion: 1, partDefinitionId, geometryDefinitionId, colorMappingId }`。新 Spatial 输入的每块 observation.mapping 携带同一引用，并继续保存原有 Mapping、Profile 和来源快照。不改变旧字段名称、Validator 或历史读取路径；旧快照不会被补写这些字段。定义 hash 不能替代已有快照、candidateHash 或 designHash。

## 运行证据与选择

每次 Spatial Planning 仍创建独立 Mapping Review UUID，保存该次库存映射和资源验证证据；没有每次创建共享几何数据库记录。不同 Analysis 不能共享实例身份或人工审核结论。同型号的多个实例引用同一几何身份，实例 ID 各自保留。

Parts Explorer 的 Current Review 仍覆盖保存，无 Revision / Selected Review。Parts Explorer 可调用同一只读 API，但本轮不增加第二套几何管理 UI。Workflow History、Selected Spatial 的 Key、并发控制及下游 Geometry / Selection / Build Plan 不变。Mapping ID 导致的选择分组差异留到下一阶段；届时应区分人工比较范围与历史输入身份，不能重解释旧 ID。

## UI 验收

Design Lab 的现有 Spatial 区域、`1 · Spatial Planning` 前，展开 `Parts Geometry · 共享零件定义`。

1. 输入型号 `2302`、RB 颜色 `25`，查询；检查支持状态及详情中 top 4 / bottom 6 和 offset {-20,48,0}。
2. 查询 `11170` / `0` 或 `3437` / `14`；重复查询，几何 ID 相同。查看官方颜色和本地资源证据。
3. 输入不存在的型号，确认错误/不支持诊断仍可见，没有默认几何。
4. 打开原 Penguin History、Selected Spatial 和已有 Build Plan，核对原分支及选择仍在。查询不创建 Analysis、Review、Mapping Review 或 Spatial Run。

## 验证结果

- 新增 6 个自动化测试通过：真实 Penguin 九行映射/印花/颜色；重复运行共享定义；四块 11170 独立实例；跨 Analysis 身份；Profile 变化与资源漂移；缺失 Profile；非法和歧义映射；2302；Camel/Rooster 既有 Profile 对照。
- 22 个测试文件共 143 tests：141 通过，2 失败。两项失败位于既有 `brick-rooster-geometry.test.mjs`：组合数预期 65536 实际 0，以及 diagnosticAvailable 预期 true 实际 false。未修改 HEAD 的独立临时副本也复现相同失败；本次不放宽 Validator 或改写旧结果。
- `npm run build` 通过（已有 bundle size 提示）。本地 HTTP 查询上述三个型号均 200 / usable=true。
- 不调用付费模型，不迁移历史数据。浏览器实际交互与布局需按上述步骤人工验收。

后续仅在实际需要时考虑缓存、定义编辑入口或选择范围契约调整；不提前加入 Project、Gallery、Revision 或下游 Selected。
