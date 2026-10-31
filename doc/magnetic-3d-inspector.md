# 3D Assembly Inspector 与 Tile ID

本轮仅整理 Assembly 的显示与选择交互，未修改 Assembly3D Schema、Solver、Validator、Snap 算法或正式存档。沿用现有 `Selection`（none / piece ID / connection index）、EditorHistory、Draft CAS、照片来源与复验凭据。

## 页面结构

右栏依次为：

1. **3D Inspector + ⓘ**：复用 `InfoHint`；悬停、聚焦或点击可查看当前吸附方式、手动 Pose 与显式求解的区别、快捷键、连接身份和安全边界。
2. **Geometry Check**：当前最新 Pose 的严格检查状态、Revision、零件／连接数、Revalidate、错误数量及首个原因。完整错误和现有 `inspectAssemblyCollisions` 空间证据放在折叠诊断中；操作错误的完整文本也保留。待修复来源与过期复验阻断继续直接可见。Undo、Redo、保存 Draft 仍为常用入口。
3. **Tiles & Connections**：一片一行，显示真实 ID、版本化 Profile、颜色及邻接连接按钮。点击行或 ID 选择 Tile；点击连接按钮选择真实 Connection。
4. **Selection Detail**：随同一 Selection 更新。Tile 显示 Profile、颜色、厚度，以及可展开的精确保存 Pose / Profile 规格；编辑状态继续复用上游 PropertyPanel 的位置、旋转、颜色、复制、删除及现有 Port / Snap 操作。Connection 显示 #、A/B、Port、Dihedral、Flip，保留解除、约束修改、端口修改、显式求解，以及转到 B 的重新吸附入口。该入口只选择 B，仍需明确解除占用连接再预览／确认，不隐式修改结构。未选择时不显示空编辑表单。
5. **Edit Tools**（默认折叠）：空白 Draft、重新加载保存 Draft、工具模式、Catalog 添加、当前 Profile 快照厚度等原有全局操作。
6. 原有照片来源／快照及 **Examples / Debug** 折叠区域。Assembly3D 原格式 JSON 加载／导出、相机状态仍在画布下方。

当前 Assembly3D 的 Connection 没有额外的持久化 UUID，既有编辑器以数组索引 `#index` 标识当前快照中的连接。表格两端按钮引用同一个索引，不生成第二条连接。删除、Undo、Redo 后按当前快照重新派生显示；未创建新的选择历史或持久化系统。

## 画布标注

`显示 Tile ID` 默认开启，属于 ThreeDWorkspace 的临时显示设置，不写入 Assembly、Pose、来源或历史。View 与 Edit 复用 `AssemblyAnnotations.tsx`：

- 从实际 ShapeDef、保存 Pose（Gizmo 操作中为现有 transient pose）计算标注锚点；使用同一 R3F camera 每帧投影。
- 标签是同一页面中的普通 DOM Overlay；不创建额外 React root、材质或另一套 Renderer。标签 `pointer-events: none`，点击会到达原有 Mesh / Port / Gizmo。
- 对实际零件 Mesh raycast 遮挡，非选中遮挡标签隐藏；选中 Tile 或连接端点优先分配标签位置，遮挡时用虚线轮廓保留定位。相邻标签尝试有限的屏幕位置，不能安排时隐藏次要标签；表格始终提供全部 ID。
- 选中 Connection 时，原有 MagnetPieceMesh 高亮两端；通过同一 Pose 与真实 A/B Port 端点绘制深色连接边，Invalid Draft 中分离的两个端口也分别显示。
- opt-in 参数仅从 Assembly 传入；Reconstruction / Tutorial 默认不开启这些标签与连接高亮。

标签是定位辅助，不保证密集、重叠或背面所有零件同时显示；可从表格选择、旋转或 Fit 定位。视觉遮挡不改变几何合法性。

## 保留的安全边界

- Diagnostic → 明确 Override → 待修复 Draft 的前后端条件不变。
- Invalid / 未复验或验证过期仍为阻断，不降级为 Warning。
- Invalid Draft 可以保存、刷新恢复；正式 Assembly / Build 使用原有严格检查及最新 Revision / Hash 凭据。
- View、表格选择、标签开关、相机操作不求解、不改变 Pose 或 Connection。
- 吸附预览、确认、取消、失败回滚和解除／重新连接仍由原有 Editor 操作负责。

## 验证记录（2026-10-31）

