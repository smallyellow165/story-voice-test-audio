import { profileIssues } from './geometry.ts'
import type { Profile, Vec } from './geometry.ts'
export const shapeFields = {
 square: { name:'正方形 Square', fields:['side'] },
 rectangle: { name:'长方形 Rectangle', fields:['width','height'] },
 'equilateral-triangle': { name:'等边三角形 Equilateral', fields:['side'] },
 'isosceles-triangle': { name:'等腰三角形 Isosceles', fields:['base','height'] },
 'right-triangle': { name:'直角三角形 Right', fields:['legA','legB'] },
} as const
export type Shape = keyof typeof shapeFields
export type Parameters = { shape: Shape; dimensions: Record<string,number> }
export type ProfileInput = { id:string; name:string; parameters:Parameters; connectableEdges:string[]; estimated:boolean; source:string }
export const dimensionNames:Record<string,string>={side:'边长',width:'宽',height:'高度',base:'底边',legA:'直角边 A',legB:'直角边 B'}
export function parametricProfile(input:ProfileInput,version:number):Profile {
 if(!input||typeof input.id!=='string'||input.id.length>80||input.id==='unknown'||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||typeof input.source!=='string'||input.source.length>2000||typeof input.estimated!=='boolean')throw Error('名称、ID 或来源说明无效（unknown 为保留 ID）')
 const params=input.parameters
 if(!params||!Object.hasOwn(shapeFields,params.shape)||!params.dimensions||typeof params.dimensions!=='object')throw Error('形状参数无效')
 const fields=shapeFields[params.shape].fields
 if(Object.keys(params.dimensions).length!==fields.length||fields.some(k=>!Number.isFinite(params.dimensions[k])||params.dimensions[k]<=0))throw Error('尺寸必须为有限正数，且与形状参数一致')
 const {side:s,width:w,height:h,base:b,legA:a,legB:c}=params.dimensions
 let vertices:Vec[]
 switch(params.shape){
  case 'square':vertices=[[0,0],[s,0],[s,s],[0,s]];break
  case 'rectangle':vertices=[[0,0],[w,0],[w,h],[0,h]];break
  case 'equilateral-triangle':vertices=[[0,0],[s,0],[s/2,s*Math.sqrt(3)/2]];break
  case 'isosceles-triangle':vertices=[[0,0],[b,0],[b/2,h]];break
  case 'right-triangle':vertices=[[0,0],[a,0],[0,c]];break
 }
 const p:Profile={id:input.id,name:input.name.trim(),version,vertices,connectableEdges:structuredClone(input.connectableEdges),parametric:{shape:params.shape,dimensions:Object.fromEntries(fields.map(k=>[k,params.dimensions[k]]))},geometrySource:input.source.trim(),...(input.estimated?{sizeEvidence:{status:'estimated',source:input.source.trim()||'用户输入的估计尺寸'}}:{})}
 const issues=profileIssues(p);if(issues.length)throw Error(issues.join('；'))
 return p
}
export function profileAngles(p:Profile){return p.vertices.map((v,i)=>{const a=p.vertices[(i+p.vertices.length-1)%p.vertices.length],b=p.vertices[(i+1)%p.vertices.length],u=[a[0]-v[0],a[1]-v[1]],w=[b[0]-v[0],b[1]-v[1]];return Math.acos(Math.max(-1,Math.min(1,(u[0]*w[0]+u[1]*w[1])/(Math.hypot(...u)*Math.hypot(...w)))))*180/Math.PI})}
// Only used to populate the editor for legacy shapes. Saved versions are never
// inferred, migrated or rewritten; new parametric versions use the chosen type.
export function parametersFor(p:Profile):Parameters|null {
 if(p.parametric)return structuredClone(p.parametric)
 const v=p.vertices,near=(a:number,b:number)=>Math.abs(a-b)<1e-8
 if(!near(v[0][0],0)||!near(v[0][1],0)||!near(v[1][1],0))return null
 const side=v[1][0]
 if(v.length===4&&near(v[2][0],side)&&near(v[3][0],0)&&near(v[2][1],v[3][1]))return near(side,v[2][1])?{shape:'square',dimensions:{side}}:{shape:'rectangle',dimensions:{width:side,height:v[2][1]}}
 if(v.length===3&&near(v[2][0],0))return {shape:'right-triangle',dimensions:{legA:side,legB:v[2][1]}}
 if(v.length===3&&near(v[2][0],side/2))return near(v[2][1],side*Math.sqrt(3)/2)?{shape:'equilateral-triangle',dimensions:{side}}:{shape:'isosceles-triangle',dimensions:{base:side,height:v[2][1]}}
 return null
}
