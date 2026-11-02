// Small, explicitly annotated isolated Project. No model calls or real records.
import {randomUUID} from 'node:crypto'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
import {reconstructionInput} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-scope.ts'
export async function selectedProject(api){
 const base=await visibleFixture(),post=(r,b)=>api.dispatch('POST','visible3d/'+r,b)
 const source=await api.dispatch('POST','sources',{name:'OFFLINE Front Back selection test.png',original:png,view:png})
 const evidence=structuredClone(base.evidence),review=structuredClone(base.review)
 evidence.observations=[];review.pieces=[]
 for(const group of ['front','back'])for(const o of base.evidence.observations)evidence.observations.push({...structuredClone(o),id:group+'-'+o.id})
 for(const group of ['front','back'])for(const p of base.review.pieces)review.pieces.push({...structuredClone(p),id:group+'-'+p.id})
 const analysis=await post('annotate',{sourceId:source.id,evidence}),r=await post('reviews',{analysisId:analysis.id,review,expectedRevision:0})
 let moduleRecord=null,moduleHead={revision:0,recordHash:null}
 for(const name of ['Front','Back']){const result=await post('module-plans',{reviewId:r.record.id,reviewHash:r.record.hash,expectedRevision:moduleHead.revision,expectedHash:moduleHead.recordHash,command:{kind:'create',name,observationIds:review.pieces.filter(p=>p.id.startsWith(name.toLowerCase())).map(p=>p.id)}});moduleRecord=result.record;moduleHead=result.head}
 const scopes={},plans={},executions={}
 for(const group of moduleRecord.modules){
  const scope=reconstructionInput(r.record.input,source,{groupId:group.id,imageId:'all'},moduleRecord).scope;scopes[group.name]=scope
  const native={...structuredClone(base.plan),parts:base.plan.parts.map(p=>({...p,id:group.name.toLowerCase()+'-'+p.id})),connections:base.plan.connections.map(c=>({...c,pieceA:group.name.toLowerCase()+'-'+c.pieceA,pieceB:group.name.toLowerCase()+'-'+c.pieceB,evidenceRefs:c.evidenceRefs.map(ref=>group.name.toLowerCase()+'-'+ref)}))}
  plans[group.name]=[];executions[group.name]=[]
  for(let i=0;i<2;i++){const p=await post('manual-plan',{reviewId:r.record.id,reconstructionScope:scope,plan:native}),x=await post('execute',{planId:p.id,requestId:randomUUID()});if(x.state!=='complete')throw Error(x.error);plans[group.name].push(p);executions[group.name].push(x.record)}
 }
 return {source,analysis,review:r.record,modules:moduleRecord,scopes,plans,executions,post}
}