- `npm run test:magnetic-3d`：18 文件、200 项通过；包括六面立方体、混合 Profile、反向遍历、折角、闭环、Snap 和 Tutorial。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs`：167 项通过，含 2D、Visible 3D、来源／History／Override 等回归。
- `npm run build`：TypeScript 和生产构建通过；保留 Vite 大 chunk 提示，本轮不调整打包架构。
- `npm run test:magnetic-3d:inspector:browser`：橙色六片、7 条唯一连接在表格出现 14 个引用；选择／标签／真实 canvas 命中、相机旋转、标签开关、Pose 不变、解除／Undo／Redo、严格复验失败、保存刷新恢复；1660 / 1100 / 680 宽度无页面或表格水平溢出，无浏览器错误。
- 原有 `test:magnetic-3d:browser`、`test:magnetic-3d:editor:browser`、`test:magnetic-3d:snap:browser`、`test:magnetic-3d:tutorial:browser`、`test:magnetic-click-snap:browser` 均通过。
- `test:magnetic-visible3d:execution-v3:browser`：合法／Diagnostic 候选、Coverage、来源历史、Trace、相机隔离及向 Assembly 交接通过。
- `test:magnetic-visible3d:override:browser`：复用既有橙色来源到临时 API；六片 Pose / Profile / Connection / Camera 完整交接，Invalid 与过期凭据阻断 Build，明确修复并复验后才解除。

浏览器测试使用项目已有隔离 Chrome / WebGL 脚本；本轮内置浏览器连接不可用。截图及结果在 `/tmp/magnetic-3d-inspector/`，其他测试保留各自现有 `/tmp` 输出目录。无付费模型调用、无正式历史写入。

## 手工验收

1. 从现有橙色 Plan 选择六片 Diagnostic，按既有 Override 流程进入 3D Assembly。
2. 检查右栏顶部红色 Geometry Invalid、Revision / 6 片 / 7 连接；展开 Collision Diagnostic 查看所有错误与空间证据。
3. 点击表格每个 Tile，观察详情与对应标签／零件；背面可旋转查看。点击两端的同一 `#` 连接，应得到相同 Connection Detail、两个端点标签和 Port 高亮。
4. 开关 `显示 Tile ID`，旋转、缩放、Fit / Reset；确认标签跟随相机且不阻挡点击或 Gizmo。
5. Edit Draft 中编辑 Pose，或从 Connection Detail 解除连接后选择 B、预览并确认重新吸附。检查取消／Undo／Redo；几何状态按当前 Draft 更新。
6. 点击 Revalidate：未修复碰撞仍显示 Invalid。保存 Draft、刷新、重新打开后，结构应保持一致；Invalid 或过期时 Build 仍被阻断。
7. 展开 Edit Tools 使用 Catalog / 工具 / 快照厚度；展开来源、Examples / Debug 和 JSON 区域确认原能力可访问。在窄屏通过现有工作区／检查器切换查看。

## Collision Visualization V1（2026-10-31）

Geometry Check 现在包含紧凑的 Collision Review：读取当前严格报告的 `intersection` Error，显示零件对、SAT depth、原因，支持选择／取消和「聚焦碰撞」。不修改 Geometry Valid、碰撞阈值、接缝规则、Reconstruction Override 或 Build 阻断；没有人工强制通过入口。

复用调查：`src/brick-test/viewer.ts` 的 `highlight()` 已实现按真实 ID 高亮多对象、弱化其余对象和 focusBox，但没有基于精确实体交集的网格。此轮沿用该交互思路，实际代码复用磁力片现有 `MagnetPieceMesh`、`AssemblyTileLabels`、`computeFitCamera` / `applyFitResult` / OrbitControls，未修改 Brick / DUPLO Viewer。

### 交叠区域的证据与渲染

- `collision-visual.ts` 读取原 `inspectAssemblyCollisions` / `inspectCollisionPair` 的交集顶点。该诊断沿用 Validator 的同一满厚凸棱柱，已枚举内部原顶点和双方 edge/face crossing。
- 凸体交集仍是凸体，因此 Three.js 已有 `ConvexHull` 可从这些顶点构建实际交集表面；没有新增 SAT、求解器、物理引擎、圆角模型或 CSG 系统。计算体积与体积重心，使用局部坐标生成 GPU 网格。
- `CollisionOverlay.tsx` 在原 R3F Canvas 中绘制半透明红色交集及边界，采用透视/X-ray 显示，允许从其他板后方观察。标签明确写出 Collision Geometry 与 depth。它代表当前满厚碰撞代理，不能解释为 Viewer 外框／薄中央板／装饰网格或真实塑料材料的交集。
- SAT depth 仅显示为数值；不用于球体半径、包围盒尺寸或放大交集。聚焦的相机留白基于实际交集范围，完全不改变网格。
- 顶点不足、共面或体积不可靠时，仅画来自证据的包围线框并标明 Approximate；没有空间坐标时明确提示不可定位并禁用聚焦，不伪造体积。
- 所有 Overlay 的 Three raycast 和 DOM pointer events 均禁用。其他 Tile 使用已有实例材质的可逆 `inspectionMuted` 显示；不修改共享材质。退出碰撞检查恢复原显示。碰撞期间始终显示两端 Tile ID，即使普通 ID 开关关闭。

### 选择与生命周期

