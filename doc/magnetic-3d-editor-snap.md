# 3D Assembly：两种吸附方式与紧凑工具栏

本轮复用上游 `vendor/editor/snap.ts` 的 `findBestSnapCandidate`、`computeSnapTransform`、Port 长度／占用检查，以及 EditorCanvas 的 TransformControls、相机、Port Line、ghost 和 snapshot commit / Undo / Redo。不复制 2D 坐标算法，不改 Geometry Solver、Validator、碰撞阈值、Assembly3D 或存档格式。

## 操作

顶部第一行只保留 Assembly 标题、短来源标识、View / Edit Draft、重新加载来源；第二行显示数量、几何状态、Draft 修改状态和吸附方式。宽屏常规工具栏两行，Viewer 从靠近顶部的位置开始。窄屏按可用宽度换行。

- **拖动吸附**：选择待移动零件 B，默认出现平移 Gizmo。拖动接近兼容空闲 Port 会显示 ghost；松手只生成待确认预览，点击右栏「确认吸附」才修改 Draft。无候选则恢复原位。右栏「移动 Gizmo」／「旋转 Gizmo」仍可用于自由编辑，不强制吸附。
- **点击吸附**：选择 B，再选 B 的连接边；点击其他零件 A 的兼容边，或在右栏「选择边并连接」指定 A、Port、二面角、flip 后点击「预览吸附」。确认／取消共用拖动的同一条提交路径。
- 二面角和 flip 使用右栏现有输入，拖动也使用这组明确设置；不新增吸附物理规则。
- 「取消吸附」或 Esc 丢弃预览。拖动中的 Esc / pointercancel / lostpointercapture 回滚 transient Pose，不再被当作 mouse-up 隐式提交。

预览保留原 Draft、Revision、保存状态；可旋转相机观察，真实零件与 ghost 分开显示。预览期间阻止保存、复验及冲突编辑，离开编辑页面会取消它。相机状态仍可在 Viewer 下方折叠详情查看，不自动写入存档。

## 连接与安全

`editor-snap.ts` 是很薄的 Editor 事务边界，计算仍使用上游 Port 对齐函数：

1. 校验真实版本化 Profile / Port、实际边长、端口占用、Dihedral 和 flip。
2. 只计算并放置选中的 B，不重求解整组件，不移动 A 或其他零件，不改任何已有 Connection。
3. 若 B 仍有连接且需要改变 Pose，拒绝并要求先明确解除连接。可以在连接 Inspector 「断开连接」，也可以「解除选中零件全部连接（保留 Pose）」。两者都可撤销。
4. 若新的约束在原 Pose 上成立，可以明确补回连接／闭环，但不能利用它重新摆放原闭环。
5. 使用同一个严格 Validator 检查整个预览。新几何 Error 被拒绝；需要移动的 B 不能在结果中保留实体碰撞 Error。其他未动部分的既有 Invalid Diagnostic 可保留，仍为红色，不能因此宣称作品 Geometry Valid。
6. 确认时比对原完整序列化快照，重新计算、重新校验，再通过上游 `commit` 一次提交 Pose 和 Connection。过期预览、占用 Port、非法相交或其他失败不修改 Draft。

特别注意：SAT 最小轴重叠深度可能在板面重叠扩大时保持不变。因此不能仅凭深度未增大就允许移动源片继续重叠。本轮事务使用保守规则，已移动的 B 必须通过原 Validator 的碰撞检查。手动自由编辑 Invalid Draft 的能力保留。

不支持一键拖动整个相连组件或自动拆边、换边和环路重求解；需要先明确解除相关连接再吸附。它不进行厚度偏移、磁极判断或安装路径规划，也不能自动将橙色完整结构修成实体合法。

## Examples / Debug 与来源

顶部三个示例实际是 Phase 2/3 的确定性 Viewer / Editor 验证数据。现移入右侧 Inspector 的独立折叠区 **Examples / Debug**，默认关闭，与 Tiles Catalog 分开，不修改示例 JSON 或验证方式。

