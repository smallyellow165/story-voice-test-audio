# Magnetic Gallery Create / Edit V1

## 入口与版本

Gallery 的「家长制作入口 / Create New」打开 `magnetic-tiles.html?workspace=create`。初始化立即生成 `workspaceId` 并写入 URL；每次点击新建获得不同 ID，刷新原 URL 则恢复同一工作区。开始时只建立空 Assembly3D，不读取全局 2D/3D Draft、来源选择或 Project 历史。

卡片与只读预览页均提供 Edit。链接包含 `workspace=edit`、`galleryId`、`assemblyId`、`version`、`hash`。`gallery/edit-context/:id` 核实 Gallery 固定绑定，返回该版本完整 snapshot 及独立的 save-head CAS 引用。初始化不请求最新版本几何，不重新组合 Parent，也不依赖 Reconstruction 文件。

首次 Edit 恢复发布版本。重新进入同一作品时，恢复本工作区已保存版本及未保存工作草稿；页面明确显示 Gallery 发布基线与草稿恢复状态。另一个 Gallery Item，即使源于同一 Assembly 的不同发布版本，也拥有不同的工作区。

保存使用原 `assembly3d/save` 追加版本。加载基线与保存 CAS 分开：从发布 v1 编辑时，可能在服务端 v5 后追加 v6；save-head 只在工作区首次初始化、本页成功保存或用户明确处理冲突时更新，刷新不会悄悄接受别人的最新保存。并发改变 head 时保留本页编辑、返回冲突。可明确点击「保留当前草稿，在 vX 后追加保存」：只刷新用于本次追加的 CAS 元数据，保留当前几何，不加载服务端最新几何或替换 Gallery。若本地草稿也被其他页面修改，该操作仍会停止，不覆盖它。Gallery 引用始终不变。

## 工作区隔离与恢复

`workspace-context.ts` 是薄存储适配器，键前缀为 `magnetic-studio.workspace.v1.<mode>.<identity>.`。Create identity 是 UUID；Edit identity 是 Gallery ID 加发布 Hash。原 Draft、Collision Policy、Origin、Saved Ref、Tutorial、候选相机及来源/Review 显示偏好继续使用既有结构，但位于各自命名空间。

已保存 Draft 与未保存的 `working-draft` 分开。恢复必须匹配保存基线、Assembly 身份及不可变 Origin；已保存槽还要与服务端确定版本核对。保存 CAS、恢复草稿 CAS 与服务端版本 Hash 分别保护不同边界。冲突/损坏时停止写入，不清空数据或回退到示例、其他作品或最新版本。未保存 Assembly、Review、Tutorial 离开页面有保护，Review 来源替换也保留取消机会。

显式工作区不挂载隐藏的旧 2D Playground。普通旧 Studio URL 继续保留兼容行为；Gallery 的全部新建/编辑入口均使用显式工作区。View 页不初始化 Studio，也不写其 Draft。

## 稳定 Project 与输入快照

Create URL 中的 `workspaceId` 同时是作品 Project ID。从空白 Studio 开始固定，不因选择图片、删除图片、调整顺序或改变 Step / Final 角色而变化。没有增加第二个 Project UUID 或另一套 Project 管理界面。Gallery 明确 Create New 才生成新的 UUID。

原来的 `Visible 3D Project ee79036f / 42cea00a` 实际是 `Source.id`：服务器对图片 ID/Hash、顺序、角色、方向、备注及主图选择计算的内容 Hash。生成新 Hash 是输入快照的正确行为；把它标为作品 Project，并按它截断 Analysis History，是生命周期混用。新的 UI 分别显示稳定 Project 与 Input Snapshot。

新数据通过 `visible3d/project/{workspaceId}/…` 使用同一套 Analysis/Review/Planning/Execution 服务。不可变记录与请求增加 `projectId`，Trace 的 requestInput 同样记录这个身份。History 按 Project 查询全部输入快照下的记录，不再以浏览器操作收据作为作品归属的唯一来源。每条 Analysis 的 `sourceId/sourceHash`、图片角色、主图、证据和后续精确版本仍是原来的不可变快照；没有取消来源 Hash 过滤来拼接结果。

