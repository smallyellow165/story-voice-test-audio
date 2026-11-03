# Magnetic Tiles：直接操作与真实几何诊断

## 调查结论

原 Human Accepted 有两种入口：逐项接受碰撞，以及 Reconstruction 的 Diagnostic 一次性接受。Human Approved 会把当前 Assembly 的 Revision/完整内容 Hash、Validator 诊断 Hash 与接受项写成服务端 grant；修改、Undo、取消接受还要同步或撤销授权。Combined 会尝试继承 Parent 的接受证据。

这些记录没有外部权限、业务角色、物理验证或独立执行能力。实际作用是给已知几何错误发放例外凭据：允许 Diagnostic 进入 Editor、Invalid Tutorial 生成/保存，以及 Gallery 发布。Assembly Draft 本来就允许 Invalid 保存，Viewer 本来也能渲染 Invalid。使用者主动打开、保存、发布即可表达操作意图，不需要再建立权限系统。

## 当前行为

- 2D/3D Candidate 进入 Editor 无需“已对照原图”Checkbox。
- Diagnostic 可直接打开为 `diagnostic-draft`；来源、Execution Hash 和实际重放快照仍核对，不会伪装成合法 Candidate。
- Assembly 可保存、恢复和发布 Invalid 版本。Gallery 继续只引用确定的 ID/Version/Hash，不跟随最新版本。
- 碰撞表保留 Pair、Depth、体积高亮、聚焦、修复目标和不可修复偏好；删除“接受碰撞”、审核进度与批准操作。
- Revalidate 直接运行原 Validator，不签发或检查复验凭据。
- Tutorial 统一使用既有本地 Worker，不再有授权专用的服务器生成/保存分支。已存在的实体碰撞保留为 Error，允许生成/播放/保存预览，`finalGeometryValid` 和每步 `geometryValid` 继续如实为 false。
- 自动排序仍拒绝不一致的连接约束、非法 Port、超预算与无法满足连通步骤的输入：改变顺序不能修复错误接合。可继续手工编排、保存未完成草稿。
- 完整教程保存仍检查来源精确匹配、零件无重复/遗漏、非空步骤与累计连通；不把人工授权或几何通过当作保存条件。

## 删除与保留

删除 `assembly3d-review/*` API、会话 token、approve/accept/revalidate/restore-saved、grant、接受错误等价性计算、Combined 授权继承、前端授权缓存和同步。新 Assembly 保存不再写 `reviewRef`，新 Tutorial 不再写 `humanCollisionApproval`。

保留原 Geometry Validator、Collision Detection、Profile/Port/Connection/Pose 结构、规范几何匹配、来源/Hash 校验、版本文件不可覆盖、CAS、Undo/Redo，以及有实际输入作用的零件确认和空间关系编辑。修复目标/不可修复标记用于优化策略，不是操作权限。未保存修改被替换时的保护仍在接收端 Editor，去掉了上游重复确认。

## 旧数据兼容

不迁移、不修改既有不可变版本文件，也不删除用户历史。旧 Saved Assembly 中的 `reviewRef`、旧 Origin 中的接受记录可随原快照读取，但不再被当作权限。旧 Tutorial 的批准引用在解析时忽略、新保存时省略。重放旧 Execution 时只忽略无业务效果的 `humanReview` 标签；几何、来源与记录 Hash 仍验证。

## 验证

- `node --experimental-strip-types --test test/magnetic*.test.mjs`
- `npm run test:magnetic-3d`
- `npm run test:magnetic-assembly-actions:browser`
- `npm run test:magnetic-gallery:browser`
- `npm run build`

所有服务端写入测试使用临时目录；不调用真实 AI API，不改写个人作品。