扩展现有临时 `Selection` 为 collision 选项，没有另建选择管理器或存档。Tile、Connection、Collision 互斥选择；表格用独立的“碰撞参与者”描边表示两端，并没有伪装成多选。Selection Detail 显示当前碰撞中心、体积、接点关系与可折叠 Raw 证据。

选择保存当前加载代次和完整 `serializeAssembly3D` 快照作为临时身份；这比仅匹配 Revision 更严格，也没有新增持久化 Hash／History。每次渲染核对整个当前快照；不匹配时直接不渲染 Overlay，再清除旧选择。编辑、Undo／Redo、加载、阶段离开和 Revalidate 都清理旧碰撞选择。原有正式 SHA、Revision、CAS、几何复验凭据仍走原机制。

仅为所选碰撞提取空间证据、构建一个交集网格，普通相机变化不重新求交；换选后释放旧网格／边线。聚焦复用相机 Fit 的 current direction，保持朝向与 up，仅调整相机／Target／Zoom，不改 Reset 默认状态，不自动保存相机或 Draft。

### 橙色保存快照的四组结果

世界坐标对应保存的根 Pose；如果整件作品刚体旋转／平移，区域跟随变换。

| Collision | 体积重心 XYZ（约） | 交集体积 |
|---|---|---|
| tile1 / tile2 | -0.4942265, -0.485, -0.020 | 7.7942286e-6 |
| tile1 / tile4 | 0.4942265, -0.485, -0.020 | 7.7942286e-6 |
| tile3 / tile5 | -0.4855662, -0.485, -0.015 | 7.7942286e-6 |
| tile3 / tile6 | 0.4855662, -0.485, -0.015 | 7.7942286e-6 |

每组 depth≈0.015；每个表面网格有 8 个三角面。它们集中在前上缘左右两个多片汇合点，每个汇合点有两组独立碰撞，不能误解为四个相距很远的位置。原 six-piece / seven-connection Geometry Invalid 状态保持不变。

### 测试、性能与边界

- 新增 5 项确定性测试：独立半空间平面三元组枚举与所有四组网格顶点、体积、内部重心一致；大面积重叠和正交板面穿透；刚体变换；缺失／共面证据降级；合法立方体没有假碰撞。depth 改为任意数值不改变网格的测试，防止误将 depth 当作尺寸。
- 3D 共 205 项、相关 Node 回归 167 项通过；TypeScript／生产构建通过。Vite 保留现有大 chunk 提示。
- 新浏览器脚本 `npm run test:magnetic-3d:collision:browser` 在隔离 API / Chrome / WebGL 中读取正式橙色快照但不写回，检查四条选择／聚焦、相机旋转、真实 Tile 射线命中不被 Overlay 拦截、表格／详情协调、强制两端标签、编辑／Undo／Redo／复验／保存刷新／加载失效、合法立方体、大体积穿透及 1660 / 1100 / 680 布局。
- 既有 Inspector、Snap、Gizmo / Editor、Tutorial、2D click-snap、Diagnostic Override／Build 安全边界浏览器回归通过；没有模型调用或正式历史写入。内置浏览器未连接，使用项目既有隔离 Chrome 测试方式。
- 本机 Node、橙色快照、暖机后 100 次测量：所选诊断提取中位约 0.21ms / P95 0.37ms；交集 Hull 中位约 0.05ms / P95 0.09ms。这是几何计算时间，不是完整浏览器帧率承诺。
- V1 一次显示所选一组。当前 Profile 是严格凸多边形，顶点最多 16 个；不支持将非凸、空心真实材料直接作为同一凸 Hull。曲边以现有 Validator 的采样轮廓为准。近退化证据可明确降级；超大世界坐标仍受现有 GPU 浮点显示精度限制。
- 截图／结果／几何坐标和性能数据在 `/tmp/magnetic-3d-collision/`；没有新增人工审核通过、碰撞豁免或修改正式 Assembly 的逻辑。

### 手动验收

1. 将现有橙色 6/6 Diagnostic 按既有明确 Override 流程送入 Assembly 待修复 Draft；Geometry Check 应仍为 Invalid，Collision Review 有四条。
2. 逐条点击，再点「聚焦碰撞」，观察半透明红色楔形交集、两端 ID、depth；旋转相机查看其立体范围。四条不应显示相同的错误配对或串用坐标。
3. 用 Fit to View／Reset Camera 恢复全图。点击 Tile 或 Connection，Collision 选择应取消，原表格／详情／Gizmo 恢复。再次选同一碰撞可取消。
4. 编辑 Pose、连接或快照厚度，旧 Overlay 应立即消失；Undo／Redo 和 Revalidate 后也不应自动复活旧选择。可从更新后的列表重新选择。
5. 保存 Invalid Draft、刷新恢复，结构与错误仍在，但碰撞选择不持久化。合法立方体显示无碰撞；Invalid／过期 Draft 仍不能进入 Build。
