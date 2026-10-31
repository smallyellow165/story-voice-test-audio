# Magnetic Tiles Studio — Phase 4：3D Build Tutorial

后续确定性自动规划、候选审核及最新验收见 [Phase 5A 文档](magnetic-3d-phase5a.md)；本文保留阶段四交付范围。

2026-10-30。阶段四完成手动编排、预览、播放及本地 Tutorial Draft 保存。没有实现自动 Build Order、真实共享边折叠、物理模拟、Gallery、V4 或照片 Reconstruction，也没有调用付费 LLM。

## 复用上游的范围

源码仍来自既有本地 `3D_Magnetic_Pieces-main` 2.2.0，未重新下载。没有改变阶段一 Engine、Profile Registry、原 2D Build 业务代码或 LEGO Viewer，也没有增加依赖。

以下本地路径以 `src/magnetic-tiles/three-d/` 为根：

| 上游模块 | 本地模块 | 复用及适配 |
|---|---|---|
| `components/tutorial/orchestrator.ts` | `vendor/components/tutorial/orchestrator.ts` | 步骤播放 reducer、动画阶段、入场偏移、时长、高亮、reduced-motion；修正高亮后的偏移及相机时长 |
| `components/tutorial/useTutorialOrchestrator.ts` | 同相对路径 | RAF、播放/暂停、seek/prev/next、自动连续播放、锁定视图；切步时读取目标步骤的时长和配置 |
| `components/tutorial/easing.ts` | 同相对路径 | 保留全部六种缓动实现，仅改类型导入 |
| `components/tutorial/TutorialPlayer.tsx` | 同相对路径 | 保留 AnimatedPiece、CameraRig 的位置/target/zoom 插值、累积显示和新片判断；接入快照 ViewerPiece，复用现有 Mesh、Lighting 和相机工具，控制条采用 Studio 原生按钮 |
| `components/editor/StepTimeline.tsx` | 同相对路径 | 步骤卡、选择、增加、删除、前移/后移、镜头/动画/诊断徽章；在右栏用局部 CSS 排列 |
| `components/editor/TutorialOrchestrationPanel.tsx` | 同相对路径 | 镜头捕获/清除、入场类型及参数、提示、观察点、标注、零件加入/移出；采用实际颜色与 Profile 派生 parts |
| `editor/state.ts` 的历史与步骤操作 | `vendor/editor/tutorial-state.ts` | 复用 clone/commit/Undo/Redo 和步骤、镜头、动画 mutation；直接操作 Tutorial3D，不携带上游项目/教程页面的其他业务数据 |
| `engine/types.ts` 的教学类型 | `vendor/components/tutorial/types.ts` | 原样提取 BuildStepV2、StepCamera、PieceEntranceConfig 等类型，不改变现有 Engine 类型文件 |
| `test/editor.test.ts` 的步骤测试 | `checks/magnetic-3d/tutorial-upstream-steps.vitest.ts` | 复用五项步骤测试；适配来源 fixture，并将重排测试改为验证稳定 ID |

来源、MIT 版权、原文件 SHA-256 与精确补丁在 `third_party/3D_Magnetic_Pieces/TUTORIAL.md`、`tutorial.patch`。图标替换为局部原生字符组件，未引入 Lucide、Tailwind 或新动画库。

## 数据、关联与调用关系

`Tutorial3D` 是一个教程文档，不是新的几何模型：

```ts
{
  kind: 'magnetic-tutorial-3d', schemaVersion: 1,
  id, revision, title,
  source: { assemblyId, assemblyRevision },
  assembly: Assembly3D, // 完整独立快照：ProfileSnapshot、颜色、厚度、最终 Pose、Connections
  steps: BuildStepV2[]  // 稳定步骤 ID、addedPieceIds、说明、camera、entrance 等
}
```

