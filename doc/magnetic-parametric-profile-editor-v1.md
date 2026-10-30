# Parametric Profile Editor V1

入口：Studio 右栏 **Tiles Catalog → 新增 Profile**。选中 Catalog 行后，详情中可 **编辑**（保存新版本）或 **复制为新 Profile**（新 ID @1）。编辑区与其他阶段、Inspector 共存，不会重新挂载 Review、匹配结果或作品草稿。

## 参数化几何

标准正方形边长为 1，局部坐标 Y 向上，顶点按逆时针排列，原点沿用现有 Catalog 的左下／底边左端点约定：

| 形状 | 参数 | 自动生成顶点 |
|---|---|---|
| Square | side=s | (0,0),(s,0),(s,s),(0,s) |
| Rectangle | width=w,height=h | (0,0),(w,0),(w,h),(0,h) |
| Equilateral Triangle | side=s | (0,0),(s,0),(s/2,s√3/2) |
| Isosceles Triangle | base=b,height=h | (0,0),(b,0),(b/2,h) |
| Right Triangle | legA=a,legB=b | (0,0),(a,0),(0,b) |

输入立即更新 SVG、顶点、边长、内角与连接边。所有边默认可连接，可逐边关闭。Estimated 与来源说明随版本保存。即使等腰三角形的比例恰好等边，所选参数形状仍为 Isosceles，不自动改类型。

保存前及服务端均运行 `parametricProfile → profileIssues`，沿用原来的有限坐标范围（绝对值 ≤100）、最小边长、严格凸性与 CCW 标准。尺寸必须为有限正数。Profile ID 使用现有小写字母／数字／连字符规则，`unknown` 保留；ID 最大80、名称100、来源2000字符。

## 单一 Registry 与持久化

- `profiles.json` 是五个不可变初始版本；文件及几何未修改。
- `GET /api/magnetic-intake/profiles` 返回服务端权威 Catalog：初始版本 + 已追加的版本，附全局 revision/hash。
- `POST /api/magnetic-intake/profiles` 接收 `{operation:'create'|'version', expectedRevision, input}`。不接受客户端生成的顶点作为几何权威；服务端从参数重新计算。
- 持久化：`generated/magnetic-intake/profile-registry/000000000001.json` 等只追加的版本记录，每条保存完整 Profile、规范化参数输入、前一 revision hash 及自身 hash。
- 与 Selected 同样用临时文件写完后 `link(temp, revisionFile)` 独占发布。全局 revision CAS 在独立进程之间也有效。冲突返回409，不覆盖、合并或自动重试表单。读取时检查连续序号、hash链、参数生成的几何和版本序列；损坏明确报错。
- 新 ID 从 @1 开始，编辑已有 ID 追加该 ID 的最高版本+1，包含编辑内置 Profile。旧 Profile 内容永久保留，不能删除或覆盖；也不会自动升级任何 Review 或作品引用。
- V1 限制 Catalog 总共1000个版本；文件目录必须随其他 generated 数据备份。无删除／归档接口、数据库或新管理页面。

浏览器先从服务端加载 Registry，再恢复 Assembly / Build 本地存档；加载失败只显示错误及重试，不以静态 Catalog 替代，不覆盖浏览器存档。初始版本及追加版本由同一 Registry 提供，不存在另一套用户 Profile 匹配分支。

Catalog、Review 表格／Profile 下拉框、Shape/Relative Size Matching、Geometry Validator、Reconstruction、Snap、Assembly、Build 都消费该 Registry。证据解析和识别请求的 Catalog/schema 也显式注入同一服务端列表；本轮没有调用识别。添加规格不重启服务。几何算法、容差、RMS、镜像及分段边规则不变。

旧 Reconstruction 的全 Catalog hash 继续匹配不可变 Catalog 前缀；Trace 中冻结的 Profile 及输入保持不变。Build 继续按引用的确切 ID@Version 计算 hash，追加无关规格不使旧教程失效。Build 只在启动时恢复，Catalog 更新不会重置正在查看的教程。

