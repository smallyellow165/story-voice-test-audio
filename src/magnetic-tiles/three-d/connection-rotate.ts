import {Quaternion,Vector3} from 'three'
import {serializeAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import {createViewerModel} from './viewer-model.ts'
import {parentModule} from './combined-editing.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import {computeAllConnectionResiduals,portWorldEndpoints} from './vendor/engine/solver.ts'
import {commit} from './vendor/editor/state.ts'
import type {EditorHistory} from './vendor/editor/state.ts'
import type {EdgeSnapMode} from './editor-snap.ts'

export type ConnectionRotationPreview={
 sourceRaw:string;pieceId:string;connectionIndex:number;deltaDeg:number;mode:EdgeSnapMode
 axis:{fixedId:string;fixedPort:string;p0:number[];p1:number[]}
 assembly:Assembly3D;geometry:ReturnType<typeof validateAssembly3D>;canConfirm:boolean
}

/** One rigid Tile rotation about an existing WORLD Port, never a component solve.
 * Only that Tile and the chosen joint's signed dihedral may change. */
export function previewConnectionRotation(a:Assembly3D,pieceId:string,connectionIndex:number,deltaDeg:number,mode:EdgeSnapMode='strict'):ConnectionRotationPreview{
 if(mode!=='strict'&&mode!=='less-strict')throw Error('无效的旋转验证模式')
 if(!Number.isFinite(deltaDeg))throw Error('请输入有限的旋转角度')
 const piece=a.pieces.find(p=>p.id===pieceId),c=a.connections[connectionIndex]
 if(!piece||!Number.isInteger(connectionIndex)||!c||![c.pieceA,c.pieceB].includes(pieceId))throw Error('请选择当前 Tile 已建立的 Connection')
 if(parentModule(a,pieceId))throw Error('固定 Parent 成员不能单片旋转；请选择可编辑 Tile')
 const models=createViewerModel(a),transforms=Object.fromEntries(models.map(p=>[p.id,p.transform])),getShape=(id:string)=>models.find(p=>p.id===id)?.shape
 const initial=computeAllConnectionResiduals([c],transforms,getShape)[0]
 if(!initial||initial.positionError>1e-8||initial.directionDot<1-1e-8||initial.dihedralError>1e-6)throw Error('所选连接的 Port / Dihedral 未精确对齐，请先修正连接；未旋转')
 const movingA=c.pieceA===pieceId,fixedId=movingA?c.pieceB:c.pieceA,fixedPort=movingA?c.portB:c.portA
 const axis=portWorldEndpoints(fixedId,fixedPort,transforms,getShape)
 if(!axis||axis.p0.distanceToSquared(axis.p1)<1e-16)throw Error('连接边缺少有效的世界空间旋转轴')
 const next=structuredClone(a),target=next.pieces.find(p=>p.id===pieceId)!,radians=(deltaDeg%360)*Math.PI/180
 if(radians!==0){
  const delta=new Quaternion().setFromAxisAngle(axis.dir,radians)
  target.pose={position:new Vector3(...piece.pose.position).sub(axis.p0).applyQuaternion(delta).add(axis.p0).toArray(),quaternion:delta.clone().multiply(new Quaternion(...piece.pose.quaternion)).normalize().toArray()}
  const updated={...transforms,[pieceId]:{position:new Vector3(...target.pose.position),quaternion:new Quaternion(...target.pose.quaternion)}}
  // Measure the signed angle in the ORIGINAL Connection A frame, including
  // when the selected Tile is A or Flip reverses its endpoint correspondence.
  const A=portWorldEndpoints(c.pieceA,c.portA,updated,getShape)!,B=portWorldEndpoints(c.pieceB,c.portB,updated,getShape)!
  next.connections[connectionIndex].dihedralDeg=Math.atan2(new Vector3().crossVectors(A.normal,B.normal).dot(A.dir),A.normal.dot(B.normal))*180/Math.PI
 }
 const geometry=validateAssembly3D(next)
 const blockers=geometry.issues.filter(i=>i.severity==='error'&&(mode==='strict'||i.code!=='intersection'))
 return{sourceRaw:serializeAssembly3D(a),pieceId,connectionIndex,deltaDeg,mode,axis:{fixedId,fixedPort,p0:axis.p0.toArray(),p1:axis.p1.toArray()},assembly:next,geometry,canConfirm:blockers.length===0}
}

export function confirmConnectionRotation(h:EditorHistory,p:ConnectionRotationPreview,mode:EdgeSnapMode='strict'){
 if(p.mode!==mode||p.sourceRaw!==serializeAssembly3D(h.current))throw Error('旋转预览已过期或模式已变化，请重新预览；原 Draft 保留')
 const checked=previewConnectionRotation(h.current,p.pieceId,p.connectionIndex,p.deltaDeg,mode)
 if(!checked.canConfirm)throw Error('旋转被验证拒绝，原 Draft 保留：'+checked.geometry.issues.filter(i=>i.severity==='error'&&(mode==='strict'||i.code!=='intersection')).map(i=>i.message).join('；'))
 return commit(h,()=>checked.assembly)
}
