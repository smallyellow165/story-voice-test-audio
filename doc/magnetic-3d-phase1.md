# Magnetic Tiles Studio — 3D Integration Phase 1

阶段一已集成独立的 3D Geometry Engine、版本化 Profile Adapter、位姿/序列化契约和自动化检查。源码来自用户提供的本地 `3D_Magnetic_Pieces-main`，保留上游算法和四个核心模块。没有修改现有二维 Reconstruction、Validator、Assembly Editor、Build 工作流，也未接入任何 3D UI。

**入口与复用范围**

公共边界：`src/magnetic-tiles/three-d/index.ts`。

- `vendor/engine/types.ts`：ShapeDef、Port、PieceRef、Connection、Transform、ValidationResult。
- `vendor/engine/shapes.ts`：形状与原有端口构建；新增范围输入沿用原来的插值逻辑。
- `vendor/engine/solver.ts`：端口对齐、四元数二面角、BFS、闭环残差。
- `vendor/engine/validator.ts`：凸棱柱 SAT、端口长度/占用、连接残差、地面、步骤与上游语义规则。
- `vendor/engine/outline.ts`：本地曲边修补，共用采样轮廓。

没有搬上游的 Editor、Viewer、Tutorial、Gallery、model catalog、scheme 持久化或部署配置。上游引用、版权、原始 SHA-256、修补说明和可比较 patch 在 `third_party/3D_Magnetic_Pieces/`。

**修复内容与算法边界**

反向连接遍历：A→B 沿原算法，B→A 对 `flip=false` 反转角度，`flip=true` 时端口原方向同时反转，角度保持。18 组 flip/角度组合（含 ±180、±90、±30）验证任意旋转根下的正反一致性。

二面角残差：用 A 原始端口方向为轴，计算法向之间的 signed atan2 和 wrap 后角差。实际 -90 与要求 +90 的残差为 180 度；±180 等价。数值超出 [-180,180]、NaN/Infinity 在求解前拒绝。

半圆碰撞：弧线采样后构造原有凸棱柱，避免读取不存在的第三个顶点；同一轮廓用于碰撞和地面等检查。同步纠正扇形弧线所属边及弓形面积的重复计算。曲边每段最大 pi/32（5.625 度），半径 r 的圆弧弦误差上界约 `r*(1-cos(pi/64))`；不是解析曲面碰撞。

显式位姿校验：传入 snapshot 后不重新求解或贴地；检查所有约束，包括生成树边，并检测不同组件之间的碰撞。薄片穿透阈值不再恒用 0.03：取 `min(0.03, thinnerThickness*0.1)`，非平行面仍保留上游接缝容忍；平行面再用原 SAT 投影辅助函数检查面内重叠，防止把整片厚度的穿透误当接缝。

这些是对原实现的局部修补；没有新写另一套 solver/SAT，也没有物理引擎。闭环仍是生成树正向求解后**报告误差，不自动修正**。未修复的上游稳定性近似规则在公共阶段一调用中关闭。

**Profile Adapter**

`adaptProfile({ profile, thickness, scale?, ports? })` 只读转换真实顶点，完全不依赖 shape/name 字符串匹配。先复用二维 `profileIssues` 验证凸、逆时针几何及版本，再：

1. ShapeDef.id 为 `profile.id@version`，不同版本分别保留，重复同一身份拒绝。
2. 用多边形面积质心作为局部原点；`origin` 返回该质心在原 Profile 中的坐标。Shape 的局部面仍为 XY，法向 +Z。
3. 点的转换是 `local = (profilePoint - origin) * scale`，默认 scale=1。边编号 e0/e1… 不变，面积与厚度同步缩放；thickness 必须明确提供，单位与 Profile 相同，不能默认声称真实厚度。
4. 只为 connectableEdges 生成端口。默认每条可连边一整段 eN-p0；可显式指定分段，例如 `{ edgeId:'e0', ranges:[[0,.25],[.5,1]] }`，精确保留原始 t 区间和间隔，不强制等分。
5. 端口按每条边输入的有序、互不重叠区间编号 p0/p1…；重复边、越界、重叠、零长度和禁连边被拒绝。空 ranges 可显式关闭该边的端口。
6. `createShapeCatalog` 是每次调用/文档的独立 catalog，不修改上游全局 shapeLibrary，也不改 Registry。渲染层以后必须以文档/catalog 隔离缓存，不能在不同 thickness/scale 的文档间只用裸 shape ID 共享 geometry cache。

