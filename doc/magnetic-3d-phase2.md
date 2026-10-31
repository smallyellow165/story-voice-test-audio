# Magnetic Tiles Studio — 3D Viewer Phase 2

后续已完成的 3D Assembly Editor、Draft 持久化与最新验收记录见 [阶段三文档](magnetic-3d-phase3.md)；本文保留阶段二交付时的范围说明。

阶段二已在现有 Studio 三栏中接入可交互 Three.js Viewer。使用阶段一 Assembly3D、Profile Adapter 和实际保存的 Pose；相机操作、选择、加载和重新加载均不调用 Solver，不自动贴地，也不改写二维作品。到此停止，未开始 3D Assembly Editor。

**如何在 UI 验收**

1. 运行项目原有 `npm run dev`，打开 `http://localhost:5173/story-voice-test-audio/magnetic-tiles.html?stage=assembly`（已有服务若使用其他端口，沿用其端口）。第 4 步「作品编辑（Assembly）」中栏点击「3D 查看」。默认仍是「2D 查看」。Viewer 本身无需模型或语音服务 Key。
2. 点击「两片 90° 连接」。中栏显示真实厚度的两片，状态应为 **2 片 / 1 条连接 / 几何校验通过**。
3. 点击「闭合立方体 · 12 条连接」。状态应为 **6 片 / 12 条连接 / 1 个组件 / 几何校验通过**。旋转观察背面与内部；这里的连接数和通过状态来自阶段一 Validator 对实际保存位姿的检查。
4. 点击「方片与三角形 · 含自由片」。应有 **3 片 / 1 条连接 / 2 个组件**；除已连接的方片/三角形，还显示一个放大的 `right-triangle@2` 自由片，其厚度为 0.08，具有独立位置/旋转。此 v2 是示例快照，不会写入 Profile Registry。
5. 左键拖动旋转、滚轮缩放、右键拖动平移。「Fit to View」以当前方向居中并适配全部零件；「Reset Camera」恢复默认斜视角与全图适配。改变栏目宽度后仍应完整取景。
6. 点击实际模型上的一个面，确认其中心板高亮，右栏显示对应实例。也可从右栏列表选择，检查 Profile ID@Version、颜色、位置 XYZ、XYZ 欧拉角（度）、原始 XYZW 四元数、真实边长和厚度。
7. 展开「加载 / 导出 Assembly3D」，可选择 JSON 文件或粘贴同一 Assembly3D JSON 后点击「加载 JSON」。点击「重新加载来源」应恢复最后成功加载的源文本；不会用当前 Catalog 的最新 Profile 替换快照。导出后核对 pieces.pose、profiles 与颜色一致。
8. 可在导出的混合示例 JSON 中把自由片改为位置 `[4.123,-0.75,2.5]`、厚度 0.123，重新加载后核对 Inspector 和模型。不需要把它移到地面。若约束不满足，显示几何问题并仍按原位姿显示；结构/引用非法的 JSON 则报错并保留此前作品。
9. 切回「2D 查看」：原二维作品、选中/草稿及保存机制保持原样。切换 Analysis、Review、Reconstruction、Assembly、Build 继续原流程，返回 Assembly 默认进入 2D；再点 3D 可继续查看本次页面内加载的快照。

窄屏沿用原来的「工作区 / 检查器」切换，零件列表也能完成选择。3D 不是当前 2D Assembly 的自动立体重建；本阶段只查看已知 Assembly3D 快照。

**复用与兼容修改**

保留上游 `MagnetScene3D` 的 Canvas/SceneContent/OrbitControls 结构，以及 `magnet3d/primitives`、`cameraUtils`、`SceneLighting`、`utils/geometry`。没有重做几何 Engine，也没有改动阶段一 vendor/engine 核心算法。详细来源、原始哈希及本地修改见 `third_party/3D_Magnetic_Pieces/VIEWER.md` 与 `viewer.patch`；原 MIT 许可证保留。

主要边界修改：固定 Model/shape-name 查找改为版本化 ProfileSnapshot resolver；直接采用保存的 position/quaternion；保留三角形面积质心原点；几何只在 Z 方向居中，中心板/装饰磁铁保持在声明厚度内；缓存按实际 ShapeDef 对象隔离并在文档退出时清理；材质由每片 mesh 管理，避免跨 Canvas 分辨率及过早释放问题。

沿用上游正交 Fit 的投影算法，补充当前视角保留、投影边界居中与相机裁剪范围。Fit 与 Reset 只影响相机。默认关闭接触阴影，避免对任意保存的负高度/自由片暗示地面落位。

