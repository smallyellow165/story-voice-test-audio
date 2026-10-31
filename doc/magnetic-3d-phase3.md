# Magnetic Tiles Studio — Phase 3：3D Assembly Editor

后续已完成的 Build Tutorial、来源快照隔离与最新验收记录见 [阶段四文档](magnetic-3d-phase4.md)；本文保留阶段三交付时的范围说明。

2026-10-30。阶段三已实现；停在 Editor，不包含 Tutorial、Gallery、V4 或照片重建。

## 实际复用与边界

沿用本地 `3D_Magnetic_Pieces-main` 2.2.0，未下载其他版本。继续使用阶段一 Engine、Profile Adapter 和阶段二 Mesh / 相机组件，没有修改 Geometry Engine 核心算法、原有 2D 业务逻辑或 LEGO Viewer。

| 上游源码 | 本地位置（相对于 `src/magnetic-tiles/three-d/`） | 复用与适配 |
|---|---|---|
| `editor/state.ts` | `vendor/editor/state.ts` | 保留快照历史、克隆、批量提交、Undo/Redo 的实现；mutation 改为直接操作 Assembly3D |
| `editor/id.ts` | `vendor/editor/id.ts` | 原样复用 ID 工具 |
| `editor/snap.ts` | `vendor/editor/snap.ts` | 保留端口占用、兼容目标、世界空间端口、候选排序和连接位姿计算；改用实际 Profile 端口与保存 Pose |
| `components/editor/EditorCanvas.tsx` | `vendor/components/editor/EditorCanvas.tsx` | 保留 R3F 画布、TransformControls、磁吸预览、键盘移动旋转、连接线、方向视图、相机 Fit/Reset、事务式拖动 |
| `components/editor/PropertyPanel.tsx` | `vendor/components/editor/PropertyPanel.tsx` | 复用 PieceProps / ConnectionProps，含 Euler 转换、轴旋转、复制删除、二面角预设、flip、断开连接；移除教程及项目元数据 UI |
| `test/editor.test.ts` | `checks/magnetic-3d/editor-upstream-history.vitest.ts` | 保留 ID 与历史的 7 项原测试，适配 Profile / 颜色参数 |

`editor-project.ts` 将 Assembly3D 派生为上游 Canvas / Snap 需要的 parts、pieces、transforms 及 shapes Map。这个对象仅存在于内存，不保存、不入历史；shapes 来自阶段一 `createShapeCatalog()`，不是第二套 Registry。

调用关系：`ThreeDWorkspace → EditorInspector / EditorCanvas → vendor/editor/state → Assembly3D`；实时拖动仅提供临时 Pose 覆盖，释放鼠标才提交一次历史。显示与诊断统一通过 `createViewerModel()` / `validateAssembly3D()` 消费实际 Pose。只有“吸附并建立连接”、磁吸拖动释放，以及明确标注“显式求解”的操作调用阶段一 Solver。

## 必要适配与修复

- 上游固定 Shape 名称改为实际快照 ID@Version 的派生 Shape；端口长度和厚度使用 Profile Adapter 输出。颜色使用 #RRGGBB。沿用阶段二 React 19 / R3F 9 / Drei 10 / Three 0.180，无新增依赖。
- 上游显示缺少 transform 时隐式求解、移动时推断二面角或拆连接等行为不沿用。手动移动只改变 Pose，连接保持原样，非法状态由原 Validator 报告。
- 修改二面角、flip、连接端点只修改约束；显式求解以选中片（或连接 A）当前 Pose 为固定根，仅处理该连通组件。无关组件即使已经非法也保持原 Pose。
- 磁吸释放将“建立连接 + 求解位姿”合并为一个可撤销事务，移除上游先提交 Pose 再创建连接的双重提交路径。
- 端口长度兼容阈值从上游 5% 对齐为 Engine 的 1%，避免推荐 Validator 必定拒绝的边。
- PropertyPanel 位置字段保留完整数值，避免修改一个轴时将另两轴四舍五入；旋转编辑仍使用上游 Euler XYZ 转四元数，存档只以 quaternion 为准。
- 复用 Canvas 时修复首屏 Fit 的定时器被连续更新取消、键盘定时器清理、重复 TransformControls 事件监听；输入框内和 Ctrl/Cmd 快捷键不会触发零件移动。普通选择不写 Pose。
- 稳定缓存每组 Profile 快照的 Shape 对象，Pose 编辑不会反复销毁共享 Geometry；使用阶段二 WebGL 错误边界。去除开发全局变量注入，工具布局改为局部 CSS，不引入 Tailwind。