所有世界坐标采用与现有 Profile 一致的相对单位，建议标准片边长=1；scale 是明确的几何换算参数，不会自动重新标定上游绝对数值容差。细小尺度或极端尺寸需单独验证，不承诺数值尺度不变性。二维 mirrored 是几何反射，Connection.flip 是端口端点反转，两者不能互换；本阶段未自动转换二维 Assembly 或镜像 pose。

**3D Assembly 位姿与存档**

独立 `Assembly3D`，不复用二维 schemaVersion=1/2 的含义：

```ts
{
  kind: 'magnetic-assembly-3d', schemaVersion: 1,
  id: string, revision: number,
  profiles: [{ profile: Profile, thickness: number, scale?: number, ports?: PortLayout[] }],
  pieces: [{ id, profileId, profileVersion, pose: { position: [x,y,z], quaternion: [qx,qy,qz,qw] } }],
  connections: [{ pieceA, portA, pieceB, portB, dihedralDeg, flip? }]
}
```

世界坐标右手系，保留上游 Y 为地面高度的约定；片的局部平面 XY、局部厚度方向 Z；三维 pose.position 是**面积质心的世界位置**。quaternion 顺序 `[x,y,z,w]`，必须为单位四元数。无缩放/剪切位姿；几何尺寸由 ProfileSnapshot 决定。

所有片的 pose 都是当前编辑/恢复快照的权威事实，包括根、自由片和每个独立组件，不是可丢弃的显示缓存。connections 是待满足的几何约束；不一致时保留文档并报告残差，不能悄悄覆盖 pose。

- `serializeAssembly3D`：检查结构、有限数、单位四元数、版本、端口引用，JSON 保存所有 pose 与完整 ProfileSnapshot。允许保存几何约束未满足的草稿。
- `parseAssembly3D`：严格识别格式并校验引用；不调用 solver、不贴地、不归一化/截断位姿、不读当前 Registry 的最新版本。
- `validateAssembly3D`：检查文档里**实际保存**的 poses。默认允许多组件、关闭地面、稳定性、教程和产品文案规则；`{checkGround:true}` 可检查真实世界高度，`{requireConnected:true}` 可要求单一连接组件。
- `solveAssembly3D(assembly, roots?)`：显式操作，返回新文档，不修改输入。每个组件用保存的 root pose 起算，groundLock=false；roots 可指定每组件一个实例 ID，未指定时用该组件 ID 字典序第一片。自由单片与组件 root 的 pose 原样保留。不会自动增加 revision，由未来保存/编辑提交层统一决定。
- 加载不固定新的 solver root；root 选择是一次求解操作参数，不是当前 schema 中的持久 pin/lock 规则。若以后支持锁定多个片，需要单独版本化约束语义。

ProfileSnapshot 包含完整几何与版本，旧存档不随 Registry 升级漂移。本阶段没有文件存储 UI、服务端写入、签名或不可篡改校验；外部导入的 snapshot 自身是其几何来源，若以后要求可信 Registry 身份，应在边界增加 hash/来源验证，不能仅凭 ID@Version 当作认证。

**调用示例**

