# Spatial Inspection 与 Bounds Align

当前编辑器使用右手世界坐标系：**+Y 为竖直向上，地面为 XZ 平面**。
正视图从 +Z 看向场景，因此 +X 在该视图中向右。Tile 的局部面法线是
+Z；旋转 Tile 或 Group 不会改变世界坐标系。

## 使用

1. 打开 Combined，在 Group 模式点击成员 Tile 或选择当前 Group。
2. 在 Spatial Inspection 表格读取 X/Y/Z 的 Min、Center、Max、Size。
   Center 是实体世界轴包围盒中心，单位与 Move 相同。Y 行带向上标记。
3. 对齐底部时，先选择 Front，读取其 Y Min；再选择 Rear，切到 Move，
   展开 Bounds Align，选择 Front 作为 Reference Group、World Axis = Y、
   Align = Min。
4. 检查 Calculated Delta，点击「预览对齐」，然后「应用对齐」或取消。
   对齐后仍需保存当前 Combined。X/Z 及 Center/Max 使用同一入口。

XYZ 指示器位于 Viewer 右上角，取代角落 ViewCube；底部视角按钮保留。
它复用 Drei `GizmoHelper` / `GizmoViewport`，每帧按主相机的逆旋转显示
世界正轴。轴头禁用交互，不驱动相机、编辑历史或 Geometry Revision。
View 与 Edit 共用这个组件。

## 几何与数据边界

- `moduleBounds` 从原 `moduleCenter` 提取现有实体范围计算。
  `createViewerModel` 使用当前 Assembly 的 Canonical Profile、缩放及保存的
  Pose；`pieceWorldVertices` 使用 Profile 轮廓和正负半厚度生成世界实体顶点。
  `Box3` 聚合 Group 全部成员。Pivot、Inspection、Bounds Align 共用此定义。
- 公式为 `delta = reference[axis][mode] - moving[axis][mode]`。
  对齐始终使用世界轴，与当前 Move 的 Global / Local / Face 选择独立。
- 预览复用 `previewModuleTransform`，确认复用 `confirmModulePreview` 和现有
  history commit。平移通过现有 `moduleStep` / `transformModule` 执行。
  纯平移保留原始四元数；仅修改移动 Group 的世界位置和 frame 位置。
- 绝对 Delta 不大于 `1e-10` 时视为已对齐，UI 禁用无意义的预览；纯函数预览
  同样保持完整快照，commit 不增加 Revision 或 Undo 项。
- 拖动及预览期间的表格使用同一真实世界几何定义；预览数值明确标记为尚未应用。
  并列显示的 `ReadOnlyAssemblyDisplay.offset` 从不进入上述计算或保存快照。
- 不创建 Connection，不执行 Snap，不建立持续约束，不自动接受碰撞。
  现有跨 Group Connection 被移动破坏时，原确认校验继续阻断应用。
  Invalid Draft 的保存与严格 Build 门槛均保持原规则。
- 不改 Source Assembly、Parent 快照、Lineage 或保存格式；保留原有 Dirty Draft、
  Undo/Redo、来源校验和 CAS。

## 验证命令

```bash
npm run test:magnetic-3d
node --experimental-strip-types --test test/magnetic-spatial-inspection.test.mjs test/magnetic-module-transform.test.mjs
npm run typecheck:magnetic-3d
npm run build
node --experimental-strip-types scripts/verify-magnetic-spatial-inspection.mjs
```

浏览器脚本仅复制正式 Front9 / Rear12 到临时存储，拒绝模型、Planning、Execution
和来源写入；检查九种组合、实体 Bounds、XYZ 实际渲染像素、预览/取消/确认、零位移、
保存刷新、Display Offset 隔离、原作品及 Lineage、严格碰撞和响应式布局。
截图与结果输出到 `/tmp/magnetic-spatial-inspection/`。
