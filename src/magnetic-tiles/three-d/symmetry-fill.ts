import {Matrix4,Quaternion,Vector3} from 'three'
import {assertAssembly3D,fromEnginePose,serializeAssembly3D,toEnginePose} from './assembly.ts'
import type {Assembly3D,Piece3D,Pose3D} from './assembly.ts'
import {createViewerModel,componentCount} from './viewer-model.ts'
import type {ViewerPiece} from './viewer-model.ts'
import {assemblyValidationLayers,validateAssembly3D} from './engine-adapter.ts'
import {portWorldEndpoints,computeTransformFromConnection} from './vendor/engine/solver.ts'
import {shapeOutline} from './vendor/engine/outline.ts'
import {portsCompatible,isPortOccupied} from './vendor/editor/snap.ts'
import type {Connection} from './vendor/engine/types.ts'
import {commit} from './vendor/editor/state.ts'
import type {EditorHistory} from './vendor/editor/state.ts'

/** A world plane n·x = offset. This is an explicit hypothesis, never photo evidence. */
export type SymmetryPlane={normal:[number,number,number];offset:number}
export type SymmetryFillRequest={sourceIds:string[];plane:SymmetryPlane;confirmedPlane:boolean}
export type SymmetryFillPreview={sourceRaw:string;request:SymmetryFillRequest;assembly:Assembly3D;addedIds:string[];addedConnections:Connection[];scaffoldMap:Record<string,string>;geometry:ReturnType<typeof validateAssembly3D>;layers:ReturnType<typeof assemblyValidationLayers>;canCommit:boolean}
const fail=(message:string):never=>{throw Error(message)}
function normalized(plane:SymmetryPlane):SymmetryPlane{
 if(!plane||!Array.isArray(plane.normal)||plane.normal.length!==3||![...plane.normal,plane.offset].every(Number.isFinite))fail('对称平面必须包含有限法向和偏移')
 const length=Math.hypot(...plane.normal);if(!Number.isFinite(length)||length<1e-12)fail('对称平面法向不能为零')
 if(Math.abs(length-1)<1e-12)return {normal:[...plane.normal],offset:plane.offset}
 return {normal:plane.normal.map(v=>v/length) as SymmetryPlane['normal'],offset:plane.offset/length}
}
function reflectVector(v:Vector3,p:SymmetryPlane){const n=new Vector3(...p.normal);return v.clone().addScaledVector(n,-2*v.dot(n))}
export function reflectPoint(v:Vector3,plane:SymmetryPlane){const p=normalized(plane);return reflectVector(v,p).addScaledVector(new Vector3(...p.normal),2*p.offset)}
/** det(reflection)=-1. Reverse local Z as well to obtain a proper rotation.
 * XY/port vertex indexing stays identical; world normal becomes -M·normal.
 * The physical solid is exactly mirrored because thickness is symmetric in Z.
 */
