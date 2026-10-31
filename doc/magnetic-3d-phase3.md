# Magnetic Tiles Studio — Phase 3：3D Assembly Editor

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