完整来源、MIT 版权、原文件 SHA-256 与本地差异见 `third_party/3D_Magnetic_Pieces/EDITOR.md`、`editor.patch`。阶段三没有改写 Engine 算法补丁。

## Profile 与 Assembly3D 契约

从当前版本化 Registry 选择完整 Profile，复制至 Assembly3D.profiles；根据 vertices、edges、segments、scale 和 thickness 转换，未按形状名称推断尺寸。旧文件加载完全使用内嵌 ProfileSnapshot，不替换成 Registry 最新版。

同一个文档里一个 ID@Version 对应一个快照及厚度。添加同版本但不同配置会明确报错，不悄悄替换。修改“当前 Profile 快照厚度”是显式文档操作，影响该文档引用该版本的全部零件，可以撤销，不修改 Registry。颜色是每片独立数据。复制沿用上游 +1 世界 X 偏移，不复制连接；若大尺寸零件因此重叠，会直接显示诊断。

每片 `pose.position` 与 `pose.quaternion` 是权威数据。连接存储端口、二面角和 flip，不是加载时重建 Pose 的指令。合法和未完成结构都使用阶段一 schemaVersion 1 的同一种 Assembly3D 格式；Draft 是编辑/保存状态，Geometry Valid 是当前 Validator 的结果，二者分开显示。保存不会自动修正几何，也不会声称 Draft 已发布或具有物理稳定性。

## 保存、恢复和历史

沿用 Studio `storage.ts` / `build-storage.ts` 的 localStorage 快照模式，独立键 `magnetic-tiles.assembly3d-draft.v1`，值就是序列化 Assembly3D，不新建数据库或作品格式，不触碰 2D 存档/API。`draft-storage.ts` 做结构检查和原始值比较，发现其他标签页已经写入时拒绝覆盖；这是乐观检查，不是跨标签页原子锁。

“保存 3D Draft”保存当前完整 ProfileSnapshot、颜色、Pose、连接与 revision，包括 Geometry Invalid 状态。“重新加载已保存 Draft”读取保存槽；“重新加载来源”读取当前示例/文件/导入来源。两者含义不同。刷新后再次进入 Assembly → 3D，自动打开最后保存的 Draft，默认处于 View。Undo/Redo 沿用上游 100 步内存历史，不跨刷新；未点保存的修改不保证刷新恢复。

配额失败保留旧数据并显示错误；损坏存档不会覆盖写回。启动时损坏的存档会禁止本次页面保存，避免误覆盖；可先导出当前工作，备份/处理该 localStorage 项，再刷新。离开当前作品、打开示例或重新加载前，对未保存修改有确认提示。仅提供一个本地 Draft 保存槽；长期或多作品留存请导出同格式 JSON。

## UI 验收：从零搭建