export function reflectPose(pose:Pose3D,plane:SymmetryPlane):Pose3D{
 const p=normalized(plane),tf=toEnginePose(pose)
 const x=reflectVector(new Vector3(1,0,0).applyQuaternion(tf.quaternion),p),y=reflectVector(new Vector3(0,1,0).applyQuaternion(tf.quaternion),p),z=reflectVector(new Vector3(0,0,1).applyQuaternion(tf.quaternion),p).negate()
 const quaternion=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z)).normalize()
 return fromEnginePose({position:reflectPoint(tf.position,p),quaternion})
}
const vertices=(piece:ViewerPiece)=>shapeOutline(piece.shape).map(v=>new Vector3(v.x,v.y,0).applyQuaternion(piece.transform.quaternion).add(piece.transform.position))
function scaleOf(items:ViewerPiece[]){return Math.max(1e-9,...items.map(p=>p.shape.defaultSize))}
function sameSolid(a:ViewerPiece,b:ViewerPiece,tolerance:number,requireSameProfile=true){
 if(requireSameProfile&&(a.piece.profileId!==b.piece.profileId||a.piece.profileVersion!==b.piece.profileVersion)||Math.abs(a.shape.thickness-b.shape.thickness)>tolerance)return false
 const av=vertices(a),bv=vertices(b)
 return av.length===bv.length&&av.every(v=>bv.filter(w=>v.distanceTo(w)<=tolerance).length===1)&&1-Math.abs(new Vector3(0,0,1).applyQuaternion(a.transform.quaternion).dot(new Vector3(0,0,1).applyQuaternion(b.transform.quaternion)))<1e-9
}
function input(assembly:Assembly3D,sourceIds:string[]){
 assertAssembly3D(assembly)
 if(assembly.pieces.length>64||!sourceIds.length||sourceIds.length>32||new Set(sourceIds).size!==sourceIds.length)fail('V1 支持 1–32 个不同来源，补全后最多 64 片')
 const items=createViewerModel(assembly),sources=sourceIds.slice().sort().map(id=>items.find(p=>p.id===id)??fail('来源 Tile 不存在：'+id)),scaffold=items.filter(p=>!sourceIds.includes(p.id))
 if(!scaffold.length)fail('请保留至少一个未选中的框架 Tile，用于确定并检查对称平面')
 return {items,sources,scaffold,tolerance:scaleOf(items)*1e-7}
}
function scaffoldMapping(scaffold:ViewerPiece[],plane:SymmetryPlane,tolerance:number){
 const map:Record<string,string>=Object.create(null)
 for(const p of scaffold){const reflected={...p,transform:toEnginePose(reflectPose(p.piece.pose,plane))},matches=scaffold.filter(q=>sameSolid(reflected,q,tolerance));if(matches.length!==1)fail(`平面不能唯一映射框架 ${p.id}（${matches.length} 个匹配）；请选择或调整平面`);map[p.id]=matches[0].id}
 if(new Set(Object.values(map)).size!==scaffold.length)fail('框架的对称映射不是一一对应')
 return map
}
/** One conservative candidate: normal of a coplanar source patch; midpoint of
 * the full ideal outline extent. The remaining scaffold must map bijectively.
 * No world-up, name, color, shape family or tile order is used.
 */
