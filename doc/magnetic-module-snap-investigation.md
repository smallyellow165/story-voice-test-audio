# Module Snap：指定 Port 的姿态与约束调查

调查输入是 Project `2ccbb9cb…` 的实际保存快照，不是截图推断：

- Combined：`combined-8565b7b2-feea-458c-b267-c4ffbc00c781`，存储 version 3，Assembly revision 4。
- 记录：`generated/magnetic-intake/assembly3d/combined-8565b7b2-feea-458c-b267-c4ffbc00c781/000000000003.json`。
- 记录 hash：`8bf04540eac8de9c3c80a1eb275174f08f34e151a9e7730edb7750e4cb2d4ea6`。
- Front 9 Tiles / 12 Connections；Rear 12 / 10；Combined 21 / 22。
- 输入参考面 `rear-top-left` 的世界法向为 +Y；两组实体 Y Min 均为 −0.53。
- 输入严格 Validator 有 10 个 intersection：Front 内 4 个、Rear 内 6 个；没有连接约束错误；历史人工接受记录现已不参与操作。

正式快照全程只读。测试把原始存档、固定 Parents 及审核记录复制到临时目录，使用同一服务 API 和同一求解器。此结论不覆盖尚未保存且与该快照不同的浏览器 Draft。

## 坐标和求解语义

Canonical Profile 在局部 XY 平面，以面积质心居中；正面法向为局部 +Z，厚度位于 ±thickness/2。Port 的 p0→p1 沿实际 Profile 的边界方向，边内法向为 (−dy, dx, 0)。Port 分段及编号直接来自 Profile 快照。世界坐标使用保存的 Piece Pose，不使用 Viewer 中来源作品的显示偏移。

本例真实世界 Port（近似值）：

| 输入 | p0 | p1 | 单位切线 | Tile 正面法向 |
| --- | --- | --- | --- | --- |
| Fixed `front-floor-left:e2-p0` | (0.5, −0.5, 0) | (0.5, −0.5, −1) | (0, 0, −1) | (0, 1, 0) |
| Moving `ramp-lower-left:e0-p0` | (1.5, −0.5, 0.90701905) | (2.5, −0.5, 0.90701905) | (1, 0, 0) | (0, 0.86602540, 0.5) |

实际调用链：`previewModuleSnap → edgeSnapTransform → computeSnapTransform → computeTransformFromConnection`。

1. 校验两组不同、成员归属、Canonical Ports、实际长度及重复连接。
2. Flip=false 对应 B.p0→A.p0、B.p1→A.p1；Flip=true 交换 B 的两个端点后对应。
3. 对齐切线，再绕 A 切线将 B 的正面法向转到 A 的正面法向，得到共面姿态。
4. 绕 **A 原始 p0→p1** 按右手法则旋转指定 Dihedral。0° 表示正面法向相同，不表示相对当前 Rear 额外旋转 0°。
5. 平移匹配端点。由 Moving Tile 的旧、新 Pose 得到唯一刚体 delta，将同一个 delta 应用于整个 Group，包括 frame。
6. 只追加用户明确指定的一条 Connection，调用现有严格 Validator。

指定有向端点对应后，两点对齐原本剩一个连续铰链自由度；指定有符号 Dihedral 后该自由度消失。正常非退化 Port 没有多个离散候选。q 和 −q、周期等价角都代表同一姿态，不应凑成 Top 10。更换 Flip 或 Dihedral 属于修改用户输入，不是当前参数下的候选。

当前 Moving Pose 用于求刚体 delta，不是一个可以在硬约束外自由保留的目标。Orient 和 Bounds Align 的结果存在于 Piece Pose；原存档没有独立 Orient 目标元数据。

## 实际复现与可行性

以下所有端口端点误差 <3e−16、方向点积为 1、有符号角误差 <1e−13°；没有非碰撞错误。高度差为 Moving Y Min − Fixed Y Min。

| Dihedral / Flip | 参考面法向 | 与 +Y 偏角 | 底部高度差 | 额外整体旋转 | 原有 / 新增跨组碰撞 | 严格 Geometry |
| --- | --- | --- | --- | --- | --- | --- |
| 0° / false | (−0.5, 0.8660254, 0) | 30° | −1.36200617 | 93.84096572° | 10 / 4 | Invalid |
| 0° / true | (+0.5, 0.8660254, 0) | 30° | −1.36200617 | 93.84096572° | 10 / 0 | Invalid |
| **手动改输入** +30° / false | (0, 1, 0) | 0° | 约 0 | 90° | 10 / 8 | Invalid |
| **手动改输入** −30° / true | (0, 1, 0) | 0° | 约 0 | 90° | 10 / 5 | Invalid |

