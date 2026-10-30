# Assembly Click Snap V1

入口：作品编辑中栏工具栏，撤销／新建旁的“拖动吸附／单击吸附”下拉框。默认拖动；切换后只改变本次打开的 Assembly 编辑交互。跨阶段／Catalog 切换保留当前选择，整页刷新恢复默认拖动。模式不写入作品 Schema、URL、localStorage 或任何 Snapshot。

## 共用原有 Snap

`geometry.ts` 只将既有候选计算及 shortlist 排序提取成 `findSnapCandidates` 和 `rankSnapCandidates`。原 `findSnap` 继续使用它们，并保留原来的 pointer hysteresis；角度、距离、偏移、覆盖率、连接数量／长度、碰撞及区间占用逻辑未修改。没有新的对齐或最优化算法。

单击使用目标的当前 Pose、实际 Registry 的完整 ID@Version、其他当前零件以及与拖动一致的捕获距离 `22 / pixelsPerUnit`。既有 Snap 继续将它限制为短边长度的30%，角度范围保持原先约45°。没有模拟鼠标拖动，也不按 Source 图片或视觉对称调整几何。

## 安全及歧义

`clickSnap` 是单次、纯函数决策：

1. 当前作品有几何冲突时拒绝；分离草稿继续沿用现有编辑机制。
2. 目标已参与任意合法连接时直接保持原位，包括端部、部分边和闭环中的零件，不枚举微调方案。
3. 按既有 Snap shortlist 和排序选择最佳候选。若还有相同完整覆盖数、相同连接数、相同总接触长度（既有 EPS 内），且 Snap score 差≤0.10 的不同几何位置，则视为歧义并保留原位。0.10仅为点击交互的置信差，不是几何容差或新 Snap 评分。多个边对产生同一实际轮廓／启用边位置时不算歧义。
4. 已在同一合理位置（既有 EPS 内）时不提交变化。
5. 只替换选中零件，完整 Validator 再次检查所有实例；必须有目标的新正长度连接、组件数量减少、原有所有连接保留；原本整体连通的作品必须仍连通。任何面积重叠、重复区间、同侧接触等仍被原 Validator 拒绝。
6. 成功后经现有 `commit` 再验证，递增作品 revision、保留 Undo、更新既有浏览器草稿。无候选／歧义／无需调整不会产生 revision 或 Undo 项。

几何合法的分离草稿可以逐步吸附；若仍有多个组件，仍显示“草稿·尚未连通”，不宣称是正式 Connected 作品，也不绕过 Build 的准入条件。

点击模式不启动 drag state 或 pointer capture。指针明显移动（沿用3 CSS px活动判定）时，不将其作为单击吸附；原生单击、触屏 tap、Enter／空格可触发。模式在拖动期间禁用切换。其他明确编辑操作如旋转、删除、键盘移动维持原行为。

## 小猫及人工验收

测试夹具来自真实已保存 Reconstruction `84c1d431-7a18-4ecf-8e62-553e2cecc10e / candidate-1`，保留来源 hash、9块 Pose 和该次 Profile Catalog。不是重新识别或重新重建。

1. 打开现有小猫作品，确认状态为9块、8条连接、1个组件。
2. 切换单击吸附，逐一点击零件：只选中并提示“已有合法连接，保持原位”，坐标、revision、保存快照及连接数量不变。
3. 切回拖动，原拖动预览和吸附保持可用。已有连接的调整仍需使用明确的拖动操作。
4. 需验证成功吸附时，先导出／保存当前作品，在独立测试作品中放置两块接近但尚未接触的方片，切单击吸附并点未连接方片；检查成功提示，再点撤销恢复原 Pose。
5. 对远离零件／存在两个同样合适的邻居的情况，检查保留原位及简短提示。保存、刷新后作品照常恢复，模式回到默认拖动。

本轮不提供 Snap All、组件移动、清理、对称或美化功能。已经连接的单片即使可能连到第三块也不会由单击入口移动，这是 V1 的保守边界。

## 修改与验证

- `src/magnetic-tiles/geometry.ts`：提取共享候选与排序；保留 drag `findSnap` 原行为。
- `src/magnetic-tiles/click-snap.ts`：单击安全／歧义决策，保留输入不可变。
- `src/magnetic-tiles/main.tsx`：模式切换、原生单击／键盘入口、手势区分、原有提交／撤销反馈。
- `src/magnetic-tiles/style.css`：紧凑开关及点击光标。
- `test/magnetic-click-snap.test.mjs`：新增7项测试，覆盖共用候选、确定／歧义、等价闭合候选、部分边、镜像、既有连接保护、非法场景、小猫逐块不变及 Assembly／Build。
- `test/fixtures/magnetic-intake/cat-assembly-click-snap.json`：真实小猫候选的只读测试摘录。
- `scripts/verify-magnetic-click-snap.mjs`：在独立 Chrome 上下文、真实 API 的临时目录副本中导入隔离作品，通过正常 UI 验收。
- `package.json`：新增单元／浏览器命令；本说明。

```
npm run test:magnetic-click-snap
npm run test:magnetic-click-snap:browser
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run build
```

118项 Magnetic 单元／集成测试通过；TypeScript和生产构建通过（项目原有大chunk提示保留）。新浏览器验收通过原生鼠标、键盘、触屏、单击模式不拖动、无候选／歧义／已连接不变、一次成功对应一次Undo、保存／刷新／Build和1024／430窄屏。小猫9块逐一点击前后完整Assembly JSON一致，仍为8条连接／1个组件。新验收的服务端写操作0，付费调用0。截图及摘要位于 `/tmp/magnetic-click-snap/`。
