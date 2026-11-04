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

## 历史记录范围

Create 的 Saved Assembly 列表同样只记录本工作区保存操作返回的确定版本收据；可重新打开这些版本、沿用原 Combined 创建界面组合本工作区同一 Project 的保存快照。不会把其他作品导入该列表。

Create 使用本工作区操作实际返回的记录 ID/Hash 与请求 ID，查询只读 `visible3d/workspace-history`。相同照片、名字或 Project 不构成归属证据。服务器 Selected 指针中的未归属条目不会成为本地自动选择；真实 revision 仍用于 CAS。刷新后本工作区的来源选择及已产生记录可恢复。

Edit 仅展示保存 Sidecar 中的确切 Origin 和 Combined Parent 引用，作为只读追溯。不挂载 Reconstruction 控制器，不展示全局历史选择器，也不把历史 Spatial Plan 用作当前几何修复输入。当前 Assembly 的显式连接求解和 Validator 保持原样。Tutorial 使用 `assembly3d/snapshot-check` 核对确定版本/Origin、Canonical Profile、Group Parent 与实际教程数据，不要求历史 Selected 仍指向原作品。

旧 Selected Head 缺少 selectedRevision 时只在读取结果补 0；缺失 Analysis 指针保持 null，不猜测最新记录，也不写回历史文件。

无法可靠归属的旧 Analysis、Review、Plan、Execution、Saved Assembly、其他来源集合暂不放入这些工作区选择器。没有删除、搬迁、改写或批量迁移旧记录。

## 空白 Editor 作品

原版本仓库要求不可变 Origin。`assembly3d/save-editor` 为当前 Create 的固定 Assembly ID 建立 `editor-created` Origin：基线为空 Assembly，Source/Project 摘要由明确的工作区 UUID 生成。它不伪造 Analysis、照片或 Execution。第一次保存后仍走原 snapshot/version/hash/CAS 机制；原点不能重绑。Assembly3D、Pose、Profile、Port、Connection、Geometry Validator 均未改结构或标准。

本轮没有创建完整 Creation ID / Lineage Graph。未来跨浏览器恢复新建上下文、导入其他作品、合并多个来源或系统性浏览旧历史时，可增加持久 Creation ID；当前固定快照编辑与按操作收据隔离不需要先建设该系统。

## 验证与 UI 验收

- `npm run test:magnetic-workspace`：URL/存储隔离、精确历史收据、发布基线与 save-head 分离、Combined、Editor 新建、原文件不变、旧 head 只读兼容。
- `npm run test:magnetic-workspace:browser`：空白 Create、再次新建、手动添加/保存、A/B/Combined 精确恢复、离线完整来源链、仅本工作区 Parent 组合、未保存刷新恢复、取消离开、Draft 隔离、CAS 冲突、保存后 Gallery 不变、Tutorial、View 无写入。
- Magnetic Node 全套、3D Vitest、Gallery/Editor/模式浏览器回归、LEGO Gallery 测试及构建。

手动验收：从 Gallery 新建，看空 Viewer；在 Inspector → Edit Tools → 从 Tiles Catalog 添加零件并保存，再 Add to Gallery。分别 Edit 两个作品，修改后切换、刷新，检查各自草稿。保存 Edit 的新版本后回到原 Gallery View，确认仍显示发布版本。Combined 的 Group 操作与 Parent 追溯保持可用。要恢复未加入 Gallery 的 Create 草稿，可保留该页或其带 workspaceId 的 URL。

所有自动化服务写入位于临时目录；不调用真实 AI API，不修改个人作品。封面、搜索、Import from Other Creation、自动更新发布、完整 Lineage 与历史迁移均未实现。
