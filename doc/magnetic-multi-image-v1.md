# Magnetic Tiles · Multi-Image Analysis V1

本轮实现 2D / Visible 3D Analysis 的共享图片输入和单次多图识别，不增加几何引擎、Assembly 或播放器。两个模式分别保留自己的 Analysis / Review / 后续历史；共享的是已有图片资源和输入控件。

## 页面操作

- 右栏使用「上传图片 / 服务器图片」Tabs，首次默认上传。Visible 3D 的重复标题已移除。
- 上传支持一次选择多张 PNG/JPEG/WebP。服务器图库使用可搜索的紧凑表格、缩略图、Checkbox 和刷新。两种来源可以混合到同一集合，最多四张。
- 集合显示缩略图、文件名、来源、查看、上移、下移和移除。可选元数据默认折叠，避免挤走模型和识别按钮。
- 每图可设置 Final / Step / Alternate View / Unknown、拍摄方向及备注。备注离开输入框后保存；等待保存完成再刷新。
- 第一张 Final 是主图；未指定 Final 时使用第一张。允许多张 Final；是否表示同一完成状态及冲突由模型说明、人工审核。
- 中栏按钮切换当前图片和对应标注。Review 的选中零件可直接切换到相关证据图片；没有该图证据时不画其他图片的框。
- Analysis 首次默认 OpenAI `gpt-6.1-sol`，保留现有明确的 URL / 用户选择。Spatial Planning 的默认模型不变。
- 选择、上传、编辑元数据和切换图片均不调用模型。

## 保存与来源身份

复用现有 `sources`、`assets`、上传归一化和服务器图库接口；没有建立第二个图片仓库。

`POST /api/magnetic-intake/source-sets` 在现有 `generated/magnetic-intake/sources/` 创建不可变的集合 Source，增加可选字段：

```ts
images: [{ sourceId, sourceHash, name, view, origin, role, direction, note }]
primaryImageId: string
```

集合引用原有 Source 和图片字节，不复制图片。服务端重新读取真实 Source 的 Hash 和尺寸，限制 1–4 张、重复 ID / 图片内容、嵌套集合和无效元数据。文件名是有长度限制的显示元数据，允许同一图片通过上传 / 图库以不同文件名出现；不能借文件名访问任意文件系统路径。

顺序、角色、方向、备注变化会产生不同集合 ID / Hash，清除当前识别及下游选择，保留原历史。旧结果仍属于旧集合，不能冒充新集合的识别结果。单纯查看另一张图不改变集合身份。

元数据在服务端集合文件中保存，Studio 复用现有 URL / Visible 3D context 索引恢复集合。当前查看哪张图仅保存为分模式的本地 View Preference。旧单图 Source 无需迁移；旧记录未记载的上传 / 图库来源显示为历史图片，不猜测来源。

> 颜色契约后续修复：当前多图 Prompt 为 `magnetic-multi-image-analysis-v1.1-color-contract`，明确要求 `#RRGGBB`，并在 OpenAI 多图 Analysis 请求中启用严格 `json_schema`。单图 Prompt 不变。原 `v1` 失败 Trace 保留；详见 [颜色契约调查与离线回放](magnetic-multi-image-color-contract.md)。

## Prompt 与证据契约

- **一张图片**：继续走原有单图 Prompt 和请求分支；2D / 3D 单图 Prompt 指纹均与修改前 HEAD 一致。
- **两至四张**：自动使用独立 `magnetic-multi-image-analysis-v1`。同一次模型请求携带全部图片、稳定 ID、顺序、尺寸、角色、方向、备注和 Catalog。OpenAI / Gemini 均支持。
- 新 Prompt 区分完成状态、中间步骤和其他角度；跨图匹配同一物理 Tile，禁止把各阶段数量相加。允许同一 Tile 改变位置和朝向。步骤中确实可见的零件可以支持最终遮挡假设，但最终归属、移除 / 替换和身份冲突必须保留不确定性。完全未观察到的补全不进入库存。
- 不输出精确 XYZ / Quaternion，不宣称 Geometry Valid 或 Photo Match，不增加识别后合并或修复调用。

继续输出当前模式的同一份 Canonical Result，仅扩展可选 `referenceImageId` 和每个 Observation 的 `imageEvidence[]`：

| 模式 | 每图证据 | 原有 canonical 坐标 |
|---|---|---|
| Visible 3D | imageId、bbox、features、occlusion、evidence、uncertainty | 根 bbox / features 仅属于主图；仅在其他帧可见时允许根 bbox=null、features=[] |
| 2D | imageId、outline、evidence、uncertainty | 根 outline 仍属于主图；无法定位最终主图轮廓时保持 unsupported，不能编造轮廓 |

坐标始终归一化到各自图片的 0..1。原 Parser 验证边角与范围，新增检查限制图片来源、重复引用和主图几何一致性。Feature 的 JSON 字段顺序、列表顺序及说明措辞不影响几何比较。2D 其他图片的轮廓仅供查看；编辑主图轮廓时同步其对应证据。