来源 ID/revision 必须与内嵌 Assembly 一致。与当前作品的匹配还比较完整内容，避免同 ID/revision 但 Pose 或快照已变更时误匹配。来源当前尚未保存也可以创建教程：捕获的是点击创建当时的确定内存版本，随后独立保存。教程永不自动同步来源。

`ThreeDWorkspace` 仅通过 Studio context 报告当前已提交 Assembly；实时拖动预览不成为教程来源。`ThreeDBuildWorkspace` 显式创建独立快照，派生 `tutorialProject()` 供上游编辑面板使用；这个兼容对象不序列化，也不建立第二套 Shape Registry。

编辑调用 `tutorial-state` 的 mutation → 同步步骤连接 → 结构检查 → 历史快照。零件只能由普通 UI 分配到一个新增步骤；将已分配零件加入另一阶段表示明确移入。移出或删步不会删除来源零件，未分配零件产生 Diagnostic。重排保留步骤 ID、相机、说明及动画，不沿用上游重新编号的行为。

每步 `addedConnections` 是确定的来源连接子集：当连接两端首次都可见时加入。重排/分配后自动从原始 Connections 派生，不创建几何连接，不运行 Solver。导入时检查这些数据与来源一致；不会悄悄修正伪造或过期连接。

Player 按步骤累积 Piece ID，使用阶段一 Profile Adapter 和原始保存 Pose 渲染。入场位移、旋转、透明度仅施加到显示 group；最终 Assembly 不变。教程编辑 mutation 也检查来源快照不能被更改。没有播放代码调用 Solver。

播放位置、RAF elapsed、自动播放、锁定视图等仅存在于 Player 内存，不进入 Tutorial3D。离开 3D Build 会卸载播放器并停止动画；同页保留选中步骤，刷新恢复教程后从第一步静态预览开始。

## 必要修复与兼容性修改

1. 上游 Player 从固定 Model/Shape 名称重新求解位姿，改为已有 `createViewerModel()` 读取完整 ProfileSnapshot 与保存 Pose。复用阶段二的资源清理和共享 Shape 几何缓存，不改变 Viewer / Editor 的算法。
2. Hook 的 next/prev/seek/自动切步改用目标步骤的数据；RAF 直接读取当前步骤，避免沿用上一阶段的时长。编辑步骤后重置相应预览，但 Player 回报播放位置不会反向重置自身。
3. 上游 `tick()` 的相机过渡固定 800ms，改为尊重保存的 `transitionMs`，支持 0ms 瞬切。步骤总时长至少容纳镜头过渡。入场配置使用合法保存范围内的实际时长，不再被无提示地压成 700–1000ms。
4. `getEntranceOffset()` 在高亮阶段返回最终 Pose 的零偏移；原逻辑在高亮结束时会将零件再次拉回入场起点。
5. 保留上游镜头线性插值，起点改为实际当前相机，而非默认相机。过渡结束后停止回写，Fit/Reset 或用户拖动不会被下一帧覆盖。相机最终值在更新 zoom 后明确报告，避免最终状态少一帧。
6. 避免同时启动上游 Mesh 自带的 `isNew` 下落动画与 Player 的 AnimatedPiece；Player 独立驱动已有动画，Mesh 仅通过选择轮廓区分新片，避免重复入场和隐藏 Pose 偏移。
7. 自动播放串行使用上游 Hook 的 autoNext，暂停同时取消等待中的自动切步；完成、重播本步、重新播放与步骤跳转仍由同一编排器控制。减少动态设置被尊重。
8. 未提供无实际实现的吸附 pulse/glow 开关；UI 不提供假装共享边铰链运动的 fold 选项。旧数据中的相关可选字段可以保留，fold 仅是上游视觉旋转偏移，不代表共享边铰链动画。

## 几何与顺序诊断

`validateTutorial3D()` 是教程检查边界，几何判断统一调用阶段一 `validateAssembly3D()`：