1. 启动现有开发服务，打开 `magnetic-tiles.html?stage=assembly`。在 Assembly 点“3D 查看”，右栏点“新建空白 3D Draft”。
2. 右栏“从 Tiles Catalog 添加”选择 `square@1`、厚度 0.05、颜色，添加第一片；再添加第二片。Profile 下拉也可选择其他版本/尺寸。
3. 第二片 B 被选中后，在“选择边并连接”设置：目标 A 为第一片，A/B 端口均为 `e0-p0`，二面角 90°，flip 关闭。点“吸附并建立连接”。应看到 2 片、1 条连接、1 个组件、Geometry Valid。
4. 添加 `right-triangle@1`；目标 A 仍为第一片，A 端口改 `e2-p0`，B 端口 `e0-p0`、90°、flip 关闭。吸附后应为合法的 3 片、2 条连接结构。端口选择使用实际边长，不能连接不匹配长度。
5. 工具选“移动 Gizmo”或“旋转 Gizmo”，拖动轴/圆环；或在位置、Euler 角字段输入数值。点击画布/零件列表可以选择和高亮。`WASDQE` 移动，`RTFGVB` 旋转，Shift 大步；一次 Gizmo 拖动对应一次 Undo。相机左键拖空白旋转、右键平移、滚轮缩放，方向按钮和左上角 Fit / 聚焦 / Reset 可恢复视图。
6. “磁吸拖动”复用上游候选/幽灵预览，也可点击蓝色边选择 B 端口后使用右栏显式端口吸附。查看/选择动作不求解。
7. 在“连接关系”选择连接，修改二面角、flip 或连接端点；应先看到约束诊断，Pose 不会自动变化。“显式求解（固定 A）”才按约束摆放。“仅建立约束（不移动）”允许保留尚未满足的约束。可断开连接，Undo 恢复。
8. 复制、删除、修改颜色/快照厚度，分别用 Undo / Redo 检查 Pose、颜色、连接一起恢复。Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 在非输入区域可用。
9. 故意将第二片移动至第一片重叠位置，应显示 Geometry Invalid 和穿透/连接诊断。保存 Draft，再刷新并打开 3D；位置、四元数、颜色、快照和连接应原样恢复，仍然 Invalid。导出 JSON 可逐字段比对。Edit 中显式求解可恢复结构，保存后再重新加载。
10. 打开“闭合立方体 · 12 条连接”，点“从当前作品创建 Draft”。应为 6 片 / 12 条合法连接。移动一片应出现错误；Undo 恢复合法。删除 top 后变 5 片 / 8 条连接，Undo 恢复 6 / 12。示例本身不被覆盖。
11. 切换 View，选片、移动相机、Fit/Reset、导出，JSON 不应变化；再切回 2D，原零件及 Analysis → Build 五阶段行为应保持。

## 自动化与真实浏览器结果

| 检查 | 命令 | 本次结果 |
|---|---|---|
| 3D Engine / Adapter / Viewer / Editor | `npm run test:magnetic-3d` | 9 文件，124 项通过；含上游原 Engine 测试及新复用的 7 项 ID/历史测试 |
| 现有磁力片回归 | `node --experimental-strip-types --test test/magnetic-*.test.mjs` | 121 项通过 |
| 3D 严格类型检查 | `npm run typecheck:magnetic-3d` | 通过 |
| 生产构建及项目 tsc | `npm run build` | 通过；保留现有大 chunk 提示 |
| 阶段二 Viewer 浏览器回归 | `npm run test:magnetic-3d:browser` | 三示例、实际射线选片、相机、加载/导出、移动端及 2D 保留通过 |
| 阶段三 Editor 浏览器验收 | `npm run test:magnetic-3d:editor:browser` | Catalog 添加/复制/删除、真实鼠标 Gizmo 平移与旋转、键盘移动、边吸附、约束诊断、Undo/Redo、非法 Draft 刷新原样恢复、显式修复、立方体编辑/恢复、2D 和五阶段通过 |

浏览器脚本使用真实 Chrome + 软件 WebGL、独立上下文和临时 API 数据目录，禁止业务 POST，未操作正式数据。本次没有 pageerror、console error 或业务写请求。内置 Browser runtime 无可用浏览器，因此使用仓库既有 Playwright 脚本模式。脚本默认复用相邻 V4 client 已装的 Playwright，以及 `/usr/bin/google-chrome`（可设置 `CHROME_PATH`），未给产品添加依赖。Editor 证据输出 `/tmp/magnetic-phase3-browser/{result.json,gizmo.png,restored-cube.png}`，Viewer 证据输出 `/tmp/magnetic-phase2-browser/`。

浏览器验证了显式端口吸附和实际 Gizmo；磁吸拖动的候选与位姿计算另有单元测试，但未穷举所有形状、相机尺度与鼠标磁吸阈值。单元回归覆盖同版本配置冲突、版本/尺寸保留、批量历史、删除立方体连接、无关组件不被求解、非法草稿、存储冲突和配额/损坏失败。

## 已知边界与阶段四建议

