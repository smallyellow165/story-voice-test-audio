import {readFile,readdir,mkdir,writeFile,link,unlink} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import path from 'node:path'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {sourceImages} from '../src/magnetic-tiles/intake/image-set.ts'
import {registrationEvidence} from '../src/magnetic-tiles/three-d/scene-registration/evidence.ts'
import {fitSceneRegistration} from '../src/magnetic-tiles/three-d/scene-registration/fit.ts'
import {registrationInspectionView} from '../src/magnetic-tiles/three-d/scene-registration/inspection-camera.ts'
import {combineAssemblySnapshots,transformModule} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode})}
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex')
const same=(a,b)=>canonical(a)===canonical(b)
const ref=r=>({id:r.assembly.id,version:r.version,hash:r.hash,snapshotHash:r.snapshotHash,revision:r.snapshot.assembly.revision})
/** Explicit UI runs persist an immutable result. Reads and previews never touch
 * Selected pointers, parent Drafts, or any Analysis/Review/Execution record. */
export function createSceneRegistration(directory,{readAssembly,selectedOrigin,lineage,readSource,readImages}){
 async function context(body){
  if(!Array.isArray(body.parents)||body.parents.length<2||body.parents.length>8||new Set(body.parents.map(p=>p.id)).size!==body.parents.length)fail('请选择 2–8 个不同的保存作品',422)
  const members=[],records=[];let bound=null,analysis=null,review=null,source=null
  for(const p of body.parents){
   if(!Number.isSafeInteger(p.version)||p.version<1)fail('Assembly Parent 固定版本无效')
   const r=await readAssembly(p.id,p.version);if(!r||r.hash!==p.hash)fail('Assembly Parent 版本 / Hash 不一致')
   if(r.type!=='group'||r.snapshot.photoOrigin.origin.kind==='editor-created')fail('V1 需要具有准确照片来源的刚性 Group；当前成员不支持',422)
   const o=await selectedOrigin(r.snapshot.photoOrigin.origin.id)
   if(!same(o,r.snapshot.photoOrigin.origin))fail('保存 Assembly 的 Origin 与来源不一致')
   if(r.assembly.id!==r.snapshot.assembly.id||r.parent.kind!=='geometry-origin'||r.parent.id!==o.id||r.parent.hash!==o.hash||r.project.id!==o.sourceId||r.project.hash!==o.sourceHash||r.snapshot.photoOrigin.assemblyRaw!==serializeAssembly3D(o.assembly))fail('Assembly Parent / Source / Origin 快照关联不一致')
   const l=await lineage('executions',o.executionId),pin={projectId:o.projectId,source:{id:o.sourceId,hash:o.sourceHash},analysis:{id:o.analysisId,hash:o.analysisHash},review:{id:o.reviewId,hash:o.reviewHash}}
   if(!pin.projectId)fail('配准缺少明确的 Workspace Project 身份')
   if(body.projectId!==undefined&&body.projectId!==pin.projectId)fail('配准请求跨 Workspace Project')
   if(bound&&!same(bound,pin))fail('不能混用不同 Project / Source / Analysis / Review 的 Assembly')
   if(!validateAssembly3D(r.snapshot.assembly).valid)fail('输入 Assembly 未通过 Geometry Validator',422)
   bound=pin;analysis=l.analysis;review=l.review;source=l.source;records.push(r)
   const plan=(await lineage('plans',o.planId)).record
   members.push({ref:ref(r),name:r.name,assembly:r.snapshot.assembly,origin:{id:o.id,hash:o.hash},plan:{id:plan.id,hash:plan.hash},execution:{id:l.record.id,hash:l.record.hash}})
  }
  if(members.reduce((s,m)=>s+m.assembly.pieces.length,0)>64)fail('Combined V1 最多 64 Tiles',422)
  return {bound,members,records,analysis,review,source}
 }
 const imageRef=i=>({id:i.sourceId,hash:i.sourceHash,viewHash:i.view.hash,name:i.name,width:i.view.width,height:i.view.height})
 async function input(body){
  const c=await context(body),images=sourceImages(c.source),image=images.find(i=>i.sourceId===body.image?.id)
  if(!image||!same(imageRef(image),body.image))fail('参考图片身份 / Hash / 像素版本不一致')
  const picture=await readSource(image.sourceId)
  if(picture.hash!==image.sourceHash||picture.view.hash!==image.view.hash)fail('参考图片底层 Source / View 不一致')
  await readImages(c.source) // Verifies saved image bytes, never recreates them.
  const used=new Set(),points=[],boxes=[],links=new Map()
  for(let i=0;i<c.members.length;i++){
   const o=c.records[i].snapshot.photoOrigin.origin,map=o.observationMap
   if(!Array.isArray(map)||!map.length)fail('Assembly 缺少准确 Observation → Tile 对应',422)
   const pieceIds=new Set()
   for(const m of map){
    if(used.has(m.observationId))fail('V1 不支持跨成员共享 Observation；需要明确的共享约束',422)
    if(pieceIds.has(m.pieceId))fail('Observation → Tile 映射重复')
    used.add(m.observationId);pieceIds.add(m.pieceId)
    links.set(m.observationId,{memberId:c.members[i].ref.id,pieceId:m.pieceId})
    const p=c.review.input.review.pieces.find(p=>p.id===m.observationId),tile=c.members[i].assembly.pieces.find(p=>p.id===m.pieceId)
    if(!p?.confirmed||p.excluded||!tile||tile.profileId!==p.profileId||tile.profileVersion!==p.profileVersion)fail('Observation / Tile / Review Profile 对应不一致')
   }
   const plan=(await lineage('plans',o.planId)).record
   const extracted=registrationEvidence(c.members[i],body.image,c.analysis.evidence,plan.plan,map);points.push(...extracted.points);boxes.push(...extracted.boxes)
  }
  // Preserve reviewed cross-member facts at the independent registration
  // boundary. The V1 solver rejects these explicitly rather than ignoring them.
  const constraints=[],review=c.review.input.review
  for(const h of review.constraints){const a=links.get(h.pieceA),b=links.get(h.pieceB);if(h.intent==='connect'&&a&&b&&a.memberId!==b.memberId)constraints.push({kind:'connection',members:[a.memberId,b.memberId],hypothesis:{...h,pieceA:a.pieceId,pieceB:b.pieceId}})}
  for(const check of review.spatialChecks??[]){const a=links.get(check.pieceA),b=links.get(check.pieceB);if(a&&b&&a.memberId!==b.memberId)constraints.push({kind:'reviewed-spatial-check',members:[a.memberId,b.memberId],check:{...check,pieceA:a.pieceId,pieceB:b.pieceId}})}
  return {version:1,...c.bound,image:body.image,members:c.members,points,boxes,constraints}
 }
 async function read(id){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail('配准结果 ID 无效')
  const r=JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8')),{hash:h,...payload}=r;if(hash(payload)!==h||r.id!==id)fail('配准记录 Hash 不一致');if(r.input?.version!==1||r.solution?.solver!=='upright-common-ground-v1')fail('配准结果版本不支持；未转换旧结果');return r
 }
 function apply(assembly,solution,members){
  let result=assembly
  if(solution.transforms.length!==members.length)fail('配准成员数量不一致')
  for(const m of members){const module=result.modules.find(g=>same(g.parent,m.ref)),pose=solution.transforms.find(t=>t.memberId===m.ref.id);if(!module||!pose)fail('配准 Parent 对应不一致');result=transformModule(result,module.id,pose.delta)}
  if(!validateAssembly3D(result).valid)fail('配准场景产生碰撞或非法几何，未采用',422)
  return result
 }
 async function adopt(reference,parents,assembly){
  const r=await read(reference?.id);if(r.hash!==reference.hash)fail('配准结果 Hash 不一致')
  const current=await input({parents:parents.map(p=>ref(p)),projectId:r.input.projectId,image:r.input.image})
  if(!same(current,r.input))fail('配准输入已过期，未采用；请重新运行')
  const result=apply(assembly,r.solution,current.members)
  return {assembly:result,reference:{id:r.id,hash:r.hash},cameraView:registrationInspectionView(result,r.solution.camera)}
 }
 return {adopt,async dispatch(method,route,body={}){
  if(method==='GET'&&route.startsWith('records/'))return read(route.slice(8))
  if(method!=='POST')fail('未知 Scene Registration 操作',404)
  if(route==='options'){
   const c=await context(body),images=sourceImages(c.source).filter(image=>c.records.every(r=>r.snapshot.photoOrigin.origin.observationMap.some(m=>c.analysis.evidence.observations.find(o=>o.id===m.observationId)?.imageEvidence?.some(e=>e.imageId===image.sourceId&&(e.bbox||e.features.length)))))
   const results=[]
   for(const file of await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e})){if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;const r=await read(file.slice(0,-5));if(same(r.input.members.map(m=>m.ref),c.members.map(m=>m.ref))&&r.input.projectId===c.bound.projectId&&same(r.input.review,c.bound.review))results.push({id:r.id,hash:r.hash,createdAt:r.computedAt,imageId:r.input.image.id,rmse:r.solution.quality.pointRmsePx})}
   return {...c.bound,images:images.map(imageRef),results:results.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
  }
  if(route==='image'){const c=await context(body);if(!sourceImages(c.source).some(i=>same(imageRef(i),body.image)))fail('图片来源不一致');const views=await readImages(await readSource(c.bound.source.id)),v=views.find(i=>i.sourceId===body.image.id);return {mimeType:v.mimeType,imageBase64:v.imageBase64}}
  if(route!=='run')fail('未知 Scene Registration 操作',404)
  const pinned=await input(body),solution=fitSceneRegistration(pinned),preview=apply(combineAssemblySnapshots('registration-preview',pinned.members.map(m=>({name:m.name,parent:m.ref,assembly:m.assembly}))),solution,pinned.members)
  if(!same(await input(body),pinned))fail('配准期间输入已变化；未保存结果')
  // Separate receipt from Visible3D history: generic workflow ownership only
  // ingests createdAt records. Registration never becomes a Selected result.
  const payload={id:randomUUID(),computedAt:new Date().toISOString(),input:pinned,solution,preview,geometryValid:true},r={...payload,hash:hash(payload)}
  await mkdir(directory,{recursive:true});const target=path.join(directory,r.id+'.json'),temp=target+'.tmp'
  try{await writeFile(temp,JSON.stringify(r),{flag:'wx',mode:0o600});await link(temp,target)}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return r
 }}
}