保留 React/ReactDOM 19.2.8、TypeScript 6、Vite 8.2.2、Three/@types 0.180.0。仅添加精确版本 R3F 9.8.1 与 Drei 10.7.9；安装的 peer 范围兼容，`npm ls` 确认 React、Three、R3F 均去重，原有依赖版本未改变。Viewer 懒加载，2D 默认入口不初始化 WebGL。没有添加 Lucide、Tailwind、物理引擎，也没有重构 LEGO/DUPLO。

**Assembly3D 与加载语义**

继续使用阶段一的 `kind:'magnetic-assembly-3d', schemaVersion:1`。为 Piece3D 增加可选 `color:'#RRGGBB'`；旧无颜色快照可继续加载，使用仅渲染默认色，导出不擅自补字段。

3D 加载状态和原始来源只保留在当前页面内存，支持文件、JSON 文本、重新加载、导出。刷新整个页面后会回到默认示例；需要保留作品应先导出。没有新增 3D 存档库、服务器作品格式或 Gallery，也不读写原 2D 存档。单文件限制 1 MB。

示例是仓库中的实际 Assembly3D JSON，运行时仅 parse、适配和验证。90°/混合连接的保存位姿由阶段一 Solver 离线生成；立方体由已知六面位姿及完整 12 边 fixture 生成，再经实际 Validator 验证。渲染代码不根据显示需求重新求解、平移模型或居中片的 pose；居中取景通过移动相机完成。

**自动化检查与证据**

```bash
npm run test:magnetic-3d
npm run typecheck:magnetic-3d
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run build
npm run test:magnetic-3d:browser
```

验证结果（2026-10-30）：

| 检查 | 结果 |
|---|---|
| 3D Engine + Viewer 逻辑/几何 | **106 项通过，7 个文件**；含阶段一原 97 项 |
| 现有磁力片 2D 回归 | **121 项通过** |
| TypeScript（含 3D 测试） | 通过 |
| 全项目生产构建 | 通过；保留大 chunk 提示 |
| 实际 WebGL 浏览器验收 | 三示例、相机旋转/缩放/平移/Fit/Reset、画布 raycast 与列表选择、Inspector、文件/重新加载/导出一致性、错误输入保留来源、2D 草稿及五阶段导航、390px 窄屏通过 |

浏览器验收脚本启动临时 Vite 和真实磁力片只读 API，数据目录及浏览器上下文均隔离；禁止所有业务 POST，结束后清理临时数据并关闭服务器。没有读取或修改正式生产作品，也没有调用识别/LLM。使用共享工作区现有 Playwright 与 `/usr/bin/google-chrome`，可用 `CHROME_PATH` 指定已安装浏览器；无需另建通用浏览器框架。

默认浏览器证据输出 `/tmp/magnetic-phase2-browser/`：`result.json`、三示例截图、`cube-selected.png`、`mobile.png`。可通过 `MAGNETIC_3D_ARTIFACTS` 改输出目录。当前验收记录为 **writes=[]、page errors=[]、console errors=[]**。测试等待真实 Canvas 尺寸完成，避免把初始 300×150 缓冲区当作可点击区域。

新增数值检查包括三角形外轮廓与质心对齐、实际厚度包络、同 ID 不同快照的缓存隔离/释放、保存位姿不被求解、颜色往返、窄/宽画布下所有组件的投影边界。没有声称全覆盖所有显卡、交互或分支覆盖率。

**已知限制与阶段三建议**

当前是只读查看：没有拖动零件、连接编辑、角度编辑、Tutorial、照片重建、Gallery 或 V4。透明面采用上游材质/排序，复杂重叠透明结构仍可能有 Three.js 常见排序局限；帧和中心板属于视觉表现，不能据此判断真实磁力稳定性。曲边与几何容差仍沿用阶段一已记录的近似边界。

需浏览器支持 WebGL；不支持时显示错误/回退提示，2D 工作流仍可用。截图验收使用软件 WebGL，并未逐一覆盖真实移动 GPU。3D 加载文档只在本页保留，暂未做持久化存档 UI。

阶段三建议继续移植上游 `editor/state`、`snap`、`EditorCanvas`、`PropertyPanel` 等交互，通过当前 catalog/Assembly3D 边界接入，保留本阶段 mesh、选择和相机实现。先明确编辑提交、显式求解和保存时机，沿用实际 pose 校验及原 undo/redo，不建立第二套几何逻辑。本轮不自动开展这些工作。