同标签保存立即更新 Registry；其他同源标签通过 storage **失效通知**重新 GET，独立浏览器在聚焦或点击 Catalog 的刷新后读取。localStorage 只用于通知及既有 UI／草稿／作品状态，不保存 Profile 权威数据。编辑表单的 CAS revision 在打开时固定，刷新读取后需主动重新保存。旧异步响应不能使 Registry revision 回退。URL 中 Catalog 的 ID@Version 可恢复动态规格，工作阶段、Source、Selected、历史及草稿机制保持原样。

## 手动验收

1. 打开任何阶段，右栏切 **Tiles Catalog → 新增 Profile**。
2. 名称填“细等腰三角形”，ID 填 `narrow-isosceles-triangle`，形状选 Isosceles，底边1、高度1.4；观察顶点、角度与 SVG 实时变化。
3. 需要时勾 Estimated 并填来源；保留默认连接边，点 **保存 Profile**，新行显示 @1。
4. 刷新或复制 URL 到新标签，仍能选中该规格。Review 的 Profile 选择、全部匹配候选和 Assembly 的添加面板均能使用。
5. 编辑高度为1.8，点 **保存新版本**得到 @2；切回 @1 顶点仍为 (0,0),(1,0),(.5,1.4)，原作品不变。
6. 复制为不同 ID，新规格从 @1 开始。重复 ID 和非法尺寸会被拒绝。
7. 两个独立浏览器同时编辑，在其中一处先保存；另一处保存应报409且保留参数。点“读取最新 Catalog”，核对版本后再保存。

编辑器未保存的表单在 Tab／Workflow 切换中保留；整页刷新不恢复该表单（不会写入正式 Registry）。既有 Review／Assembly 草稿保护不变。

## 验证与修改文件

新增：
- `src/magnetic-tiles/parametric-profile.ts`：五种模板、参数验证、角度及旧规格编辑预填。
- `src/magnetic-tiles/ProfileEditor.tsx`：紧凑编辑、实时预览与 CAS 反馈。
- `src/magnetic-tiles/ProfileRegistry.tsx`：启动加载、运行时统一 Catalog、跨标签刷新及响应顺序保护。
- `server/magnetic-profile-registry.mjs`：持久化及跨进程 CAS。
- `test/magnetic-profile-editor.test.mjs`：模板、非法输入、跨进程 CAS、真实动态 Matching/Reconstruction/Snap/Assembly/Build、旧几何及 Trace 兼容。
- `scripts/magnetic-sandbox.mjs`：生产 bundle + 真实 API + 临时历史副本。
- `scripts/verify-magnetic-profile-editor.mjs`：五种形状 UI、版本、复制、重复 ID、双上下文冲突、刷新／新标签、Assembly／Build／Matching 和窄栏验收。

调整：`SupportedTiles.tsx`、`StudioLayout.tsx`、`studio-panel-state.ts`、`main.tsx`、`BuildPanel.tsx`、`geometry.ts`（仅可选参数／来源元数据类型）、`style.css`、`intake/{ImageIntake,ReviewWorkspace,ProfileMatcher}.tsx`、`intake/contracts.ts`、`intake/reconstruct.ts`（仅给解析器传 Catalog）、`server/magnetic-intake.mjs`、`server/magnetic-intake-vision.mjs`（仅动态 Catalog 注入）、`package.json`，以及本说明。

自动命令：

```
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run build
npm run test:magnetic-profile-editor:browser
```

临时 Catalog 验收会复制现有历史到 `/tmp/magnetic-browser-*`，测试结束删除，正式 Catalog / Snapshot / Selected 不写入测试数据。付费模型调用0。

本轮结果：104 项 Magnetic 单元／集成测试通过；TypeScript 与生产构建通过（保留项目已有大 chunk 提示）。新增编辑器浏览器验收通过；既有 Catalog、Tiles/Snap、Build、Selected、Review Toolbar、Workflow UI、Candidate Conflicts、Trace 共8组浏览器回归通过。编辑器截图：`/tmp/magnetic-profile-editor/{editor,narrow}.png`。正式 Registry 最终仍为 revision 0 / 五个初始 Profile，未写入临时测试规格。