- 最终 Assembly Geometry Valid：检查完整来源的实际 Pose、端口、连接、碰撞和闭环残差。
- 当前步骤 Geometry Valid：用累计可见片及其真实来源连接构造子 Assembly，检查同样的几何条件；不为动画重新求解。
- Connected Construction：累计结构非空且只有一个组件。它与几何合法分开显示；合法的自由片也可能不满足连通搭建。
- 地面接触：复用现有 Validator 的 ground 检查，并用已有世界顶点工具提示是否有接近地面（0.02 世界单位容差）的顶点。这只是接触提示，不判断真实承重、支撑传递、磁力或站立稳定性。
- 编排完整性：未分配、重复分配、空步骤、未建步骤等独立诊断。

未通过检查的教程可以保存为 Draft，包括 Geometry Invalid 来源。UI 对这种来源明确显示“创建未验证 Tutorial Draft”。“几何与顺序检查通过”是重新计算的结果，不是可导入的权威布尔标志，也不是正式发布或物理保证。本阶段没有发布系统。

## 保存、导入与隔离

继续使用 Studio 的 localStorage 快照模式。独立键 `magnetic-tiles.tutorial3d-draft.v1`，保存完整 Tutorial3D JSON；不写 `magnetic-tiles.assembly3d-draft.v1` 或 2D `magnetic-tiles.build.v1`，不新增后端数据库/API。

支持保存、重新加载已保存教程、JSON 文本和文件导入、导出同格式 JSON。导入不自动覆盖保存槽，显示未保存 Draft；格式或引用损坏则保留当前教程。新建或替换未保存教程前有确认。结构可保存但几何不合法时，不会自动修正。文件/序列化限制为 2 MB，步骤上限 1000；加载及保存限制一致。

保存使用与阶段三一致的原始值比较：另一个页面已更新时拒绝已知过期覆盖；不是原子跨标签页锁。配额错误和损坏旧存档不会覆盖旧值。启动时损坏的存档禁止本页保存，可先备份/处理该键再刷新。只有一个本地保存槽；多个作品请分别导出。

来源被修改、重载或切换后，旧教程保持原快照并显示来源不一致提示。需要新版本时，必须明确创建新教程；不会悄悄重绑。刷新默认回到 2D 模式，点“3D 教程”恢复已保存教程。

## 手动验收：两片 90° 连接

1. 打开现有 Studio：`magnetic-tiles.html?stage=assembly`。Assembly → 3D 查看 → “两片 90° 连接”。
2. 左栏进入 Build，点“3D 教程”。右栏点“从当前 3D Assembly 创建教程”。
3. 点“新增步骤”，标题填“底座”，说明填“先放第一片”。在右栏下方“添加已有零件到本步”展开列表，将 `base` 加入。
4. 可点“原位淡入”设置本步所有新片动画；旋转/平移/缩放中栏相机，点“设为本步镜头”。可设置过渡毫秒数，0 表示瞬切。
5. 新增第二步，标题填“垂直连接”，加入 `wall`，设置说明和另一观察镜头。当前应显示最终几何合法、两步完整覆盖、Connected Construction 通过。
6. 点时间线卡或上/下一步，检查累计片与新增片的亮色轮廓；自动播放、暂停、重播本步、重新播放、Fit/Reset、锁定镜头应正常。镜头交互不会写入教程，只有“设为/更新为本步镜头”才保存观察视角。
7. 用卡片箭头重排、删除步骤，再用教程 Undo/Redo 恢复。每步标题、说明、相机和分配应跟随稳定 ID。
8. 保存 Tutorial Draft，导出 JSON，刷新后重新点“3D 教程”，再导出逐字段比对。相机、Pose、ProfileSnapshot、步骤和连接应一致；播放进度不会混入文档。

## 手动验收：六片立方体

