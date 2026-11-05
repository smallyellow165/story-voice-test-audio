import {Quaternion,Vector3} from 'three'
import {canonical} from '../build-plan.ts'
import type {Assembly3D} from './assembly.ts'
import type {Connection} from './vendor/engine/types.ts'

/** A Combined owns every piece outside its immutable Parent membership lists.
 * Free pieces and their links use the existing pieces/connections arrays. */
export function parentModule(a:Assembly3D,id:string){return a.modules?.find(m=>m.pieces.some(p=>p.id===id))}
export function parentInternalConnection(a:Assembly3D,c:Connection){const m=parentModule(a,c.pieceA);return !!m&&m.pieces.some(p=>p.id===c.pieceB)}
export function combinedSolveReason(a:Assembly3D,root:string){
 if(!a.modules)return ''
 const seen=new Set([root]),queue=[root]
 while(queue.length){const id=queue.shift()!;if(parentModule(a,id))return '该连通组件包含固定 Parent；不能通过单片求解移动 Group。请使用单端 Snap 或修改约束后查看几何诊断。';for(const c of a.connections){const next=c.pieceA===id?c.pieceB:c.pieceB===id?c.pieceA:null;if(next&&!seen.has(next)){seen.add(next);queue.push(next)}}}
 return ''
}
/** Both history commits and server save boundaries enforce the same invariant.
 * Explicit Group transforms update its frame; free edits never update it. */
export function assertFixedModuleGeometry(a:Assembly3D,baseline:Assembly3D){
 if(!baseline.modules)return
 if(!a.modules||canonical(a.modules.map(({frame,...m})=>m))!==canonical(baseline.modules.map(({frame,...m})=>m)))throw Error('Combined Parent 与模块成员不可重绑')
 const pieces=new Map(a.pieces.map(p=>[p.id,p])),originals=new Map(baseline.pieces.map(p=>[p.id,p]))
 const profiles=new Set(baseline.modules.flatMap(m=>m.pieces.map(p=>{const piece=originals.get(p.id)!;return `${piece.profileId}@${piece.profileVersion}`})))
 for(const key of profiles){const find=(x:Assembly3D)=>x.profiles.find(p=>`${p.profile.id}@${p.profile.version}`===key);if(canonical(find(a))!==canonical(find(baseline)))throw Error('Parent Profile / Port 快照不可修改或拉伸')}
 for(const m of a.modules){
  const old=baseline.modules.find(p=>p.id===m.id)!,q=new Quaternion(...m.frame.quaternion).multiply(new Quaternion(...old.frame.quaternion).invert()).normalize(),t=new Vector3(...m.frame.position).sub(new Vector3(...old.frame.position).applyQuaternion(q))
  for(const {id}of m.pieces){const p=pieces.get(id),b=originals.get(id);if(!p||!b||p.profileId!==b.profileId||p.profileVersion!==b.profileVersion||new Vector3(...p.pose.position).distanceTo(new Vector3(...b.pose.position).applyQuaternion(q).add(t))>1e-6||1-Math.abs(new Quaternion(...p.pose.quaternion).dot(q.clone().multiply(new Quaternion(...b.pose.quaternion))))>1e-10)throw Error('Parent Tile 的几何和相对 Pose 不可单片修改；请使用 Group 变换或编辑自由 Tile')}
  const ids=new Set(m.pieces.map(p=>p.id)),internal=(x:Assembly3D)=>x.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB)).map(c=>canonical(c)).sort()
  if(canonical(internal(a))!==canonical(internal(baseline)))throw Error('Parent Group 内部 Connection 不可修改；请编辑 Combined 自由零件及外部连接')
 }
}
