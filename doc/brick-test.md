# DUPLO 3D Viewer Prototype

独立的 Vite 多页面入口 `/brick-test`，React 控制面板与 Three.js Viewer 分离。

## 启动（用户手动执行）

本次仅编辑代码；没有执行安装、构建、测试或启动服务器。新增依赖写入 `package.json`，`package-lock.json` 保留原状，需用户安装后由 npm 更新；首次不要使用 `npm ci`。

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
npm install
npm run dev:brick
```

访问 `http://localhost:5173/brick-test`。若端口被占用，以 Vite 输出的端口为准。该入口会跳转至现有 base 下的 `/story-voice-test-audio/brick-test.html`；也支持 `/story-voice-test-audio/brick-test`。独立 Vite 启动方式无需运行音频业务服务器或配置任何模型 API key。

现有 `npm run dev` 也会加载同一个 Vite 插件和页面。可选构建与预览（尚未执行）：

```bash
npm run build
npm run preview
```

预览默认端口为 4173，同样访问 `/brick-test`。普通静态文件服务器不包含 LDraw 中间件；单独部署 `dist` 时必须另行托管零件库并配置模型 URL 和路由。

## 本地零件库

默认读取 `/home/umi/Documents/pg/gaming/lego-brick/complete/ldraw/`。不复制库、不写入库、不需要软链接。

可在启动环境中覆盖：

```bash
LDRAW_LIBRARY_PATH=/your/complete/ldraw npm run dev:brick
```

`server/brick-library.mjs` 为 dev 和 preview 注册同源的 `/story-voice-test-audio/brick-ldraw/` 只读接口。限定 `.dat` / `.ldr` 文件，拒绝路径穿越和库外软链接。保留目录层级，支持大小写匹配和官方 loader 对 `parts/`、`p/`、`models/` 的探测，包括 `parts/s/`、`p/48/` 等引用。没有命中的文件返回明确 HTTP 错误，不交给 SPA HTML fallback。

## 集成与坐标

- 固定 `three@0.180.0` 和 `@types/three@0.180.0`。官方 addon：`LDrawLoader`、`LDrawConditionalLineMaterial`、`OrbitControls`，没有第三方 LDraw 封装。
- `setPartsLibraryPath()` 指向本地 HTTP 库；`preloadMaterials()` 读取 `LDConfig.ldr`。通过一个 type-1 LDraw 引用赋予每块砖的标准颜色，几何仍全部来自原始 `.dat` 及其递归引用，不修改原始模型或用程序几何替代。
- `3437.dat`：2×2，X/Z 砖体为 80/80 LDU；`3011.dat`：2×4，160/80；`2300.dat`：2×6，240/80。长边沿 X，三者砖体底部均为 LDraw Y=48，顶部平面 Y=0。
- LDraw Y 向下；整体绕 X 轴旋转 π，保持几何绕序，再以 0.4 缩放：场景 1 单位 = 1 mm。模型向上移 48 LDU，使砖体底部落在 Y=0。
- X/Z 位置以砖体中心为基准，UI 每格为 40 LDU = 16 mm；层高步长为砖体高 48 LDU = 19.2 mm，不使用含凸点的包围盒高度堆叠。
- 相同型号与颜色复用模型模板和几何；离开页面时释放渲染器、控制器、观察器与已跟踪的几何/材质。异步请求的旧结果不会在 Reset 或卸载后重新写入场景。
- 组合更新完成后才更新清单。失败时保留上一个成功的组合，并显示型号、颜色和失败请求；没有替代模型。失败模板不缓存，可修复库后重试。

参考：[官方 LDrawLoader 文档](https://threejs.org/docs/pages/LDrawLoader.html)、[r180 实现](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/loaders/LDrawLoader.js)。

## 手动验收

1. 打开页面，默认加载红色 `3437.dat`；观察凸点、底部空腔和边线。
2. 左键旋转、滚轮缩放、右键平移；点击“适合视图”；缩小浏览器宽度检查布局。
3. 切换三个型号和六种颜色。设置数量、X/Z、底部层高和 90° 旋转，尝试向上堆叠和沿 X 并排。
4. 载入阶梯示例：蓝色 2300 为底层，黄色 3011 和红色 3437 为第二层，绿色 3437 为第三层；合计 4 块、4 个清单分组。
5. 检查同型号同颜色的数量汇总；展开明细，删除单块；Reset 应清空场景及清单。
6. 加载较慢时点击 Reset，等待旧请求完成，场景仍应为空。
7. 在浏览器 Network 阻止 `*brick-ldraw*`，刷新页面：应显示加载错误而非假积木。取消阻止后点击“添加”或“载入阶梯示例”重试。可另用不存在的 `LDRAW_LIBRARY_PATH` 启动检查服务端错误。
8. 检查 Network 中各零件和子文件响应均为 LDraw 文本，而非 HTML。测试三个型号、预览模式和缺失子文件场景。

## 移植与范围

复制 `src/brick-test/` 并安装相同依赖，可在 React 中挂载 `<BrickTestPage libraryUrl="/ldraw/" />`。底层 `BrickViewer` 不依赖 React，接受宿主 DOM、库 URL 和错误回调。部署方应提供与开发插件等价的引用解析路由：当前严格错误检查将任何失败文件请求视为加载失败，因此普通静态服务需要额外处理 loader 的目录探测，不能直接替换为存在正常探测 404 的静态目录。当前 CSS 面向独立页面，嵌入现有产品前需隔离全局基础样式。

已写入：真实模型加载、鼠标视角操作、型号/颜色/数量选择、手动位置/旋转、批量堆叠/并排、Reset、阶梯示例、汇总清单、单块删除及错误状态。未加入自动连接、碰撞检测、AI、数据库、Pipecat或场景持久化。

未验证：依赖安装与 lockfile 更新、TypeScript/build、实际 WebGL 渲染、浏览器交互、HTTP 路由与子引用端到端加载、构建预览、性能和设备兼容性。仅做源文件阅读与静态人工审查，不代表运行通过。