现有 Solver 是按图遍历放置并报告闭环残差，不是全局闭环优化器；错误闭环不保证通过求解变合法。保持既有薄片碰撞精度/曲线离散化边界，不提供真实物理稳定性、磁力强度或承重模拟。允许多组件/自由片，它们的组件数明确显示，Geometry Valid 不意味着已连接成单体。复杂零件数量下的交互性能、所有端口磁吸及触控编辑未做穷举压力测试。

下一阶段建议复用上游 Tutorial Player、步骤显示、相机插值和播放控制；在边界层将步骤引用映射到 Assembly3D 的零件 ID 和快照 Pose，继续保留显式编辑/求解与播放隔离，不让教程加载或播放覆盖已保存 Draft。先验证同一 Draft 的增量展示、前后步切换与 Pose 不变，再接现有 Build UI。本次没有实施阶段四。

## Human Collision Review V1（2026-10-31）

此增量将“严格几何结果”和“人工工作流授权”分开。Geometry Check 中 Collision Review 改为 Table；点行只选择原有真实交集可视化，Checkbox 只提交该碰撞的人工接受。进度全部完成后，用户明确点击“批准当前作品”，同时沿用现有 CAS 保存当前 3D Draft。Geometry Invalid、原始 Error 和穿透深度均保持原样，新增独立的 `Human Approved` 状态，不代表真实物理稳定。

只有严格 Validator 的错误全部为已识别、正深度、可定位的 `intersection` 时才能批准。Profile、Port、Dihedral、连接、闭环、未知错误或不可定位的碰撞一律阻断。`human-collision-policy.ts` 只判定授权适用性，不改变 Validator、Solver 或碰撞代理。

### 服务端权威记录

沿用 `magnetic-intake` API 和 Profile Registry 的原子独占发布方式。运行时新审核保存在 `generated/magnetic-intake/assembly3d-review/`：

- `heads/<Assembly ID>/<version>.json`：追加式 CAS 版本链，完整 Assembly3D 快照、Revision、SHA-256、严格 Validator 结果/Hash、已接受项及当前批准 ID。
- `approvals/<id>.json`：不可变人工批准凭据，绑定精确快照及完整碰撞集合；仅当前 head 引用的凭据有效。照片采用来源存在时额外保留原来源 ID/Hash。
- `tutorials/<id>.json`：经服务端重新校验的原格式 Tutorial3D 保存快照及批准引用。不会剪除既有证据；CAS 冲突时未被 head 引用的文件不授予权限。

API 为 `/api/magnetic-intake/assembly3d-review/` 下的 `session/status/sync/accept/approve/revalidate/generate/saveTutorial`，全部使用 POST。除 session 外，要求内存中的会话 capability；每次仍校验开发环境、直接 loopback、无代理及同源 Origin。当前 Studio 没有用户账户/角色系统，本版授权主体是本机操作员，远程/生产访问关闭，不将其宣称为多用户审批系统。会话有效期八小时，刷新后可重新建立会话，已保存批准由服务端恢复。

浏览器 `magnetic-tiles.human-collision-review.v1` 仅保存服务端记录发现标志、CAS 版本及未完成同步的失效标记，不保存权威批准。批准必须从服务端取得并与当前快照精确匹配。几何变更同步清空接受项和批准；Undo/Redo 回到旧字节也不恢复旧授权。同一快照 Revalidate 重新计算诊断，诊断未变可保留授权，变化则清除。保存/刷新不改几何时可恢复。若崩溃前服务端已记录未保存的几何修改、而浏览器恢复较旧的已保存 Draft，会阻断旧授权；显式 Revalidate 并确认使用当前 Draft 后，CAS 注册为新审核版本，必须重新逐项批准。

### Build 集成

Assembly3D 正式格式不变。Tutorial3D.source 仅增加可选 `humanCollisionApproval` 引用（批准 ID、快照 Hash、诊断 Hash），旧文档继续可读；导入引用本身不授予权限。严格几何合法的正常 Worker 路径不变。人工批准的 Invalid 作品通过服务端调用同一个确定性 Build Order 规划器，每一步仍执行原 Validator，只允许与批准凭据逐项相符的碰撞进入工作流；连接性、完整分配及其他结构错误仍阻断。最终和每步的原始 Geometry Valid 字段保持 false，诊断仍为 Error，另标 `humanAccepted` / `humanApproved`。

