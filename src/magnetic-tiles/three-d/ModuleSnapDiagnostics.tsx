import {useMemo} from 'react'
import type {Assembly3D} from './assembly.ts'
import type {ModulePreview} from './module-transform.ts'
import {moduleSnapDiagnostics} from './module-snap-diagnostics.ts'
import type {SnapOrientationTarget} from './module-snap-diagnostics.ts'
import {spatialNumber} from './GroupSpatialInspection.tsx'

export function ModuleSnapDiagnostics({assembly,preview,movingId,fixedId,target,acceptedKeys,beforeReport}:{assembly:Assembly3D;preview:ModulePreview;movingId:string;fixedId:string;target?:SnapOrientationTarget;acceptedKeys?:readonly string[];beforeReport:ModulePreview['geometry']}){
 const d=useMemo(()=>moduleSnapDiagnostics(assembly,preview,movingId,fixedId,target,acceptedKeys,beforeReport),[assembly,preview,movingId,fixedId,target,acceptedKeys,beforeReport]),o=d.orientation,collisions=d.collisions
 const name=o?assembly.modules?.find(m=>m.id===movingId)?.pieces.find(p=>p.id===o.target.pieceId)?.sourceId:undefined
 return <div className="snap-preview-diagnostics" data-testid="snap-constraint-diagnostics">
  <p>当前 Port + Flip + Dihedral 唯一确定一个连接姿态；没有其他同约束候选。0° 表示两片正面法向相同；Flip 仅交换移动 Port 端点。</p>
  {d.connectionErrors.length>0&&<p className="magnetic-3d-blocker" data-testid="snap-no-confirmable-solution">当前参数无可确认解：严格 Validator 报告 {d.connectionErrors.length} 项非碰撞错误（{[...new Set(d.connectionErrors.map(i=>i.code))].join('、')}）。端口对齐姿态未满足全部现有约束，详见 Validator Diagnostics。</p>}
  <dl>
   <dt>端口残差</dt><dd data-testid="snap-port-residual" data-position={d.residual.positionError} data-direction={d.residual.directionDot} data-angle={d.residual.dihedralError}>端点 {d.residual.positionError.toExponential(2)} · 方向点积 {spatialNumber(d.residual.directionDot)} · 角度误差 {spatialNumber(d.residual.dihedralError)}°</dd>
   <dt>相对当前 Pose</dt><dd>旋转 <output data-testid="snap-rotation-change">{spatialNumber(d.rotationDeg)}</output>° · Group 中心位移 {spatialNumber(d.pivotDistance)}</dd>
   <dt>底部 Y Min 差</dt><dd data-testid="snap-bottom-gap" data-gap={d.bottomGap}>{spatialNumber(d.bottomGapBefore)} → {spatialNumber(d.bottomGap)} · Moving − Fixed{Math.abs(d.bottomGap)>1e-6?'；端口对齐后底部未共面':'；底部共面'}</dd>
   <dt>方向参考</dt><dd>{o?<><span>{name} · {o.target.direction==='up'?'+Y 朝上':'+Z 朝前'} · 偏角 </span><output data-testid="snap-reference-angle" data-angle={o.angleDeg}>{spatialNumber(o.beforeAngleDeg)}° → {spatialNumber(o.angleDeg)}°</output><span> · 法向 [{o.normal.map(spatialNumber).join(', ')}]</span>{o.angleDeg>1e-6&&<div>当前 Dihedral / Flip 无法保持该方向。{o.requiredDihedralDeg===null?'保持方向也无法仅靠调整 Dihedral 达成。':`此 Flip 保持方向所需 Dihedral ${spatialNumber(o.requiredDihedralDeg)}°；需手动修改并重新验证底部与碰撞。`}</div>}</>:<span data-testid="snap-reference-missing">未指定；在 Orient 选择参考 Tile 并点击朝上 / 朝前后记录本次会话目标。重新加载需重新指定。</span>}</dd>
   <dt>严格碰撞诊断</dt><dd data-testid="snap-collision-delta" data-new-cross={collisions.newCross}>已有碰撞对 {collisions.retained}（{acceptedKeys?`输入时人工接受 ${collisions.acceptedBefore}`:'输入审核未读取'}）· 消失 {collisions.removed} · 新增跨 Group {collisions.newCross}（最大深度 {spatialNumber(collisions.newCrossMaxDepth)}）· 新增组内 {collisions.newInternal} · 已有跨组诊断变化 {collisions.changedCross}</dd>
  </dl>
  <small>Geometry {d.geometryValid?'Valid':'Invalid'} · 非碰撞错误 {d.connectionErrors.length}。碰撞分类来自原 Validator；人工接受仅指输入快照，预览不授予任何新审核。</small>
 </div>
}