1. Assembly → 3D 打开“闭合立方体 · 12 条连接”，可直接使用示例，或创建并保存 Assembly Draft 后进入 Build → 3D。
2. 显式创建新 Tutorial Draft。手动创建六步，依次分配 `bottom → front → back → right → left → top`。每步可保存不同镜头和说明；最后应完整覆盖六片、十二条来源连接，并通过几何与顺序检查。
3. 也可以先按来源列表的 `bottom → top → front → back → right → left` 编排；第二步会出现两个组件的 Diagnostic。使用 top 所在卡的“后移”将它移到最后，验证中间步骤连通诊断随之消失。
4. 自动播放至完成，应累计显示六片并高亮最后加入的顶面。播放期间导出的来源 Pose 和 ProfileSnapshot 不变。
5. 保存、刷新、重新加载、文本导入、文件导入均应保持完整数据。再回 Assembly 导出，确认原作品未修改。
6. 改变当前 Assembly 或切换另一个示例，返回 Build 时旧教程应显示来源不一致，继续显示旧快照。切换 2D 教程后，原 2D 教程和完成状态应保持。

## 本次验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 全部 3D Engine / Adapter / Viewer / Editor / Tutorial | `npm run test:magnetic-3d` | 11 文件、144 项通过；包括复用的五项步骤测试及十五项新教程回归 |
| 现有磁力片回归 | `node --experimental-strip-types --test test/magnetic-*.test.mjs` | 121 项通过 |
| 3D 严格类型检查 | `npm run typecheck:magnetic-3d` | 通过 |
| 项目 tsc 和生产构建 | `npm run build` | 通过；仍有大 chunk 提示 |
| Viewer 浏览器回归 | `npm run test:magnetic-3d:browser` | 通过 |
| Editor 浏览器回归 | `npm run test:magnetic-3d:editor:browser` | 通过 |
| Tutorial 真实浏览器 | `npm run test:magnetic-3d:tutorial:browser` | 两片与立方体手动编排、鼠标相机捕获、不同步骤时长、暂停/续播、完成、快速新增/分配、步骤重排/删除/Undo、诊断、合法/非法 Draft 保存刷新、加载/导入/导出、来源隔离及 2D 完成状态保留通过 |

Browser 连接无可用浏览器，沿用既有独立脚本模式：真实 Chrome + 软件 WebGL、全新上下文、临时数据目录，业务 POST 被拒绝。本次没有页面异常、console error 或业务写请求；无正式数据操作。脚本复用相邻 V4 client 已安装的 Playwright 和本机 Chrome，仅为测试依赖，不集成 V4。可设置 `CHROME_PATH`；验收产物为 `/tmp/magnetic-phase4-browser/{result.json,right-angle.png,cube.png}`。

单元测试覆盖来源内容匹配、快照独立/不可变、合法与非法教程、Profile/颜色/Pose/相机往返、步骤覆盖/连接派生、稳定 ID、历史、存储冲突/配额/损坏、入场阶段、暂停、镜头时长和 reduced-motion。没有为适配另写 Geometry Validator 或动画系统。

## 限制与未来自动 Build Order

本阶段只保存一个本地 Tutorial Draft；Undo/Redo 为 100 步内存历史，不跨刷新。相机 zoom 按正交相机值保存，不是不同屏幕比例下相同画面占比的保证；需要时 Fit to View。沿用上游线性镜头插值，不做镜头路径的模型避障。没有穷举大型模型、所有动画组合、触控或跨标签页并发压力场景。

Connected Construction 不等于现实容易搭建。没有物理模拟、支撑稳定性证明或闭环全局优化；继续沿用阶段一几何与碰撞精度限制。不提供真实铰链折叠；没有消费上游尚未实现的 snapFeedback 特效。

未来手动和自动编排均应输出同一种 Tutorial3D / BuildStepV2。自动生成器以固定 Assembly3D 快照为输入，生成稳定步骤 ID、零件分配和可选镜头，再经过本次同一检查边界进入同一个 Player。先用当前连通性、覆盖和几何诊断评估候选顺序，再考虑启发式或 LLM；不要让生成器或播放器改写最终 Pose。本次到阶段四停止。