加载、重新加载来源、导入、示例切换继续复用 `allowReplace` 的未保存 Draft 保护。完整照片来源、Source ID / Hash、Diagnostic 和采用时快照移到 Inspector「照片来源与快照」，未删除原数据。Override 仅进入待修复 Draft、严格 Revalidate、当前 Revision / Hash 门禁及 Build 限制不变。

## 主要文件

- `three-d/editor-snap.ts`：共享预览／确认事务及显式解除。
- `three-d/ThreeDWorkspace.tsx`：两行工具栏、模式、预览状态、确认与取消、来源／Examples 位置。
- `three-d/EditorInspector.tsx`：复用端口、角度、flip 表单，改为先预览，并提供显式解除。
- `three-d/vendor/components/editor/EditorCanvas.tsx`：复用拖动候选、ghost、目标 Port 点击；取消回滚。
- `StudioLayout.tsx`、`three-d/viewer.css`：仅 3D Assembly 的标题与响应式布局。

上游 MIT 来源保留；`third_party/3D_Magnetic_Pieces/EDITOR.md` 与 `editor.patch` 已更新。补丁在临时目录对原归档应用，能逐字节还原全部四个 vendored Editor 文件。

## 测试

- `npm run test:magnetic-3d`：200 项通过，包括真实连接／单次 Undo、预览不变性、占用／角度／碰撞拒绝、过期确认、无关零件不动、既有平行重叠不能仅以深度相等放行，以及橙色原位断开／重连。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs`：167 项通过。
- `npm run typecheck:magnetic-3d`、`npm run build`：通过。
- 新增 `npm run test:magnetic-3d:snap:browser`：真实 WebGL Port raycast、真实鼠标 Gizmo 拖动、ghost、确认、取消、Esc、真实 Connection / Pose / Undo、碰撞回滚、六片橙色 Invalid 结构断边重连与严格复验／保存恢复、示例加载的取消覆盖保护、1660/1100/680 布局通过。
- 原 `test:magnetic-3d:editor:browser`、`test:magnetic-3d:browser`、`test:magnetic-3d:tutorial:browser`、`test:magnetic-3d:build-order:browser` 通过。
- `test:magnetic-visible3d:override:browser` 通过：来源／相机／Override／当前 Hash 复验与 Build 门禁保留。
- `test:magnetic-click-snap:browser` 通过：2D 原生鼠标／键盘／触屏、拖动／点击切换、歧义和无候选处理、Undo、保存／Build 不变。

测试仅写临时 API 和隔离浏览器存储，真实模型调用及正式数据写入均为 0。新浏览器结果与截图：`/tmp/magnetic-3d-snap/`。橙色测试使用既有存档的确定性几何输入，不代表新的照片识别测试。

## 用户验收

1. Assembly → 3D → Edit Draft，检查顶部两行和右栏折叠的 Examples / Debug。修改 Draft 后加载示例，取消确认应保留原作品。
2. 新建空白 Draft，从现有 Catalog 添加两片。选择 B，在右栏设兼容 A / B 端口及 90° / flip 关闭；点击吸附模式下使用「预览吸附」或直接点 A 的兼容边。取消应无变化，确认后增加真实连接，Undo 一次恢复。
3. 断开该连接，切换拖动吸附，拖动 B 的 Gizmo 靠近 A。先检查 ghost，松手后确认；取消／Esc 应保留原 Draft。需要自由移动或旋转时使用右栏原工具。
4. 六片橙色待修复 Draft：选择连接，记录端口／角度／flip，明确断开后按原参数预览并重连。其他零件 Pose 应不变，Solid Collision 仍可能 Invalid。若要改变 B 的位置而它还有连接，必须先解除相应连接；不自动改变闭环。
5. 保存、刷新、重开并执行 Revalidate Geometry；Invalid 或复验过期状态仍不能作为正常 Build 来源。