多图 Visible 3D 的实例上限为 25，Review / Planning 的对应数量边界同步兼容；旧单图边界不变。现有连接数量和搜索预算仍然有效，不无限搜索。

## 下游与 Trace

Review 继续确认一份固定的物理实例集合和版本化 Profile。Planning 接收同一份证据与全部来源图片，增加输入说明以区分步骤位姿和最终状态；其 Prompt 本身不变。可执行 evidenceRefs 仍使用 Observation ID 或主图 Feature 引用，其他帧通过图片 ID 在说明中关联。

Solver、Validator、候选生成算法、Assembly3D、Tutorial3D 和 Build Order 算法未修改。候选仍需现有审核、来源与身份校验后采用。集合 Source ID / Hash 沿现有 Review → Plan → Execution → Origin 传递。

复用已有模型调用、Trace 和 Wire Capture。记录实际模型、Prompt 版本、集合元数据、完整 Request / Response、解析、诊断和实际 Usage。3D 元数据在 `requestInput.images`，2D 在 Analysis 的 `inputImages`；真实请求包含全部图片。生产链路不合成 Token 数或费用。

## 主要文件

- `intake/SourceImagePicker.tsx`：共享 Tabs、上传、服务器搜索、集合及元数据。
- `intake/SourceImages.tsx`、`image-set.ts`：图片查看、缩略图、集合边界和来源校验。
- `ImageIntake.tsx`、`Visible3DWorkflow.tsx`：接入各自状态与历史，Review 图片联动。
- `three-d/reconstruction/image-evidence.ts`、两类 contracts：按图投影与兼容证据扩展。
- `server/magnetic-multi-image-vision.mjs`：独立 Prompt 和多图 Schema / 请求附件。
- `server/magnetic-intake*.mjs`、`magnetic-visible3d*.mjs`：原有模型入口及 Source 适配。

## 验证与限制

```sh
npm run test:magnetic-multi-image
npm run test:magnetic-multi-image:browser
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run test:magnetic-3d
npm run build
```

本轮实际结果：

| 检查 | 结果 |
|---|---|
| Magnetic Node 回归（含新增 9 项多图测试） | 184 / 184 |
| 3D Engine / Viewer / Editor / Tutorial / Build Order Vitest | 216 / 216 |
| 多图端到端浏览器 | 通过，包含实际采用到 Assembly |
| 原 Analysis 布局、Review Fit、Reconstruction / Camera、3D Snap 浏览器 | 通过 |
| TypeScript / 生产构建 / diff whitespace 检查 | 通过；保留既有 bundle 大小提示 |
| 额外 DUPLO 回归 | 93 / 94，1 项既有文案断言失败（HEAD 同样失败） |
| 旧 Tutorial 浏览器 | 正常步骤 / 相机 / 播放通过；Invalid 恢复场景超时（HEAD 同样失败） |

浏览器在隔离的 `/tmp` 存储运行，使用真实资源 `car-all.png`、`car-1.png`、`car-2.png`、`car-3.png`，但模型响应明确使用离线 Fixture。验证混合输入、元数据 / 排序恢复、逐图标注、Review → Planning → Execution → 明确采用 → Assembly、Trace、集合变化后的失效保护、模式隔离及 1660 / 1100 / 680 宽度。

原 Analysis 布局测试同步迁移到 Tabs 和集合输入，验证横图、竖图、正方形、点击和轮廓编辑、两种模式的历史、刷新及真实旧 Trace。Review Fit、Reconstruction 候选 / Camera 交接和 3D Snap 浏览器回归通过。

额外发现的既有失败已在未修改 HEAD 的隔离副本复现：DUPLO `brick-vision-openai` 的错误文案断言不匹配；旧 Tutorial 浏览器脚本在恢复 Invalid 教程草稿后等待相机面板超时。没有借本轮修改这些阶段。

真实付费模型调用 **0 次**，正式图片 / 历史写入 **0 次**。离线 Fixture 成功不代表真实四图的实例识别、跨帧身份或最终状态判断准确率；这些仍需后续真实模型评估和人工 Review。不实现视频提帧、相机标定、新视觉引擎、物理规则或自动隐藏补全。

## 手动验收

1. 重启开发服务。先只放一张旧案例，确认使用原 Prompt、原 Review 及历史恢复。
2. 分别测试一次上传多张、图库多选、两者混合；重排、移除、点击缩略图，确认不会调用模型。
3. 展开图片元数据，设置角色、方向和备注，离开备注输入框并等待保存；刷新检查恢复。
4. 加入四张 car 图片，以 car-all 为 Final，其他按真实阶段标 Step，分别补充后部基础、斜坡展开和前部安装说明，再明确点击 Analyze。
5. Review 中对照各图确认同一 Tile 未重复计数、步骤位姿未当作最终位姿；核对 Profile、最终归属及不确定项后保存。
6. 使用现有 Planning / Geometry Execution，人工对照候选后进入 Assembly。改变输入集合应清除当前旧结果选择；从旧集合历史仍能恢复旧结果。
