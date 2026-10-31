# Visible 3D Diagnostic → 待修复 Assembly Draft

本轮采用显式 Override，未将 Solid Collision Error / Blocker 降级，未修改 Geometry Engine、Validator 阈值、Solver、Prompt 或 Auto Snap。

## 进入权限

Reconstruction 的 Candidate Review / Assembly 中，Diagnostic 增加「强制允许进入 Assembly Editor」。仅允许严格复验为 Ideal Geometry Valid、Solid Collision Invalid 的 Diagnostic。来源过期、身份/结构损坏及已审核空间关系矛盾仍阻断。

授权仅保存在组件内存，绑定当前 Source、Review、Plan、Execution 的 ID / Hash 及 Candidate ID；切换记录、候选、工作阶段或模式即重置。它不作为 Editor 或 Build 的授权。服务端仅保存这次交接的授权审计，不保存可继续复用的 Override 权限。

普通 `adopt` 未放宽，仍拒绝所有 Diagnostic。新接口 `POST visible3d/open-diagnostic-draft` 要求 `override: true` 和精确 Execution Hash；服务端独立执行：

1. 原有完整 lineage / 文件 Hash / Model Trace / Review head 校验，并额外核对 Source 身份。
2. 按原 Execution 配置重新执行 V3，匹配 Diagnostic ID 与完整 Candidate Hash。
3. 对其真实 Assembly 再运行原严格 Validator，确认仅实体碰撞层无效。
4. 检查已审核空间关系，拒绝矛盾。
5. 创建独立的照片来源记录，`entryMode: diagnostic-override`、`humanReview.status: pending`，保留原始报告、当前复验报告、碰撞空间证据、来源 ID / Hash 与 Diagnostic Hash。

所有 Pieces、ProfileSnapshot、Pose、Connections、颜色原样保留；与普通 Adopt 一样，为新 Draft 分配独立 Assembly ID。不会重求解或移动零件，不改原 Plan / Execution。复用已有 Draft CAS、替换确认、来源 sidecar 和相机交接。

## Editor 与复验

Editor 原有严格 Validator 已对每次实际几何状态实时检查。现补充明确的 `Revalidate Geometry` 入口：复验连接、Port、Dihedral、闭环、Pose 与实体碰撞，不求解、不修改 Draft。

Override 来源显示「待修复 Draft」和红色 Invalid / 复验过期 Blocker。实时检查即使通过，仍要求一次对当前快照的显式 Revalidate 才能用于 Build。

复验记录复用 `magnetic-tiles.assembly3d-origin.v1` sidecar 的可选 `geometryReview`，包含 Assembly ID、Revision、SHA-256、精确序列化快照及原 Validator 报告；没有新增存储 key、历史系统或 Assembly3D 字段。最新快照必须逐字节匹配记录，且动作边界再次严格验证。修改 Pose、连接、Profile、颜色或 Revision 后，旧记录均不能用于新状态。失败只保存复验结果，不修正或删除 Draft。

`revalidatePhotoDraft` 同时检查既有 Draft CAS 和 sidecar 是否被其他页面修改，避免异步复验覆盖较新的来源记录。失败／过期状态可以保存为 Draft、刷新、继续编辑；原始六片 Invalid 报告留在来源中，即便后来将 Draft 修复为合法局部结构也不会被改写。

## 正常保存与 Build 边界

系统现有 3D Assembly 保存入口是「保存 3D Draft」，不存在正式发布／正式合法 Assembly 保存接口。本轮没有新增发布系统，也没有把该按钮改成合法性认证；导出仍是同一 Assembly3D 格式，几何状态必须重新检查。

`assertPhotoDraftReady` 是实际数据操作的门禁：重跑严格 Validator，并对 Override 来源检查当前完整快照的显式复验记录。Build 的准备、手工创建、生成前、Worker 结果接收、采用生成结果和正常教程保存均调用此门禁，不能仅通过启用按钮绕过。原 Build Order 数据层也继续独立拒绝 Invalid Assembly。

历史教程／原有未完成 Tutorial Draft 的导入、查看能力保留；它们不会将 Invalid / 过期的当前 Assembly 认证为合法来源。2D 不使用这条新门禁。

## 验证

- `npm run test:magnetic-3d`：195 项通过。
- `node --experimental-strip-types --test test/magnetic-*.test.mjs`：167 项通过；其中 Visible 3D 37 项。
- `npm run typecheck:magnetic-3d`、`npm run build` 通过。
- 新 `npm run test:magnetic-visible3d:override:browser`：隔离副本读取橙色正式 Review / Plan，验证默认红色阻断、授权及切换重置、六片/全部 Pose/Profile/连接/相机交接、Invalid 保存刷新、真实编辑、复验失败、Undo、显式删除三片形成合法局部结构后仍需复验、复验与 Hash 绑定、刷新恢复、三步教程生成、再次修改后门禁失效，以及宽／窄窗口。
- 原 Geometry Execution 浏览器测试：普通 Adopt 仍拒绝 Diagnostic，合法局部采用与相机交接通过。
- 原 Reconstruction 布局／紫色候选、3D Editor、Build Order/Tutorial 与 2D Review 浏览器回归通过。

测试没有调用真实模型，没有改正式 Review / Plan / Execution。新数据仅写临时测试 API 和隔离浏览器存储。浏览器记录：`/tmp/magnetic-visible3d-override/result.json`。

## 手动验收

1. 3D → 橙色图片 → Review `66ec23c3-b08c-41f9-aa90-a4f2ab9450f6` → Plan `edb975b9-c57c-4dd6-8ee1-03a379303c1a`。选择已有 V3 Execution 的完整 `diagnostic-1`，无需模型调用；如无 V3 结果，仅运行确定性 Geometry Execution。
2. 确认 6/6、Ideal Valid、Solid Invalid，按钮默认禁用；勾选「强制允许进入 Assembly Editor」，Invalid 和红色错误不变。
3. 可先切换 Candidate／History，检查勾选重置；再勾选并点击「采用当前结构进入 3D Assembly Editor」，确认 Draft 替换。
4. Editor 显示六片待修复 Draft；检查位置、四元数、连接与相机，点击 Revalidate。原完整实体仍失败，但可保存 Draft、刷新继续编辑。
5. 使用现有移动／旋转、连接编辑、删除、Undo / Redo 等操作修复。无需进行任何自动厚度补偿。若只是验证门禁，可明确删除正面三片形成顶部与侧面三片局部结构；这改变作品，只用于测试，并非完整六片修复方案。
6. 几何预检查通过后，未 Revalidate 时 Build 仍阻断。Revalidate 通过后保存 Draft、刷新并进入 Build；再次修改后检查旧复验立即过期。

本轮不证明完整橙色实体可搭建，不自动将其修复为 Solid Valid。未来接点／实体对齐规则仍属于独立的 Editor 工作。