```ts
import { profiles } from './src/magnetic-tiles/profiles.ts'
import { solveAssembly3D, validateAssembly3D, serializeAssembly3D, parseAssembly3D } from './src/magnetic-tiles/three-d/index.ts'
import type { Assembly3D } from './src/magnetic-tiles/three-d/index.ts'

const assembly: Assembly3D = {
  kind: 'magnetic-assembly-3d', schemaVersion: 1, id: 'pair', revision: 0,
  profiles: [{ profile: structuredClone(profiles[0]), thickness: .05 }],
  pieces: ['a', 'b'].map(id => ({ id, profileId: 'square', profileVersion: 1,
    pose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } })),
  connections: [{ pieceA: 'a', portA: 'e0-p0', pieceB: 'b', portB: 'e0-p0', dihedralDeg: 90 }],
}
const solved = solveAssembly3D(assembly, ['a'])
const report = validateAssembly3D(solved) // { valid: true, issues: [] }
const restored = parseAssembly3D(serializeAssembly3D(solved))
// restored retains every pose; no solve is triggered here.
```

**测试与用户验收**

```bash
npm run test:magnetic-3d
npm run typecheck:magnetic-3d
node --experimental-strip-types --test test/magnetic-*.test.mjs
npm run build
```

几何检查在 `checks/magnetic-3d`，原上游 50 个用例保留断言，其中一个“合法平接”夹具补上 flip:true，避免原输入实际重叠却被旧接缝规则错误放行。独立立方体 fixture 先指定六个面的位置/旋转，再按预期边端点生成 12 个连接，不用待测 solver 生成预期几何。检查全部根、两种连接顺序、全部位姿与 12 边残差，并验证错误闭环和碰撞。

新增覆盖：正反连接/flip/正负角、三角形与方片、Profile 多版本/实际尺寸/面积质心/scale/边区间、分段长边连接两片、半圆曲区重叠/分离/地面、薄片碰撞、多组件、实际地面高度、自由 pose 精确恢复、不合法数字/引用/版本拒绝。

本阶段不需要运行服务器或点击 UI；验收以这些 API 和 fixtures 为准。可修改 fixture 中某片位置 0.1 个单位，确认 validate 报 position residual；将 +90 位姿与 -90 约束对照，确认报 180 度角差；保存/读回自由片，确认 pose 与 ProfileSnapshot 一致。不能以“看起来像立方体”代替 12 条边的约束检查。

**剩余限制与阶段二建议**

仍使用上游绝对世界单位阈值：位置 0.01、方向 dot 0.999、角度 1 度、端口长度差 1%；连接处浅穿透例外仍是近似。细小碰撞和采样曲线弦误差有容忍范围，没有连续碰撞检测、全局闭环拟合或现实磁力稳定性保证。阶段一公共 Profile 路径只接现有严格凸的直边 Profile；曲边补丁保证上游内置半圆/扇形不崩溃，未扩展本地 Registry 为曲边编辑器。

下一阶段优先搬 `MagnetScene3D`、`magnet3d/primitives`、`cameraUtils`、`SceneLighting`；让它们使用当前 catalog 和保存的实际 pose，避免重新创建一套 engine 或再从裸形状名找尺寸。保留 Three 0.180.0 优先，React 19 接匹配的 R3F/Drei 生态，单独验证。位姿按本契约传入，geometry 缓存与文档配置隔离。依赖、渲染与交互测试属于阶段二；本阶段到此停止。

**阶段一验证结果（2026-10-30）**

- 3D：6 个测试文件、97 项通过，其中 50 项沿用上游用例；没有声称语句/分支覆盖率。
- `typecheck:magnetic-3d`：包含公共边界、vendor、fixtures 与测试的 TypeScript 6 检查通过。
- 现有 `test/magnetic-*.test.mjs`：121 项通过。
- `npm run build`：全项目 TypeScript + Vite 8 生产构建通过，只有原有大 chunk 提示。
- 原有依赖版本未改变；只增加 Vitest 开发依赖及独立检查命令。
- 未运行 3D 浏览器/Viewer 验收，因为本阶段没有集成 UI；不需要生产数据或 provider credentials。
