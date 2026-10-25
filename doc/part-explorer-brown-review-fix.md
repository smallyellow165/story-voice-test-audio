# Part Explorer：Brown 缩略图与原图审核修复

## 原因与核对结果

公鸡 Analysis：`848fe628-5766-4f8c-8f73-5cf9235ef76d`。

通过现有 Application Server 的 Rebrickable 官方颜色元数据核对：

|颜色|Rebrickable ID|LDraw ID|Catalog RGB|
|---|---:|---:|---|
|Brown|6|6|583927|
|Reddish Brown|70|70|582A12|

`color-image?part_num=3437&color_id=6` 返回 `status=missing,url=null`。已有 `InventoryPartPhoto` 随后请求通用 `images?part_nums=3437`，得到缓存图片 `image-file?id=169`，原始 URL 为 `https://cdn.rebrickable.com/media/parts/elements/343721.jpg`（红色型号图）。这是通用图片回退缺少醒目提示，不是颜色映射错误或缓存键混色。

调查开始时，原 Review 的 `orange_middle` 与 `brown_lower` 均确认了 **3437 / RB 6**，因此库存为 Brown ×2；`brown_upright` 是 **4066 / RB 70**。库存按 `part_num:color_id` 合并相同组合；Observation 身份继续分别保存在 Review，没有把不同颜色混为同一条。Observation 名称不是最终颜色证据，本轮没有自行修改这三项的真实审核结论。

原图审核有两个 UI 问题：geometry-only 模式的 BBox 点击滚动目标指向只读几何表，而非审核表；从 Catalog 确认时只同步型号，未同步所选颜色到编辑字段，出现“已确认颜色 ID 70，颜色输入仍 Unknown”。

## 改动

- `src/brick-inventory/InventoryPartPhoto.tsx`：仍复用原专色图片→通用图片流程；通用图标注“型号示意 / 非所选颜色”，并提供对应替代文本。
- `src/brick-inventory/workbench.css`：通用库存缩略图灰度显示；可见提示，不再把红色示意图伪装成 Brown 实物图。真实专色图片保持原色。
- `src/brick-test/ReverseAssemblyPanel.tsx`：单独绑定可编辑审核表；点击 BBox 清除隐藏该行的状态筛选、滚动并聚焦型号输入；原图下增加 Observation 选择和审核入口，框重叠时也可选择。优先展示保存的原始照片。候选确认同步型号与 RB 颜色字段。
- `src/brick-vision/ObservationTable.tsx`：可选 Catalog 颜色名称下拉框（含 RB ID）；其他调用方保持原输入方式，Catalog 不可用时仍可输入 ID。
- `test/brick-brown-review.test.mjs`：颜色隔离、重复实例聚合、型号/颜色修正保存和 Spatial 输入快照回归测试。

正式保存路径仍是现有 `saveReview` → `<analysisId>.json.review`；未改变服务端审核格式，未覆盖 Vision Analysis，未修改后端数据库、原公鸡审核或骆驼数据。

## UI 验收

1. 用 `npm run dev` 的 Part Explorer 加载公鸡历史。右侧 Brown ×2 应显示灰度型号图和“非所选颜色”，颜色文字/色块仍为 Brown。RB 6 无专色图片，本轮没有伪造棕色照片。
2. 点击原图 BBox，应定位对应的可编辑审核行；即使筛选为“待确认”，点击已确认积木也会恢复“全部”并显示该行。框重叠时，用原图下“照片中的识别项”选择。
3. 输入正确型号，按颜色名称修改查询条件，再通过该行菜单“按型号查找”或原图下“为此积木选择型号与颜色”进入右栏 Catalog。
4. 在 Catalog 中明确选择颜色并点击“确认型号与颜色”。审核行同步型号和颜色，仍需点击顶部“保存审核”。刷新后恢复；Spatial Assembly 将读取该正式 Review。
5. 库存是独立清单。审核修正不会偷偷改写已有清单；需要同步时点击“重置我的积木”并确认，再“保存清单”。“加入我的积木”会累加，不适合替换旧审核结果。

## 实际验证

- 29 项测试通过：`brick-brown-review`、`inventory-image-request`、`brick-inventory`、`brick-observation-view`、`brick-spatial-workflow`。
- `npm run build`（含 TypeScript）通过。
- Chromium 使用原公鸡记录的独立副本，真实点击：加载审核→重置当前临时库存→核对 Brown ×2 灰度与提示→开启待确认筛选→点击 `brown_lower` BBox→确认焦点落到编辑行→把副本 `orange_middle` 选择为 Reddish Brown→保存 Review→刷新→验证 RB 70 恢复→重置库存→验证 Brown ×1 与 Reddish Brown ×1 分开。
- Spatial source API 读取副本得到 9 个 Observation，修正项为 RB 70。此颜色变更仅用于验收，不作为对原公鸡颜色的判定。
- 浏览器仅 POST 了 `brick-reverse/search` 与 `saveReview`，没有 Vision/Spatial LLM 请求。
- 浏览器验收结束时，原公鸡 Analysis/Review 和骆驼 Analysis/Review 的 SHA256 与验收前相同。随后的清理复查发现原公鸡 Review 被外部更新（updatedAt `2026-10-25T05:38:54.163Z`，`orange_middle`、`brown_lower` 均变为 RB 70）；本轮保留这份更新，没有回滚。其余三个受保护文件哈希仍相同。测试副本已从正式历史目录清理，证据保留在输出目录。

证据：`output/brown-review-fix/01-brown-thumbnail.png`、`02-review-restored.png`、`acceptance.json`、`tests.log`、`build.log`。

## 保留的边界

该公鸡 9/9 已确认代表 Rebrickable 身份审核完成，不代表几何引擎支持所有零件/颜色。现有映射检查中 Brown/Reddish Brown 仍受 Generator 支持色板限制，黑色映射和 2302 也有既存几何/映射诊断；本轮没有扩充几何库或修改这些约束。后续进入 Spatial Planning 时仍须通过现有正式映射检查。
