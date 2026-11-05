# Magnetic Tiles：未完成作品的发现与恢复

Create 的身份继续使用 URL 中的 `workspaceId` UUID，与服务器 `projectId` 相同。
没有新增 Save Project 操作，也没有新增服务器 Project 管理层。

## 存储契约

- `magnetic-studio.draft-project.v1.<UUID>`：Gallery 所需的名称、阶段、最近修改时间与 UUID。
- `magnetic-studio.workspace.v1.create.<UUID>.workflow-draft.v1`：精确的 Source/Input Source 引用、Selected 快照和原 CAS 版本、未保存 Review 表单、Observation 选择、人工标注 JSON、人工 Spatial Hypothesis JSON、候选与修正方案选择、模型设置。
- Assembly 沿用该 UUID 命名空间中的 `working-draft`、保存基线、来源 sidecar、碰撞标记与 Saved Assembly 固定版本引用。
- 展示筛选、Group/Image 范围、当前图片等沿用原有工作区隔离的 UI 存储。

Gallery 枚举正式索引并验证 UUID 的工作区绑定。Continue Editing 只携带同一个 UUID 和保存阶段，不生成新 Project。名称相同的作品仍显示各自的 UUID 短标识。

发布去重使用该 Create 自己保存的 Assembly 身份收据：如果已有 Gallery Item 引用了其中一个 Assembly ID，这个 Create 不再展示为未完成作品。后续版本仍归属于同一个 Assembly，Gallery 的固定版本不变。本地草稿不删除。

## 恢复与并发

恢复只解析工作区快照中明确引用的记录，检查 Project、Source、ID、Hash 和父子引用。不会选择“最新 Analysis/Review/Plan”，也不会自动重跑 Reconstruction。

同一浏览器工作区由 Web Locks 保证只有一个打开的编辑页面。第二个页面明确报告工作区已在使用，且不挂载编辑器。正常返回 Gallery 使用同页导航；自动保存成功后无需离开确认。

自动保存仍使用预期原始值进行 CAS 比较，Assembly 保留既有 CAS。保存失败、配额错误和数据损坏都有明确错误；原始数据保留。Review 额外提供当前工作草稿导出。

此前轮询可能在保留旧 Review 表单时推进本页的 Selected/CAS 基线。现在外部指针变化只报告冲突，不替换本页引用或表单，也不推进 CAS。服务端 Review 保存校验保持原样。应用自身 Plan/Execution 操作完成后，只接受与实际操作返回 ID/Hash 相符、且未夹带其他 Group 变化的选择收据。

恢复中的历史 Plan 不会进入 Assembly 的 Auto Fix 或求解；Assembly 继续使用自身保存的几何与来源快照。

## 一次性旧数据迁移

首次打开 Gallery 时，只枚举明确的 `workspace.v1.create.<UUID>.binding`。绑定必须与 UUID 完全一致。旧上下文必须提供明确 Source ID，服务器读取必须处于同一个 Project，并能校验其明确 Selected 引用。无 Source 的明确空工作区可以迁移。

迁移仅新增正式索引和 v1 工作流程快照，不改写或删除旧字段、服务器记录或 Saved Assembly。旧字节本身保留为原始备份。完成后写入一次性迁移报告，正式恢复路径只使用 v1 契约。

绑定损坏、来源缺失、记录不属于该 Project、Hash 不匹配、旧页面正在使用等情况跳过并显示原因。没有明确 UUID 绑定的全局旧草稿、其他 Gallery/Edit 数据、仅存在服务器历史的 Project 不会被推测归属。旧版本仅存在内存中的未保存 Review 无法追回。

迁移报告中的数量是当前浏览器实际执行的结果。自动化回归使用隔离数据，验证了安全旧工作区的迁移与损坏绑定的跳过；没有读取或修改用户浏览器的个人 localStorage。

## 实际边界

- 同一浏览器配置、同一源（协议、主机、端口）的 localStorage 支持刷新和重新打开浏览器。
- 不同步到其他浏览器、设备或无痕会话。清理站点数据、浏览器配额清除或配置丢失会失去本地索引和未保存草稿。服务器上的不可变记录仍保留，但不能据此猜测并重建未保存工作区。
- 服务器重启后，只要保留 `generated/magnetic-intake` 数据目录且继续使用同一访问源，记录及草稿仍可恢复。记录目录丢失、固定版本损坏或服务不可用时会报告失败，不回退其他记录。
- 需要支持 Web Locks 的浏览器与可信上下文（localhost 或 HTTPS）。不满足时拒绝编辑并保留数据。
- Analysis 已保存结果和后台请求 ID 可以恢复；未完成的网络请求本身不是浏览器草稿，仍遵循既有任务查询机制，不重复提交模型。
- 自动保存不等于创建新的不可变 Review/Assembly 版本；这些操作保留原有明确保存动作。

## 验证

```sh
npm run test:magnetic-draft-projects
npm run test:magnetic-draft-projects:browser
node --experimental-strip-types scripts/verify-magnetic-workspace.mjs
node --experimental-strip-types scripts/verify-magnetic-module-disabled-reasons.mjs
npm run build
```

主浏览器回归覆盖空 Create、仅 Analysis、未保存与已保存 Review、真实 Group 的 Plan/Execution 与人工 JSON、Assembly、同源多 Project、重复页面、真实浏览器重启、API 重启、Review 409、损坏恢复、发布固定版本以及一次性迁移。所有写入均为临时测试数据，Analysis 使用确定性离线返回，没有真实模型调用。

人工验收：从 Gallery 创建作品，识别后修改 Review，直接返回“我的作品集”，点击 Continue Editing；确认阶段、Profile、确认状态与颜色一致。继续保存 Review 并完成 Reconstruction/Assembly，再离开和重启浏览器验证。用第二个 Project 的相同图片重复操作，确认历史不混入。发布后确认其固定版本出现在 Gallery Items，原 Create 不再重复出现在 Draft Projects。
