import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { modelOptions, providerStatus } from './brick-model-registry.mjs'
import { loadBrickRules } from './brick-rules.mjs'
import { prepareInput } from '../experiments/spatial-planning/input.mjs'
import { runSpatialPlanning } from '../experiments/spatial-planning/runner.mjs'
import { validatePlan } from '../experiments/spatial-planning/plan.mjs'
import { executePlan } from '../experiments/geometry-execution/execute.mjs'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
const id=value=>{if(!uuid.test(value||''))fail('无效记录 ID');return value}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
async function write(file,data,exclusive=false){await mkdir(path.dirname(file),{recursive:true});if(exclusive)return writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data),{flag:'wx',mode:0o600});await rename(temp,file)}
async function records(directory){return (await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(f=>uuid.test(f.slice(0,-5))&&f.endsWith('.json'))}
export function reviewedSource(saved){
 const rows=(saved.analysis.analysis?.observations||[]).map(o=>{const r=saved.rows[o.id],selected=r?.index===undefined?null:r.search?.rows[r.index];return {id:o.id,excluded:!!r?.excluded,quantity:Number(r?.quantity),confirmedPart:selected?.sourceAllowed?selected.source:null}})
 const errors=[]
 if(saved.analysis.status!=='complete'||!saved.updatedAt)errors.push('需要已完成 Analysis 和已保存人工审核')
 if(!rows.some(r=>!r.excluded))errors.push('没有可用识别项')
 for(const r of rows.filter(r=>!r.excluded))if(!r.confirmedPart||r.quantity!==1)errors.push(r.id+'：需确认型号/颜色，且每个 Observation 恰好一块（V1 不猜测重复实例位置）')
 return {analysisId:saved.analysis.id,updatedAt:saved.updatedAt,rows,errors,ready:!errors.length,reviewVersion:hash({updatedAt:saved.updatedAt,rows}),warnings:saved.warnings||[]}
}
export function prepareReviewedSource(saved,mapping,rules,includeEvidence=true){
 const source=reviewedSource(saved);if(!source.ready)fail(source.errors.join('；'),422)
 const kept=new Set(source.rows.filter(r=>!r.excluded).map(r=>r.id))
 const analysis={...saved.analysis,analysis:{...saved.analysis.analysis,observations:saved.analysis.analysis.observations.filter(o=>kept.has(o.id)),relations:(saved.analysis.analysis.relations||[]).filter(r=>kept.has(r.from)&&kept.has(r.to))}}
 const inventory=new Map()
 for(const m of mapping.mapping.rows){if(!m.target||m.errors.length)fail('正式 Mapping 不可用：'+m.source.part_num,422);const key=m.target.part+':'+m.target.color;const row=inventory.get(key)||{part:m.target.part,color:m.target.color,quantity:0};row.quantity+=m.source.quantity;inventory.set(key,row)}
 // Adapt the saved Review + official Mapping snapshot to the existing audited input builder.
 // This is not a legacy schema fallback and does not use any prior LLM placement.
 const snapshot={id:mapping.id,reference:{analysisId:analysis.id,review:Object.fromEntries(source.rows.filter(r=>!r.excluded).map(r=>[r.id,r]))},inventorySource:{reviewId:mapping.id,mapping:mapping.mapping.rows},requestInput:{inventory:[...inventory.values()]}}
 const prepared=prepareInput(analysis,snapshot,rules,{includeEvidence})
 prepared.input.provenance={analysisId:analysis.id,reviewId:mapping.id,reviewVersion:source.reviewVersion,savedReviewAt:source.updatedAt,excludedIds:source.rows.filter(r=>r.excluded).map(r=>r.id),mappingSource:'saved Part Explorer review + official inventory mapping review'}
 return prepared
}
function planView(r){
 let validation={valid:false,issues:['没有可解析的计划']}
 try{if(r.plan)validation=validatePlan(r.plan,r.requestInput)}catch{validation={valid:false,issues:['记录结构无效']}}
 let matchesRaw=false
 try{matchesRaw=hash(JSON.parse(r.rawOutput))===hash(r.plan)}catch{}
 const usable=matchesRaw&&r.status==='plan_ready_for_review'&&r.parseStatus==='parsed'&&r.validation?.valid===true&&validation.valid&&(r.finishReason==='completed'||r.finishReason==='STOP')&&r.wireStatus==='response_saved'
 return {id:r.id,analysisId:r.requestInput?.provenance?.analysisId,createdAt:r.createdAt,model:r.model,status:r.status,usable,validation,
  plan:r.plan,rawOutput:r.rawOutput,image:r.image,requestInput:r.requestInput,conversion:r.conversion,error:r.error,usage:r.usageMetadata,tracePath:r.tracePath,rawRequestPath:r.rawRequestPath,rawResponsePath:r.rawResponsePath}
}
export function geometryView(r){return {id:r.id,planId:r.planId,createdAt:r.createdAt,state:r.state,status:r.status,error:r.error,completeSearch:r.completeSearch,
 diagnostics:r.diagnostics||[],rejectionSummary:r.rejectionSummary||[],groups:r.groups||[],
 candidates:r.state==='complete'&&['candidates_found','candidates_with_unverified_constraints'].includes(r.status)?(r.candidates||[]).filter(c=>c.geometry?.valid).map(c=>({id:c.id,layoutId:c.layoutId,bricks:c.assembly.bricks,unverifiedCount:c.unverifiedConstraints.length})):[]}}
export function createSpatialWorkflow(directory,{reverse,games,loadRules=loadBrickRules,runPlanning=runSpatialPlanning,execute=executePlan}={}){
 const plans=path.join(directory,'brick-spatial-traces'),geometries=path.join(directory,'brick-spatial-geometry'),requests=path.join(directory,'brick-spatial-requests')
 const getPlan=async value=>{const r=await read(path.join(plans,id(value)+'.json'));if(r.id!==value||r.task!=='spatial-planning')fail('不是 Spatial Plan 记录',422);return r}
 const getGeometry=async value=>{const r=await read(path.join(geometries,id(value)+'.json'));if(r.id!==value||r.version!=='geometry-execution-v1')fail('不是 Geometry Execution 记录',422);return r}
 async function operation(body,kind,work){
  const requestId=id(body.requestId),file=path.join(requests,requestId+'.json'),fingerprint=hash({kind,...body})
  const pending={id:requestId,kind,fingerprint,state:'running',createdAt:new Date().toISOString(),analysisId:body.analysisId??null,planId:body.planId??null}
  try{await write(file,pending,true)}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(file);if(old.fingerprint!==fingerprint)fail('请求 ID 已用于不同输入',409);return old}
  try{const result=await work();const done={...pending,state:'complete',...result};await write(file,done);return done}
  catch(e){const failed={...pending,state:'failed',error:e.statusCode?e.message:'执行失败；记录已保留，未自动重试。'};await write(file,failed);return failed}
 }
 return {async dispatch(method,route,body={},query=new URLSearchParams()){
  if(method==='GET'&&route==='status')return {models:modelOptions('design'),providers:providerStatus()}
  if(method==='GET'&&route==='requests'){const items=[];for(const f of await records(requests)){try{const r=await read(path.join(requests,f));if(!query.get('analysisId')||r.analysisId===query.get('analysisId')||r.planId===query.get('planId'))items.push(r)}catch{}}return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}}
  if(method==='GET'&&route.startsWith('source/'))return reviewedSource(await reverse.restore(id(route.slice(7))))
  if(method==='GET'&&route==='plans'){
   const items=[],warnings=[];for(const f of await records(plans)){try{const r=planView(await getPlan(f.slice(0,-5)));if(!query.get('analysisId')||r.analysisId===query.get('analysisId')){const {id,analysisId,createdAt,model,status,usable}=r;items.push({id,analysisId,createdAt,model,status,usable})}}catch{warnings.push('无法读取 '+f)}}return {items:items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),warnings}
  }
  if(method==='GET'&&/^plans\//.test(route)){const [,value,raw]=route.split('/');const r=await getPlan(value);if(raw==='trace'){const wire=async suffix=>readFile(path.join(plans,r.id+suffix),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e});return {...r,rawRequest:await wire('.request.json'),rawResponse:await wire('.response.txt')}}return planView(r)}
  if(method==='GET'&&route==='geometry'){
   const items=[];for(const f of await records(geometries)){try{const r=await getGeometry(f.slice(0,-5));if(!query.get('planId')||r.planId===query.get('planId'))items.push({id:r.id,planId:r.planId,createdAt:r.createdAt,state:r.state,status:r.status,count:geometryView(r).candidates.length})}catch{}}return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
  }
  if(method==='GET'&&route.startsWith('geometry/')){
   const [,value,action,candidateId]=route.split('/'),r=await getGeometry(value)
   if(action==='report')return r
   if(action==='candidates'){
    if(r.state!=='complete'||!['candidates_found','candidates_with_unverified_constraints'].includes(r.status))fail('此结果未完成或没有可用候选',422)
    const c=r.candidates.find(c=>c.id===candidateId);if(!c)fail('候选不存在',404)
    const geometry=(await loadRules()).validateAssembly(c.assembly.bricks)
    if(!geometry.valid||!c.geometry.valid)fail('候选未通过当前几何复核：'+geometry.reason,422)
    return {...c,currentGeometry:geometry}
   }
   return geometryView(r)
  }
  if(method==='POST'&&route==='plan'){
   id(body.analysisId);if(typeof body.model!=='string'||typeof body.includeEvidence!=='boolean'||typeof body.reviewVersion!=='string')fail('规划输入无效')
   return operation(body,'planning',async()=>{
    const saved=await reverse.restore(body.analysisId),source=reviewedSource(saved)
    if(!source.ready)fail(source.errors.join('；'),422)
    if(source.reviewVersion!==body.reviewVersion)fail('审核已变化，请重新加载',409)
    const items=new Map();for(const r of source.rows.filter(r=>!r.excluded)){const p=r.confirmedPart,k=p.part_num+':'+p.color_id;const item=items.get(k)||{part_num:p.part_num,color_id:p.color_id,quantity:0};item.quantity++;items.set(k,item)}
    const mapping=await games.review({session:{schema_version:1,id:randomUUID(),name:'Spatial Review '+saved.analysis.id,updated_at:new Date().toISOString(),items:[...items.values()]}})
    const prepared=prepareReviewedSource(saved,mapping,await loadRules(),body.includeEvidence)
    const r=await runPlanning(prepared,{model:body.model,directory:plans,execute:true,sources:[{analysisId:body.analysisId,reviewVersion:source.reviewVersion,mappingReviewId:mapping.id}]})
    return {planId:r.id,resultStatus:r.status}
   })
  }
  if(method==='POST'&&route==='execute'){
   id(body.planId)
   return operation(body,'geometry',async()=>{
    const plan=await getPlan(body.planId);if(!planView(plan).usable)fail('Spatial Plan 未完成或无效，禁止执行',422)
    const geometryId=randomUUID(),file=path.join(geometries,geometryId+'.json'),base={version:'geometry-execution-v1',id:geometryId,planId:plan.id,createdAt:new Date().toISOString(),state:'running',sourcePlanHash:hash(plan.plan)}
    await write(file,base,true)
    try{const result=execute(plan.plan,plan.requestInput,await loadRules());await write(file,{...base,...result,state:'complete',sourcePlan:plan.plan,input:plan.requestInput});return {geometryId,resultStatus:result.status}}
    catch(e){await write(file,{...base,state:'failed',status:'execution_failed',error:String(e.message)});return {geometryId,resultStatus:'execution_failed'}}
   })
  }
  fail('未知 Spatial Assembly 操作',404)
 }}
}
