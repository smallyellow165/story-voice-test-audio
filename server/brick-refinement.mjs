import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {prepareGeometryInput} from './brick-geometry-input.mjs'
import {refineGeometry,planAtPoses} from '../experiments/geometry-refinement/refine.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const verifyProposal=p=>{if(!p)fail('Refinement 建议不存在');const {hash:expected,...content}=p;if(hash(content)!==expected)fail('Refinement 建议内容已变化，哈希校验失败')}
const validId=id=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id||''))fail('无效 Refinement / Revision ID');return id}
const read=async file=>JSON.parse(await readFile(file,'utf8'))
async function save(dir,r){await mkdir(dir,{recursive:true});await writeFile(path.join(dir,r.id+'.json'),JSON.stringify(r),{flag:'wx',mode:0o600})}
async function list(dir){const files=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e});const result=[];for(const f of files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)))result.push(await read(path.join(dir,f)));return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}

export function createRefinementStore(directory,{getPlan,getGeometry,loadRules}){
 const refinements=path.join(directory,'brick-refinements'),revisions=path.join(directory,'brick-spatial-revisions'),geometries=path.join(directory,'brick-spatial-geometry')
 const get=async id=>{const r=await read(path.join(refinements,validId(id)+'.json'));if(r.version!=='geometry-refinement-v1')fail('不是 Refinement V1');return r}
 const revision=async id=>{const r=await read(path.join(revisions,validId(id)+'.json'));if(r.version!=='spatial-revision-v1'||r.approval?.confirmed!==true)fail('修正版未明确批准');return r}
 async function checkSource(r){
  const source=await getPlan(r.planId),geometry=await getGeometry(r.geometryId)
  if(hash(source.plan)!==r.sourcePlanHash||hash(source.requestInput)!==r.sourceInputHash||hash(geometry)!==r.sourceGeometryHash)fail('原始计划、输入或 Geometry Result 已变化；禁止沿用审核结果')
  return source
 }
 async function currentInput(source){const rules=await loadRules(),prepared=await prepareGeometryInput(source.requestInput,rules);if(prepared.issues.length)fail(prepared.issues.join('；'));return {rules,...prepared}}
 return {
  get,revision,
  async list(geometryId){validId(geometryId);return {items:(await list(refinements)).filter(r=>r.geometryId===geometryId).map(r=>({id:r.id,status:r.status,createdAt:r.createdAt,count:r.proposals.length}))}},
  async revisions(refinementId){validId(refinementId);return {items:(await list(revisions)).filter(r=>r.refinementId===refinementId)}},
  async run(body){
   const source=await getPlan(validId(body.planId)),geometry=await getGeometry(validId(body.geometryId))
   if(geometry.planId!==source.id||geometry.revisionId||geometry.state!=='complete'||geometry.sourcePlanHash!==hash(source.plan))fail('仅支持与原始计划匹配、已完成的原始 Geometry Result')
   const {rules,input,enrichments}=await currentInput(source)
   const result=refineGeometry(source.plan,input,rules,{radiusLdu:body.radiusLdu??20})
   const r={...result,id:randomUUID(),createdAt:new Date().toISOString(),planId:source.id,geometryId:geometry.id,sourcePlanHash:hash(source.plan),sourceInputHash:hash(source.requestInput),sourceGeometryHash:hash(geometry),input,enrichments,sourcePlan:source.plan}
   for(const p of r.proposals)p.hash=hash(p)
   await save(refinements,r);return {refinementId:r.id,resultStatus:r.status}
  },
  async approve(body){
   const r=await get(body.refinementId),source=await checkSource(r),p=r.proposals.find(p=>p.id===body.proposalId)
   if(!p||body.proposalHash!==p.hash)fail('候选或内容哈希不匹配，请重新加载')
   verifyProposal(p)
   if(body.confirmed!==true||typeof body.reviewNote!=='string'||!body.reviewNote.trim()||body.reviewNote.length>2000)fail('需要用户明确确认并填写照片审核说明')
   if(!p.geometry.valid&&body.acknowledgeInvalid!==true)fail('候选仍是 Geometry Invalid，需明确确认剩余问题；批准不能代替几何校验')
   const {rules,input}=await currentInput(source)
   if(hash(input)!==hash(r.input))fail('几何输入已变化，请重新 Refinement')
   const refinedPlan=planAtPoses(source.plan,p.poses)
   if(hash(refinedPlan)!==hash(p.refinedPlan))fail('候选修订内容不一致')
   const strict=executePlan(refinedPlan,input,rules)
   if(p.geometry.valid&&!strict.candidates.length)fail('候选不再通过严格校验，不能使用旧的有效标记')
   const record={version:'spatial-revision-v1',id:randomUUID(),createdAt:new Date().toISOString(),refinementId:r.id,proposalId:p.id,proposalHash:p.hash,planId:r.planId,geometryId:r.geometryId,sourcePlanHash:r.sourcePlanHash,sourceInputHash:r.sourceInputHash,sourceGeometryHash:r.sourceGeometryHash,
    refinedPlan,input,diffs:p.diffs,classification:p.classification,reviewReasons:p.reviewReasons,approval:{confirmed:true,reviewNote:body.reviewNote.trim(),acknowledgeInvalid:body.acknowledgeInvalid===true},preflightStatus:strict.status}
   await save(revisions,record);return {revisionId:record.id,resultStatus:'approved_revision_saved',geometryValid:strict.candidates.length>0}
  },
  async execute(body){
   const rev=await revision(body.revisionId),r=await get(rev.refinementId),source=await checkSource(rev),p=r.proposals.find(p=>p.id===rev.proposalId)
   if(!p||p.hash!==rev.proposalHash||hash(p.refinedPlan)!==hash(rev.refinedPlan))fail('修订记录与已批准候选不一致')
   verifyProposal(p)
   const {rules,input}=await currentInput(source)
   if(hash(input)!==hash(rev.input))fail('Geometry Profile 已变化，需重新审核')
   const result=executePlan(rev.refinedPlan,input,rules)
   const record={...result,id:randomUUID(),createdAt:new Date().toISOString(),state:'complete',planId:rev.planId,revisionId:rev.id,refinementId:r.id,sourcePlan:rev.refinedPlan,sourcePlanHash:hash(rev.refinedPlan),originalPlanHash:rev.sourcePlanHash,input}
   // Preserve an inspectable failed layout, never expose it as a legal candidate.
   if(!result.candidates.length)record.diagnosticAssembly={...p.assembly,geometry:rules.validateAssembly(p.assembly.bricks),note:'Approved layout revision; strict Geometry remains invalid. Not a successful Assembly.'}
   await save(geometries,record);return {geometryId:record.id,resultStatus:record.status,revisionId:rev.id}
  },
  async viewer(refinementId){
   const r=await get(refinementId),source=await checkSource(r)
   const entries=[...(r.originalAssembly?[{id:'original',layoutId:'原始布局',bricks:r.originalAssembly.bricks,file:'/api/brick-spatial/refinements/'+r.id}]:[]),...r.proposals.map(p=>({id:p.id,layoutId:p.classification==='within_evidence'?'Within Evidence':'Requires Review',bricks:p.assembly.bricks,file:'/api/brick-spatial/refinements/'+r.id+'/proposals/'+p.id}))]
   return {purpose:'refinement-review',status:r.status,completeSearch:r.completeSearch,diagnostics:r.diagnostics,groups:[],candidates:entries,image:source.image,sourcePlan:source.plan}
  },
 }
}