在该保存快照下，实际不是顶面法向变成 −Y，而是整体额外旋转约 94°、顶面偏斜 30°、底部下降约 1.362。Flip 使端点对应相反，落到不同一侧，不能充当“保持朝上”。这符合现有约束，没有找到求解器错误或遗漏姿态。

**0° 的方向冲突可直接证明：** 参考顶板与绿色 Moving Tile 的法向内积固定为 cos30°。刚体旋转保持此内积；0° 又强制绿色 Tile 法向等于 Fixed Tile 的 +Y。因此顶板与 +Y 的夹角必为 30°，任何 Flip 都不能令它精确朝上。精确端点匹配也固定了平移，不能再单独把 Rear 向上移动到共底而保留连接。

若用户明确允许手动改变 Dihedral，−30° / true 可以同时达到朝上和共底，但增加 5 对跨组碰撞，不能视为完整合法装配。+30° / false 也满足方向及共底，但多 8 对跨组碰撞。两者不是 0° 的候选，也未被自动采用。即使避开新碰撞，固定 Front 已有 4 个严格碰撞，加上刚体保持的 Rear 组内碰撞，本次 Snap 也不能把整个输入自动变成 Geometry Valid。

## 最小修改

没有改 Solver、Port/Profile、Connection 规则、Validator、保存格式或 Parent Lineage，没有候选搜索、排序或切换工作台。

新增只读预览说明：

- 显示端点误差、方向点积、角度误差，与整体旋转 / Group 中心位移分开。
- 显示变换前后 Y Min 差值，明确是否共底。
- 只有用户明确在 Orient 执行朝上 / 朝前，才记录该 Group 的本次会话参考 Tile 与世界目标。Snap 另选 Moving Tile 不覆盖它。已朝向目标时重复点击只记录目标，不改变 Pose、Revision 或 Undo。
- 显示参考面实际世界法向和目标偏角。若方向冲突，从 A 的真实 Port 轴解析计算保持方向所需的 Dihedral；只显示数值，由用户手动修改并重新验证，不生成另一套姿态。
- 若 normal 沿 Port 轴的分量与目标不同，绕轴旋转无法达到该目标，明确提示仅调 Dihedral 也无解。
- 碰撞完全来自原有 Validator。按实际 Tile pair 区分已有、消失、新增跨 Group、新增组内及既有跨组诊断变化；不再读取或显示人工接受数。
- 输入审核尚不可用时显示“未读取”，不把未知状态当作 0 个接受项；若 Validator 存在非碰撞错误，明确显示无可确认解及实际错误类型。
- 加载后没有可靠方向目标时明确显示未指定，不依据颜色、名称、当前法向或移动连接片猜测。会话目标不写入存档，也不作为几何历史。

唯一端口姿态仍可能与方向 / 共底目标冲突或 Geometry Invalid。Confirm 继续沿用既有规则：允许明确保存 Invalid Draft，但不自动接受碰撞；非碰撞错误阻断确认，Build 继续严格拦截。

## 验证入口

```sh
npm run test:magnetic-3d
node --experimental-strip-types --test test/magnetic-module-snap-diagnostics.test.mjs test/magnetic-module-transform.test.mjs test/magnetic-spatial-inspection.test.mjs test/magnetic-symmetry-fill.test.mjs
npm run typecheck:magnetic-3d
npm run build
node --experimental-strip-types scripts/verify-magnetic-snap-diagnostics.mjs
node --experimental-strip-types scripts/verify-magnetic-snap-pickers.mjs
node --experimental-strip-types scripts/verify-magnetic-module-transform.mjs
node --experimental-strip-types scripts/verify-magnetic-spatial-inspection.mjs
node --experimental-strip-types scripts/verify-magnetic-3d-inspector.mjs
```

Node 测试包括原快照两种 Flip、精确残差、刚体关系、固定组不动、同约束姿态唯一性、解析角度、无效 Port、确定性、Undo/Redo、CAS、恢复、原始作品与 Lineage 不变及 Build 保留真实 Invalid 诊断。Vitest 另有正常 Geometry Valid 与仅改 Dihedral 也无法满足方向的通用样例。WebGL 脚本使用独立临时服务与真实快照，覆盖预览 / 取消 / 确认 / 刷新、明确方向参考、0° 与手动 −30° 结果及窄屏布局。

本次结果：328 项 Vitest 几何测试、15 项相关 Node 测试、类型检查和生产构建全部通过；5 组隔离 Chrome / SwiftShader WebGL 验收通过（本案例诊断、原 Port Picker、Module Transform、Spatial / Bounds Align、单片 Inspector）。全部正式来源文件比对保持不变，付费模型调用为 0。诊断验收结果与截图位于 `/tmp/magnetic-snap-diagnostics/`。生产构建保留既有大 chunk 提示。
