import {Quaternion,Vector3} from 'three';
import {serializeAssembly3D,fromEnginePose} from './assembly.ts';
import type {Assembly3D} from './assembly.ts';
import type {Connection} from './vendor/engine/types.ts';
import type {EditorHistory} from './vendor/editor/state.ts';
import {commit} from './vendor/editor/state.ts';
import {computeSnapTransform,isPortOccupied,portsCompatible} from './vendor/editor/snap.ts';
import {editorProject} from './editor-project.ts';
import {validateAssembly3D} from './engine-adapter.ts';

export type EdgeSnapPreview={sourceRaw:string;connection:Connection;assembly:Assembly3D;geometry:ReturnType<typeof validateAssembly3D>};
/** Use upstream port math; change only B, never solve/reposition its neighbours. */
export function previewEdgeSnap(assembly:Assembly3D,connection:Connection):EdgeSnapPreview{
 const sourceRaw=serializeAssembly3D(assembly),project=editorProject(assembly),c=structuredClone(connection);
 const a=assembly.pieces.find(p=>p.id===c.pieceA),b=assembly.pieces.find(p=>p.id===c.pieceB);
 if(!a||!b||a.id===b.id)throw Error('请选择不同的源零件 B 和目标 A');
 const shape=(id:string)=>project.shapes.get(project.parts.find(p=>p.id===id)!.shape)!;
 const pa=shape(a.id).ports.find(p=>p.portId===c.portA),pb=shape(b.id).ports.find(p=>p.portId===c.portB);
 if(!pa||!pb||!portsCompatible(pa,pb))throw Error('Port 不存在或实际边长不兼容');
 if(isPortOccupied(a.id,c.portA,assembly.connections)||isPortOccupied(b.id,c.portB,assembly.connections))throw Error('连接边已占用；请先明确解除原连接，再重新吸附');
 const tf=computeSnapTransform(a.id,c.portA,b.id,c.portB,c.dihedralDeg,c.flip??false,project);
 if(!tf)throw Error('无法计算吸附 Pose；检查 Port、Dihedral 和 flip');
 const moving=tf.position.distanceTo(new Vector3(...b.pose.position))>1e-8||1-Math.abs(tf.quaternion.dot(new Quaternion(...b.pose.quaternion)))>1e-10;
 if(moving&&assembly.connections.some(x=>x.pieceA===b.id||x.pieceB===b.id))throw Error('源零件仍有连接；移动前请解除相关连接，不会自动移动邻片或修改闭环');
 const next=structuredClone(assembly);next.pieces.find(p=>p.id===b.id)!.pose=fromEnginePose(tf);next.connections.push(c);
 const geometry=validateAssembly3D(next),before=validateAssembly3D(assembly);
 const key=(i:typeof geometry.issues[number])=>JSON.stringify([i.code,i.pieceId,i.message]);
 const pair=(i:typeof geometry.issues[number])=>i.relatedPieceIds?.slice().sort().join('|');
 const added=geometry.issues.filter(i=>i.severity==='error').filter(i=>{
  if(i.code==='intersection'){
   // SAT minimum-axis depth alone cannot measure worsening overlap (e.g. two
   // parallel plates always have the same thickness depth). A moved source
   // must be collision-free under the existing strict Validator.
   if(moving&&i.relatedPieceIds?.includes(b.id))return true;
   const prior=before.issues.find(p=>p.severity==='error'&&p.code==='intersection'&&pair(p)===pair(i));
   return !prior||(i.penetrationDepth??Infinity)>(prior.penetrationDepth??0)+1e-7;
  }
  return !before.issues.some(p=>p.severity==='error'&&key(p)===key(i));
 });
 if(added.length)throw Error('吸附被严格验证拒绝，原 Draft 保留：'+added.map(i=>i.message).join('；'));
 return {sourceRaw,connection:c,assembly:next,geometry};
}
export function confirmEdgeSnap(history:EditorHistory,preview:EdgeSnapPreview):EditorHistory{
 if(serializeAssembly3D(history.current)!==preview.sourceRaw)throw Error('吸附预览已过期，请重新预览；原 Draft 保留');
 // Do not trust the preview object or a prior validation result at commit time.
 const checked=previewEdgeSnap(history.current,preview.connection);
 return commit(history,()=>checked.assembly);
}
export function disconnectPieceForSnap(history:EditorHistory,id:string):EditorHistory{
 return commit(history,a=>{
  if(!a.pieces.some(p=>p.id===id))throw Error('找不到待解除连接的零件');
  a.connections=a.connections.filter(c=>c.pieceA!==id&&c.pieceB!==id);return a;
 });
}