正式教程保存前服务端再次检查当前 CAS 版本、授权、几何快照、步骤分配、每步几何和连通性，再沿用现有本地 Tutorial 历史/Player。过期或未批准的 Invalid 教程可保留未完成 Draft，但不能普通播放/正式保存。当前 UI 只为与当前 Assembly 精确匹配的批准作品开放；打开其他作品的旧批准教程，需要先恢复对应的 Assembly 快照。既有本地单 Draft 保存槽和最多 50 个教程的 UI 限制不变。

### 验证与手动验收

- `npm run test:magnetic-human-collision`：本机/同源授权、四项逐项接受、严格 Invalid 保留、六步规划、服务器保存、结构错误/伪造引用拒绝、并发 CAS、编辑/Undo 失效、相同诊断 Revalidate、重启恢复、取消接受及记录完整性。
- `npm run test:magnetic-human-collision:browser`：隔离临时 API 与真实 Chrome/WebGL，读取现有橙色六片 Pose；四组真实体积选择/聚焦、接受与选择分离、批准、六步 Player、保存刷新/历史打开、编辑/Undo/取消接受失效、较旧存档恢复及 1660/1100/680 布局。不调用模型，不写正式历史。证据在 `/tmp/magnetic-human-collision-browser/`。
- 用户从 Reconstruction Diagnostic 的既有 Override 进入六片待修复 Draft 后，在 Geometry Check 逐行查看并接受四项碰撞，点击“批准当前作品”。此时仍显示红色 Geometry Invalid 和 Human Approved；进入 Build 点击“生成搭建教程”，检查并保存。回 Assembly 修改 Pose 后旧接受项/批准必须立即失效；Revalidate 仍使用严格 Validator，再逐项审核。

本版没有添加物理规则、自动通过碰撞、磁力、圆角或新的播放器。V1 服务端审核限制为 1–64 片、512 条连接、2 MB Assembly 快照；没有进行大规模性能或多用户角色测试。

## Symmetry Fill V1（2026-10-31）

Edit Draft 工具栏的“对称补全”打开 Inspector 工具，并给现有 Tiles & Connections 增加临时来源 Checkbox。勾选来源、确认平面、预览、确认加入；预览不改 Draft、不撤销已有批准，取消/Escape/离开页面不残留候选。Canvas 保持挂载，候选为真实 Profile/厚度/Pose 的中性半透明外形代理，复用 Tile ID 和 Fit/Reset。它不是照片观察，也不是碰撞放行。

`three-d/symmetry-fill.ts` 的平面为世界 `n·x=d`。自动候选只在来源共面时提供：取来源面的法向、完整理想轮廓沿该方向投影的中心，随后检查未选框架能否按相同 Profile@Version、实体外形和厚度唯一地对称映射。不按实例名、颜色、世界上下或形状名称判断“前后”。这只是受约束的候选假设，必须人工确认。无法确定时可明确选参考 Tile 的局部 X/Y/Z 中心平面及法向偏移；仍需框架几何映射成立。V1 不提供自由 CAD 平面、不推测隐藏结构，不自动补任何其他面。

镜像是 `M(x)=x−2n(n·x−d)`。Pose 使用基向量 `(M·Rx, M·Ry, −M·Rz)` 构造 determinant +1 的旋转；原局部 XY 顶点、Profile 和新片 Port 编号不变。世界法向为 `−M·Rz`，不能直接给 Quaternion 使用 determinant −1 的反射矩阵。当前薄片沿局部 Z 对称挤出、双面显示，因此翻转局部 Z 不改变镜像实体。原框架的反射端口则按实际端点重新查找，方向可能反转，不能沿用旧编号/flip。角度通过 A 原始 Port 轴与双方实际法向的 atan2 计算，并调用原 Solver 的连接变换精确复核。最终仍执行原严格 Validator 的连接、Port、闭环与实体碰撞检查。

