import {mkdir,readFile,readdir,writeFile,rename,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {buildPlannerConfig,runBuildPlanner} from './brick-build-planner.mjs'
import {inspectBuildPlan} from '../src/brick-build/plan.mjs'
const fail=(message,statusCode=422)=>{throw Object.assign(new Error(message),{statusCode})}
const id=value=>{if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))fail('无效记录 ID');return value}
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function createBuildOrderStore(directory){
 const folder=path.join(directory,'brick-build-plans'),locks=new Map(),generating=new Set()
 const file=key=>path.join(folder,id(key)+'.json')
 async function files(dir){return (await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))}
 async function source(value,forPlanner=false,withEvidence=false){
  const selection=await read(path.join(directory,'brick-spatial-selections',id(value)+'.json'))
  if(selection.id!==value||selection.kind!=='selected-valid-layout')fail('必须使用已保存的 Valid Layout Selection')
  const g=await read(path.join(directory,'brick-spatial-geometry',id(selection.geometryId)+'.json'))
  const c=g.candidates?.find(c=>c.id===selection.candidateId)
  if(g.id!==selection.geometryId||g.planId!==selection.planId||g.sourcePlanHash!==selection.sourcePlanHash||g.state!=='complete'||!c||c.kind!=='valid'||c.geometry?.valid!==true||c.collision?.status!=='clear'||!Array.isArray(c.geometry.connections))fail('来源不是已完成验证的 Valid 候选')
  if(hash(c)!==selection.candidateHash||JSON.stringify(c.assembly)!==JSON.stringify(selection.assembly))fail('Selection 与候选快照不一致',409)
  return {...selection,...(withEvidence?{geometryEvidence:{version:g.version,revisionId:g.revisionId??null,sourcePlan:g.sourcePlan,sourceInput:g.sourceInput,candidateIds:g.candidates.map(c=>c.id)}}:{}),...(forPlanner?{geometryObservations:g.sourceInput?.observations||[],geometryUnits:g.sourceInput?.units}:{}),connections:c.geometry.connections,identities:(g.sourceInput?.observations||[]).map(o=>({id:o.id,partNumber:o.confirmedPart?.part_num||o.part,color:String(o.confirmedPart?.color_id??o.color)}))}
 }
 function check(plan,src){
  if(!plan||typeof plan!=='object')fail('Build Plan 缺失')
  id(plan.build_plan_id)
  const keys=['schema_version','build_plan_id','source_selection_id','source_geometry_result_id','source_candidate_id','source_candidate_hash','title','status','instanceIds','assemblyNodes','steps','rootNodeId','created_at','updated_at']
  if(Object.keys(plan).some(k=>!keys.includes(k)))fail('Build Plan 含未支持字段；不得保存新的最终位姿')
  if(plan.source_selection_id!==src.id||plan.source_geometry_result_id!==src.geometryId||plan.source_candidate_id!==src.candidateId||plan.source_candidate_hash!==src.candidateHash)fail('Build Plan 来源关联不一致',409)
  const report=inspectBuildPlan(plan,src.assembly.bricks.map(b=>b.id),src.connections)
  if(!report.valid)fail(report.errors.join('；'))
  return report
 }
 async function load(value,withEvidence=false){const plan=await read(file(value));if(plan.build_plan_id!==value)fail('Build Plan ID 不一致');const src=await source(plan.source_selection_id,false,withEvidence);return {plan,source:src,validation:check(plan,src)}}
 async function save(body){
  const key=id(body.plan?.build_plan_id)
  if(locks.has(key))fail('此 Build Plan 正在保存，请稍后重新保存',409)
  locks.set(key,true)
  try{
   const src=await source(body.plan.source_selection_id),report=check(body.plan,src)
   const old=await read(file(key)).catch(e=>{if(e.code==='ENOENT')return null;throw e})
   if(old&&(body.expectedUpdatedAt!==old.updated_at||old.source_selection_id!==src.id))fail('Build Plan 已变化，请重新加载；未覆盖其他编辑',409)
   if(!old&&body.expectedUpdatedAt!==null)fail('Build Plan 不存在，请新建',409)
   const now=new Date(Math.max(Date.now(),old?Date.parse(old.updated_at)+1:0)).toISOString()
   const plan={...body.plan,created_at:old?.created_at||now,updated_at:now}
   await mkdir(folder,{recursive:true})
   const temp=file(key)+'.'+randomUUID()+'.tmp'
   try{await writeFile(temp,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});await rename(temp,file(key))}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
   return {plan,validation:report}
  }finally{locks.delete(key)}
 }
 return {async readForGallery(selectionId,planId){return planId?load(planId,true):{source:await source(selectionId,false,true),plan:null,validation:null}},async dispatch(method,route,body={},query=new URLSearchParams()){
  if(method==='GET'&&route==='planner-config')return buildPlannerConfig()
  if(method==='POST'&&route==='generate'){
   const selectionId=id(body.selectionId),requestId=id(body.requestId)
   if(generating.has(selectionId))fail('此 Layout 正在生成 Build Order，请等待；未重复调用',409)
   generating.add(selectionId)
   try{
    const src=await source(selectionId,true)
    if(body.candidateHash!==src.candidateHash)fail('来源候选已变化，请重新加载',409)
    return await runBuildPlanner(src,{directory:path.join(directory,'brick-build-traces'),requestId})
   }finally{generating.delete(selectionId)}
  }
  if(method==='GET'&&route==='selections'){
   const items=[],warnings=[]
   for(const f of await files(path.join(directory,'brick-spatial-selections'))){try{const s=await source(f.slice(0,-5));items.push({id:s.id,createdAt:s.createdAt,analysisId:s.analysisId,planId:s.planId,candidateId:s.candidateId,count:s.assembly.bricks.length})}catch{warnings.push('无法使用 Selection '+f)}}
   return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),warnings}
  }
  if(method==='GET'&&/^sources\/[a-f0-9-]+$/.test(route))return source(route.split('/')[1])
  if(method==='GET'&&route==='plans'){
   const selectionId=id(query.get('selectionId')),items=[],warnings=[]
   for(const f of await files(folder)){try{const p=await read(path.join(folder,f));if(p.source_selection_id===selectionId){const v=inspectBuildPlan(p);items.push({id:p.build_plan_id,title:p.title,status:p.status,updatedAt:p.updated_at,complete:v.valid&&v.complete})}}catch{warnings.push('无法读取 Build Plan '+f)}}
   return {items:items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),warnings}
  }
  if(method==='GET'&&/^plans\/[a-f0-9-]+$/.test(route))return load(route.split('/')[1])
  if(method==='POST'&&route==='save')return save(body)
  fail('未知 Build Order 操作',404)
 }}
}
