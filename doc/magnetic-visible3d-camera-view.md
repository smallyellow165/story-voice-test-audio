# Visible 3D — History 名称与保存 Camera View

本轮只改显示名称和独立视角元数据。Spatial Planning、Solver、Validator、Candidate 生成和 Geometry/Assembly3D Schema 均未修改，模型调用为 0。

## 显示名称

左栏两项改为 `Spatial Planning History` 与 `Geometry Execution History`，包括可访问名称。原 `plans` / `executions` 类型、历史值、ID、服务路由、存储目录和历史加载方式保持原样。

## 保存与关联

Candidate Viewer 新增“保存当前视角”。捕获现有 Three.js / OrbitControls 的完整正交相机状态：position、quaternion、up、target、zoom，以及 left/right/top/bottom/near/far。

视角单独保存到当前浏览器、当前站点的 localStorage：

- Key 前缀：`magnetic-tiles.candidate-camera.v1:`。
- Key 后缀：`JSON.stringify([executionId, candidateId])`，例如 `["某个 Execution UUID","candidate-1"]`。
- 内容：schemaVersion、executionId、candidateId、executionHash、camera 和 savedAt。
- executionHash 校验可防止旧视角误用于同 ID 但内容不同的记录。
- 每个 Execution/Candidate 一条元数据；明确重新保存覆盖该条，没有另建历史版本。

旋转、缩放、平移、Fit、Reset、面朝上等操作只更新内存中的当前相机状态。没有点击保存就不写视角。切换候选、重新选择历史或刷新会重新读取对应保存视角；没有保存时采用原默认相机行为。现有 UI 恢复索引增加可选 candidateId，以便刷新后仍选择此前的第二个等非首项 Candidate；旧索引继续兼容。

## 进入 Assembly

沿用原复选框、采用确认、服务端采用复核和 Draft 保存流程。采用动作读取该 Candidate **已保存的** Camera View，经现有 Studio Context 传给 `ThreeDWorkspace`。

- Camera View 存入已有的 `magnetic-tiles.assembly3d-origin.v1` 来源 sidecar 的可选 `cameraView` 字段。
- 该 sidecar 保留采用时的 assemblyRaw 和原 Origin；Assembly3D/Draft JSON 本体不增加相机字段，原 Origin 记录与 Hash 不改变。
- Assembly 的 View、Edit 初次加载及刷新/重新加载 Draft 时使用该初始视角。
- 采用前若又手动旋转但没有保存，传递的是最后明确保存的视角；不会把临时观察状态当成已保存结果。
- 损坏的视角元数据提示或回退默认相机，不把它当几何数据，也不运行 Solver 修复。

两个画布尺寸可能不同。恢复时保持相机位置、朝向、target、zoom、垂直投影范围及裁剪参数，水平范围随目标画布比例调整，保留相同的垂直可见范围和构图尺度。没有按作品几何重新 Fit；用户之后仍可明确使用 Fit / Reset。

视角仅在本浏览器同站点恢复；未引入跨设备同步。独立的 Assembly3D 几何导出不含 Camera View。

## 实现位置

- `three-d/camera-view.ts`：完整状态捕获、验证、恢复及画布比例适配。
- `three-d/reconstruction/camera-view-storage.ts`：按 Execution/Candidate 关联的单条本地视角。
- `CandidateCameraViewer.tsx`：复用 MagnetScene3D，明确保存和按候选加载。
- `MagnetScene3D.tsx` / `EditorCanvas.tsx`：可选初始视角，默认不传时沿用原逻辑。
- `Visible3DWorkflow.tsx` / `StudioLayout.tsx` / `ThreeDWorkspace.tsx` / `adopt-draft.ts`：采用时传递与 sidecar 恢复。

## 测试结果

- `npm run test:magnetic-3d`：180/180 通过，包含 7 个新增相机测试。覆盖完整状态、非 Y-up、投影比例变化、近极点视角、隔离/覆盖、无隐式保存、无效数据及旧来源兼容。
- `node --experimental-strip-types --test test/magnetic-visible3d*.test.mjs`：26/26 通过。
- `npm run typecheck:magnetic-3d` 与 `npm run build`：通过；已有 Three.js chunk 体积提示仍在。
- 实际 Chrome / WebGL 相机验收通过：保存/重存、Candidate 和 Execution 隔离、第二个 Candidate 刷新恢复、未保存操作不持久化、历史重选、采用后 Edit/View 及刷新恢复。断言原 Execution/Candidate 与保存几何不变。
- 原 Viewer 和 Editor 浏览器回归通过，包含默认相机、操作、旧 Draft、2D 隔离及移动布局。相机验收脚本还继续执行原两片/三片几何、采用、保存与 Build Order 流程。

```bash
node --experimental-strip-types scripts/verify-magnetic-visible3d.mjs --camera
```

测试全部使用临时服务/数据和独立浏览器上下文；没有修改正式数据。验收产物在 `/tmp/magnetic-camera-view-browser/`，包括 result.json 和 assembly-saved-camera.png。

## UI 手动验收

1. Reconstruction 左栏确认两个新名称，选择既有 Geometry Execution 与 Candidate。
2. 选一片，点击“以所选面为上方观察”，再手动旋转、平移、缩放，点击“保存当前视角”。
3. 切到另一 Candidate，再切回，检查保存的角度、位置和缩放；刷新页面，检查当前 Candidate 和视角都恢复。
4. 为第二个 Candidate 保存不同视角，反复切换；再选择另一条 Geometry Execution，确认不会串用。
5. 调整后再次保存，确认恢复的是新视角；调整后不保存再切走，确认恢复的是上次明确保存的视角。
6. 按原流程勾选照片审核并采用。检查进入 Edit、切换 View、刷新和重新加载 Draft 后视角；相机状态详情可用于核对数值。
7. 未保存视角的 Candidate/旧 Assembly 仍使用原默认相机。检查 Geometry/Pose、选中高亮和原 Draft 行为未改变。