export function proposeSymmetryPlane(assembly:Assembly3D,sourceIds:string[]):SymmetryPlane{
 const {items,sources,scaffold,tolerance}=input(assembly,sourceIds),n=new Vector3(0,0,1).applyQuaternion(sources[0].transform.quaternion).normalize(),d=n.dot(sources[0].transform.position)
 if(sources.some(p=>1-Math.abs(n.dot(new Vector3(0,0,1).applyQuaternion(p.transform.quaternion)))>1e-9||vertices(p).some(v=>Math.abs(n.dot(v)-d)>tolerance)))fail('来源零件不是同一平面，无法提供唯一的前后候选；请明确指定参考平面')
 const values=items.flatMap(vertices).map(v=>n.dot(v)),plane:SymmetryPlane={normal:n.toArray(),offset:(Math.min(...values)+Math.max(...values))/2}
 if(Math.abs(plane.offset-d)<=tolerance)fail('所选片位于候选平面上，无法确定缺失的一侧')
 scaffoldMapping(scaffold,plane,tolerance)
 return plane
}
export function referenceSymmetryPlane(assembly:Assembly3D,pieceId:string,axis:'x'|'y'|'z',offset=0):SymmetryPlane{
 if(!['x','y','z'].includes(axis))fail('请选择明确的参考 Tile 局部法向')
 const piece=assembly.pieces.find(p=>p.id===pieceId)??fail('参考 Tile 不存在'),n=new Vector3(...(axis==='x'?[1,0,0]:axis==='y'?[0,1,0]:[0,0,1]) as [number,number,number]).applyQuaternion(toEnginePose(piece.pose).quaternion)
 return normalized({normal:n.toArray(),offset:n.dot(new Vector3(...piece.pose.position))+offset})
}
function token(text:string){let value=2166136261;for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619);return (value>>>0).toString(16).padStart(8,'0')}
export function previewSymmetryFill(assembly:Assembly3D,request:SymmetryFillRequest):SymmetryFillPreview{
 if(request.confirmedPlane!==true)fail('请先确认对称平面；补全是用户假设，不是照片直接观察')
 const {items,sources,scaffold,tolerance}=input(assembly,request.sourceIds),plane=normalized(request.plane)
 if(assembly.pieces.length+sources.length>64)fail('补全后超过 V1 的 64 片上限')
 const original=validateAssembly3D(assembly,{requireConnected:true})
 if(componentCount(assembly)!==1)fail('V1 需要连通的原作品；不自动为多个组件猜测连接')
 if(!assemblyValidationLayers(original).idealGeometry.valid)fail('原作品存在连接、Port 或闭环等结构错误；请先修复，再对称补全')
 const sourceRaw=serializeAssembly3D(assembly),sourceToAdded=new Map<string,string>(),used=new Set(assembly.pieces.map(p=>p.id))
 const suffix=token(sourceRaw+JSON.stringify(plane)+sources.map(p=>p.id).join('|'))
 const added:Piece3D[]=sources.map(p=>{let id=`${p.id.slice(0,100)}-sym-${suffix}`,i=1;while(used.has(id))id=`${p.id.slice(0,95)}-sym-${suffix}-${i++}`;used.add(id);sourceToAdded.set(p.id,id);return {...structuredClone(p.piece),id,pose:reflectPose(p.piece.pose,plane)}})
 const next=structuredClone(assembly);next.pieces.push(...added)
 const addedIdSet=new Set(added.map(p=>p.id)),newItems=createViewerModel(next).filter(p=>addedIdSet.has(p.id))
 for(const p of newItems){const duplicate=items.find(q=>sameSolid(p,q,tolerance,false));if(duplicate)fail(`重复补全：候选 ${p.id} 与现有 ${duplicate.id} 的实体位置相同`)}
 for(let i=0;i<newItems.length;i++)for(let j=0;j<i;j++)if(sameSolid(newItems[i],newItems[j],tolerance,false))fail('候选互相重复，未加入任何零件')
 const scaffoldMap=scaffoldMapping(scaffold,plane,tolerance)
 const all=createViewerModel(next),byId=new Map(all.map(p=>[p.id,p])),transforms=Object.fromEntries(all.map(p=>[p.id,p.transform])),getShape=(id:string)=>byId.get(id)?.shape
 const endpoints=(id:string,portId:string)=>portWorldEndpoints(id,portId,transforms,getShape)??fail(`无法定位 Port ${id}:${portId}`)
 function connection(a:string,pa:string,b:string,pb:string):Connection{
  const sa=getShape(a)!,sb=getShape(b)!,ap=sa.ports.find(p=>p.portId===pa)!,bp=sb.ports.find(p=>p.portId===pb)!
  if(!portsCompatible(ap,bp))fail(`实际 Port 长度不兼容：${a}:${pa} / ${b}:${pb}`)
  const ea=endpoints(a,pa),eb=endpoints(b,pb),same=ea.p0.distanceTo(eb.p0)<=tolerance&&ea.p1.distanceTo(eb.p1)<=tolerance,reverse=ea.p0.distanceTo(eb.p1)<=tolerance&&ea.p1.distanceTo(eb.p0)<=tolerance
  if(same===reverse)fail(`端点无法唯一对齐：${a}:${pa} / ${b}:${pb}`)
  const angle=Math.atan2(new Vector3().crossVectors(ea.normal,eb.normal).dot(ea.dir),ea.normal.dot(eb.normal))*180/Math.PI
  const c:Connection={pieceA:a,portA:pa,pieceB:b,portB:pb,dihedralDeg:Math.abs(angle)<1e-10?0:angle,flip:reverse}
  const tf=computeTransformFromConnection(transforms[a],sa,pa,sb,pb,c.dihedralDeg,reverse)
  if(!tf||tf.position.distanceTo(transforms[b].position)>tolerance||1-Math.abs(tf.quaternion.dot(transforms[b].quaternion))>1e-9)fail(`Solver 变换不能复核连接 ${a}:${pa} / ${b}:${pb}`)
  return c
 }
 const extra:Connection[]=[]
 function add(c:Connection){
  if(next.connections.some(x=>x.pieceA===c.pieceA&&x.portA===c.portA&&x.pieceB===c.pieceB&&x.portB===c.portB||x.pieceA===c.pieceB&&x.portA===c.portB&&x.pieceB===c.pieceA&&x.portB===c.portA))return
  if(isPortOccupied(c.pieceA,c.portA,next.connections)||isPortOccupied(c.pieceB,c.portB,next.connections))fail(`镜像连接端口已占用：${c.pieceA}:${c.portA} / ${c.pieceB}:${c.portB}；不会覆盖原连接`)
  next.connections.push(c);extra.push(c)
 }
 // Preserve every reflected source constraint, remapping fixed scaffold ports by
 // exact world endpoints (the existing tile's local numbering may be reversed).
 function mirroredPort(id:string,portId:string):[string,string]{
  if(sourceToAdded.has(id))return [sourceToAdded.get(id)!,portId]
  const target=scaffoldMap[id]??fail('连接没有可靠的对称目标：'+id),old=endpoints(id,portId),p0=reflectPoint(old.p0,plane),p1=reflectPoint(old.p1,plane)
  const matches=getShape(target)!.ports.filter(p=>{const e=endpoints(target,p.portId);return p0.distanceTo(e.p0)<=tolerance&&p1.distanceTo(e.p1)<=tolerance||p0.distanceTo(e.p1)<=tolerance&&p1.distanceTo(e.p0)<=tolerance})
  if(matches.length!==1)fail(`框架 Port 无法唯一映射：${id}:${portId} → ${target}`)
  return [target,matches[0].portId]
 }
 for(const c of assembly.connections)if(sourceToAdded.has(c.pieceA)||sourceToAdded.has(c.pieceB)){const [a,pa]=mirroredPort(c.pieceA,c.portA),[b,pb]=mirroredPort(c.pieceB,c.portB);add(connection(a,pa,b,pb))}
 // Exact geometric coincidences can provide extra connections beyond the source
 // graph. Never select an arbitrary partner when a port has multiple options.
 const ports=all.flatMap(p=>p.shape.ports.map(port=>({id:p.id,portId:port.portId,port}))),pairs:Connection[]=[],counts=new Map<string,number>();let checks=0
 if(ports.length>1024)fail('Port 数超过 V1 预算（1024）')
 const newIds=new Set(added.map(p=>p.id))
 for(let i=0;i<ports.length;i++)for(let j=0;j<i;j++){
  const a=ports[j],b=ports[i];if(a.id===b.id||!newIds.has(a.id)&&!newIds.has(b.id)||isPortOccupied(a.id,a.portId,next.connections)||isPortOccupied(b.id,b.portId,next.connections))continue
  if(++checks>20000)fail('端口连接检查预算耗尽（20000）；原 Draft 未改变')
  if(!portsCompatible(a.port,b.port))continue
  const ea=endpoints(a.id,a.portId),eb=endpoints(b.id,b.portId)
  if(!(ea.p0.distanceTo(eb.p0)<=tolerance&&ea.p1.distanceTo(eb.p1)<=tolerance||ea.p0.distanceTo(eb.p1)<=tolerance&&ea.p1.distanceTo(eb.p0)<=tolerance))continue
  const c=connection(a.id,a.portId,b.id,b.portId);pairs.push(c);for(const key of [a.id+':'+a.portId,b.id+':'+b.portId])counts.set(key,(counts.get(key)??0)+1)
 }
 if([...counts.values()].some(n=>n>1))fail('同一 Port 存在多个精确连接候选；V1 不自动猜测连接对象')
 for(const c of pairs)add(c)
 const geometry=validateAssembly3D(next,{requireConnected:true}),layers=assemblyValidationLayers(geometry),canCommit=layers.idealGeometry.valid&&componentCount(next)===1&&added.every(p=>extra.some(c=>c.pieceA===p.id||c.pieceB===p.id))
 return {sourceRaw,request:{sourceIds:sources.map(p=>p.id),plane,confirmedPlane:true},assembly:next,addedIds:added.map(p=>p.id),addedConnections:extra,scaffoldMap,geometry,layers,canCommit}
}
/** Recompute from authoritative input; never commit a modified preview object. */
export function confirmSymmetryFill(history:EditorHistory,preview:SymmetryFillPreview):EditorHistory{
 if(serializeAssembly3D(history.current)!==preview.sourceRaw)fail('补全预览已过期，请重新预览；原 Draft 未改变')
 const checked=previewSymmetryFill(history.current,preview.request)
 if(!checked.canCommit)fail('对称补全存在结构错误或未连接的零件，不能加入 Draft')
 return commit(history,()=>checked.assembly)
}