新增连接保留来源图的镜像约束，并检查额外的精确端点重合；端口长度必须兼容，端点和完整连接变换必须相符。同一端口多候选、占用冲突、缺少镜像端口、重复实体、结构错误或不连通均拒绝，不能静默覆盖原约束或伪造 Valid。最多 32 个来源、补全后 64 片、1024 个端口和 20000 次候选端口对检查，超预算原 Draft 保持不变。预览绑定原完整序列化快照；确认时重新计算，防止过期/被修改的预览注入数据。

橙色六片的来源 tile2/3/4 给出前后中心平面（原存档约为世界 y=0，这只是本案例坐标结果），新增三个 `sourceID-sym-<hash>` 实例与五条连接：背面三角形内部两条、顶部一条、左右侧面各一条。新 ID 根据快照、平面和来源确定，确认前后及 Undo/Redo 保持一致。原六片 Pose/Profile/颜色、七条 Connection 原样保留，结果 9 片 / 12 条连接、一个组件、底部开放。Ideal Geometry Valid；Solid Collision Invalid，原四项及镜像四项交叠约 0.015，阈值未变。对缺一侧面的五正方形盒子，工具还能只补一片并复核四条连接，得到严格 Geometry Valid 的六面立方体。

确认是原 Editor History 的一次 commit，Revision 增一，复用已有人工审核失效/服务端 CAS 同步。原六片批准不适用于九片，Undo 回六片也不恢复旧批准。九片可继续 Collision Visualization / Revalidate / 保存刷新；八项碰撞重新逐项接受并明确批准后，同一个 Build Order/Player 可生成九步教程。旧六步教程保留，不自动重绑或覆盖；用户需要明确重新生成。

Assembly3D 格式不变。照片来源的原 `origin` 记录完全不改；已有本地照片来源 sidecar 可追加只读 `symmetryFills`（平面、来源/新增 ID、前后 Revision），在“照片来源与快照”折叠区查看。它只作编辑假设追溯，不授予权限或修改 Observation。和原照片来源一致，这份 sidecar 不包含在裸 Assembly3D JSON 中；无照片来源的作品仍可使用工具，但本版没有额外的通用来源档案。模型当前是双面、沿 Z 对称的薄片，不支持有单面装饰或非对称厚度实体的语义镜像。

验证命令：`npm run test:magnetic-3d`（几何/版本/尺寸/任意刚体根位姿、重命名、重复/错误平面/缺失端口、不同作品、原位不变及原全部回归）；`npm run test:magnetic-symmetry-fill`（真实保存案例，六片批准失效、八项重审、九步生成及服务端正式教程保存）；`npm run test:magnetic-symmetry-fill:browser`（临时 API 复制既有来源，真实 Chrome/WebGL，预览三视图、旋转/Fit/Reset、取消/确认、Undo/Redo、保存刷新、九步教程及 1660/1100/680 布局）。浏览器证据在 `/tmp/magnetic-symmetry-browser/`；没有付费模型调用或正式记录写入。

## Assembly 主要操作栏（2026-10-31）

`Revalidate Geometry`、`保存 3D Draft`、`批准当前作品`移到中栏 Viewer 上方的单一操作栏，右栏不再重复。保存仍按原行为仅 Edit Draft 显示；所有事件、disabled 条件、原有错误/成功反馈和审批机制不变。栏内复用当前 Geometry、碰撞数量、审核进度与 Human Approved；右侧仍保留 Geometry Check、Collision Review Table、聚焦/取消、详细诊断、Undo/Redo 和编辑工具。

操作栏在中栏自己的滚动区内 Sticky，沿用列内边距偏移；窄屏自动换行，并仅对 3D Assembly 中栏设置视口高度，确保它仍是滚动容器，不改其他阶段或 2D。Chrome 隔离验收覆盖九片/十二连接、0/8→8/8、严格 Invalid + Human Approved、复验/保存恢复、编辑及 Undo/Redo 后失效、九步 Build，以及 1660/1100/680/430 布局、吸顶和实际点击命中。命令：`npm run test:magnetic-assembly-actions:browser`，证据 `/tmp/magnetic-assembly-actions/`。未调用模型或写入正式历史。
