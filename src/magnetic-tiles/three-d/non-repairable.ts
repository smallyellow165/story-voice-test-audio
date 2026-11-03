import type {Assembly3D} from './assembly.ts'
/** An optimization preference, never a validation exemption.
 * Keep pair intent through pose changes and incidental collision disappearance;
 * drop deleted instances and never transfer it to another Assembly identity. */
export function nonRepairableKeys(assembly:Assembly3D,keys:readonly string[]):string[]{
 const ids=new Set(assembly.pieces.map(p=>p.id)),valid:string[]=[]
 for(const key of keys){
  let pair:unknown;try{pair=JSON.parse(key)}catch{throw Error('不可修复碰撞标记格式无效')}
  if(!Array.isArray(pair)||pair.length!==2||pair.some(id=>typeof id!=='string')||pair[0]===pair[1])throw Error('不可修复碰撞必须引用两个不同零件')
  if(pair.every(id=>ids.has(id)))valid.push(JSON.stringify([...pair].sort()))
 }
 return [...new Set(valid)].sort()
}