Selected/CAS 按 `(projectId, sourceId)` 隔离：同一输入可以明确供两个作品使用，但两个作品不能互相选择 Analysis、Review、Plan、Execution、Trace 或恢复请求。Review/Plan/Execution 的父引用与 Hash 校验保留。Origin 记录 Project 归属，同时仍保留精确输入来源；现有 Assembly3D 几何、Editor、Tutorial 和固定 Gallery 快照使用原机制。

浏览器 `magnetic-visible3d-context.v2` 在本工作区分别记住 `inputSourceId`（当前待分析输入）与 `sourceId`（正在查看的结果输入）。选择历史 Analysis 会加载其精确 Source 和结果，明确提示正在查看历史输入；右栏当前待分析图片不会被替换。可直接“查看当前输入”，也可选择另一条历史结果。刷新页面会恢复两个指针；不会自动选择最新 Analysis 或把三图结果套在两图上。Analyze 始终使用右栏当前输入，人工标注要求正在查看当前输入。

新建作品即使尚未选择照片，也显示稳定 Project 与空 History。相同照片、名字、文件夹或 Source Hash 都不能推断作品归属。服务器新 Project History 只读取带该 Project ID 的记录，不合并无归属记录、不扫描来源关系猜归属、不调用旧 workspace-history 收据查询作为 fallback。

已有 v1 浏览器上下文、旧 Source/Analysis/Review/Plan/Execution/Selected 文件保留原状，不迁移、合并、修复或重绑。旧记录不自动出现在新 Project 中；需要从 Gallery Create New 开始新流程。历史 Source 快照仍在原文件位置，不因这次修复被删除。Saved Assembly 列表继续只接受本工作区实际保存的版本收据；Edit 继续只恢复 Gallery 发布的固定快照及其 Sidecar/Parent 引用，不导入 Analysis 历史。

## 空白 Editor 作品

原版本仓库要求不可变 Origin。`assembly3d/save-editor` 为当前 Create 的固定 Assembly ID 建立 `editor-created` Origin：基线为空 Assembly，Source/Project 摘要由明确的工作区 UUID 生成。它不伪造 Analysis、照片或 Execution。第一次保存后仍走原 snapshot/version/hash/CAS 机制；原点不能重绑。Assembly3D、Pose、Profile、Port、Connection、Geometry Validator 均未改结构或标准。

本轮没有创建完整 Lineage Graph。稳定 Project 复用现有 workspaceId；快照关系仍使用现有 Source/Analysis/Review/Plan/Execution 的 ID/Hash。未来导入其他作品或复制作品需要显式新建 Project，不能通过相同输入推断归属。

## 验证与 UI 验收

- `npm run test:magnetic-project`：三图 25 Observations → 两图 → 单图，同一 Project 多次 Analysis，服务器重启及新客户端查询，跨作品/跨输入引用拒绝，精确来源恢复和 Assembly Origin 读取/保存。
- `npm run test:magnetic-project:browser`：从 Gallery 新建、三图识别（离线模型夹具）、删除第三张并修改 Final、同一 History 的两次结果、历史预览保留当前输入、刷新、新 Project 和单图隔离；不调用付费模型。
- `npm run test:magnetic-workspace`：URL/存储隔离、精确历史收据、发布基线与 save-head 分离、Combined、Editor 新建、原文件不变、旧 head 只读兼容。
- `npm run test:magnetic-workspace:browser`：空白 Create、再次新建、手动添加/保存、A/B/Combined 精确恢复、离线完整来源链、仅本工作区 Parent 组合、未保存刷新恢复、取消离开、Draft 隔离、CAS 冲突、保存后 Gallery 不变、Tutorial、View 无写入。
- Magnetic Node 全套、3D Vitest、Gallery/Editor/模式浏览器回归、LEGO Gallery 测试及构建。

手动验收：从 Gallery 新建，看空 Viewer；在 Inspector → Edit Tools → 从 Tiles Catalog 添加零件并保存，再 Add to Gallery。分别 Edit 两个作品，修改后切换、刷新，检查各自草稿。保存 Edit 的新版本后回到原 Gallery View，确认仍显示发布版本。Combined 的 Group 操作与 Parent 追溯保持可用。要恢复未加入 Gallery 的 Create 草稿，可保留该页或其带 workspaceId 的 URL。

所有自动化服务写入位于临时目录；不调用真实 AI API，不修改个人作品。封面、搜索、Import from Other Creation、自动更新发布、完整 Lineage 与历史迁移均未实现。
