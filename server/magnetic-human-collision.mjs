import {assertModuleOrigin} from '../src/magnetic-tiles/three-d/module-transform.ts'
// Local operator authorization. Uses the same append-only/exclusive-link CAS
// publication convention as the existing Profile Registry; no Assembly schema fork.
import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {assertLocalTraceRequest} from './magnetic-trace-files.mjs'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {assertCanonicalProfiles} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {profiles as builtinProfiles} from '../src/magnetic-tiles/profiles.ts'
import {assertAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {collisionReviewPolicy,grantMatches,referenceFor} from '../src/magnetic-tiles/three-d/human-collision-policy.ts'
import {acceptedDiagnosticErrors,diagnosticAcceptanceEligibility} from '../src/magnetic-tiles/three-d/diagnostic-acceptance.ts'
import {generateBuildOrder3D} from '../src/magnetic-tiles/three-d/build-order.ts'
import {assertTutorial3D,validateTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
const fail=(m,statusCode=422)=>{throw Object.assign(Error(m),{statusCode})},hash=v=>createHash('sha256').update(canonical(v)).digest('hex')
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id)
export function createHumanCollisionReview(directory,{enabled=false,readOrigin,readSavedAssembly,readSavedVersion,getProfiles=async()=>builtinProfiles}={}){
 const sessions=new Map()
 function authorize(context,session=true){
  try{assertLocalTraceRequest(context?.request,typeof enabled==='function'?enabled():enabled)}catch{fail('人工碰撞审核仅允许本机开发环境的直接同源请求。',403)}
  if(!session)return
  const token=(context.request.headers.authorization??'').replace(/^Bearer /,'');if(!sessions.has(token)||sessions.get(token)<Date.now())fail('缺少或已失效的本机审核会话授权。',401)
 }
 async function readRecord(file){const r=JSON.parse(await readFile(file,'utf8')), {hash:stored,...payload}=r;if(stored!==hash(payload))fail('人工审核记录 Hash 损坏。',409);return r}
 async function publish(file,value){await mkdir(path.dirname(file),{recursive:true});const r={...value,hash:hash(value)},tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(r),{flag:'wx',mode:0o600});try{await link(tmp,file)}catch(e){if(e.code==='EEXIST')fail('审核已被其他页面更新；旧版本操作未提交。',409);throw e}}finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e})}return r}
 async function head(id){
  const dir=path.join(directory,'heads',id),names=(await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(n=>/^\d{12}\.json$/.test(n)).sort();let current=null
  for(const n of names){const r=await readRecord(path.join(dir,n));if(r.version!==(current?.version??0)+1||r.previousHash!==(current?.hash??null)||r.assembly.id!==id||n!==String(r.version).padStart(12,'0')+'.json')fail('人工审核版本链损坏。',409);current=r}
  return current
 }
 async function commit(previous,changes){const r={...changes,version:(previous?.version??0)+1,previousHash:previous?.hash??null,updatedAt:new Date().toISOString()};return publish(path.join(directory,'heads',r.assembly.id,String(r.version).padStart(12,'0')+'.json'),r)}
 function checked(assembly){assertAssembly3D(assembly);if(!assembly.pieces.length||assembly.pieces.length>64||assembly.connections.length>512||Buffer.byteLength(JSON.stringify(assembly))>2_000_000)fail('人工审核 V1 仅支持 1–64 片、最多 512 条连接及 2 MB 快照。');const geometry=validateAssembly3D(assembly),policy=collisionReviewPolicy(assembly,geometry);return {assembly,geometry,policy,assemblyHash:hash(assembly),assemblyCanonical:canonical(assembly),diagnosticHash:hash(geometry)}}
 function same(h,c){return h&&h.assemblyHash===c.assemblyHash&&h.assemblyCanonical===c.assemblyCanonical}
 function cas(h,version){if(version!==(h?.version??null))fail('审核版本已过期或发生并发修改；请重新读取审核。',409)}
 async function publishGrant(assembly,c,origin,acceptedDiagnostic){
  const id=randomUUID()
  return publish(path.join(directory,'approvals',id+'.json'),{id,assemblyId:assembly.id,revision:assembly.revision,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,collisionKeys:c.policy.keys,geometry:c.geometry,approvedAt:new Date().toISOString(),actor:'local-operator',...(origin?{origin}:{}),...(acceptedDiagnostic?{acceptedDiagnostic}:{})})
 }
 function acceptance(c,evidence){return evidence?acceptedDiagnosticErrors(c.assembly,c.geometry,evidence):null}
 async function grant(h,c){
  if(!h?.approvalId||!same(h,c)||h.diagnosticHash!==c.diagnosticHash)return null
  const g=await readRecord(path.join(directory,'approvals',h.approvalId+'.json'))
  if(!grantMatches(h.assembly,g)||g.assemblyHash!==c.assemblyHash||g.diagnosticHash!==c.diagnosticHash)return null
  if(h.acceptedDiagnostic){
   if(canonical(g.acceptedDiagnostic)!==canonical(h.acceptedDiagnostic)||!acceptance(c,h.acceptedDiagnostic)?.complete)return null
  }else if(!c.policy.eligible||canonical(g.collisionKeys)!==canonical(c.policy.keys)||canonical(h.acceptedKeys)!==canonical(c.policy.keys))return null
  return g
 }
 async function response(h,c){
  const matches=!h||same(h,c),review=matches&&h?.acceptedDiagnostic?acceptance(c,h.acceptedDiagnostic):null
  return {matches,version:h?.version??null,assemblyHash:c.assemblyHash,diagnosticHash:c.diagnosticHash,assemblyCanonical:c.assemblyCanonical,acceptedKeys:same(h,c)&&h.diagnosticHash===c.diagnosticHash?h.acceptedKeys:[],eligible:c.policy.eligible,collisionKeys:c.policy.keys,geometry:c.geometry,blockers:review?.blockers??c.policy.blockers,grant:await grant(h,c),...(h?.acceptedDiagnostic?{humanAcceptedDiagnostic:true,acceptedErrors:review?.accepted??[]}:{})}
 }
 async function initializeCombined(assembly,origin){
  if(!(typeof enabled==='function'?enabled():enabled))return null
  const current=await head(assembly.id);if(current)fail('Combined 已存在审核状态',409)
  const c=checked(assembly),oldIssues=[];let offset=0
  for(const module of assembly.modules??[]){
   const saved=await readSavedVersion(module.parent.id,module.parent.version)
   if(!saved||saved.hash!==module.parent.hash)fail('Combined Parent 审核快照失配',409)
   const baseline=saved.snapshot.assembly,report=checked(baseline),latest=await head(baseline.id)
   let prior=latest&&same(latest,report)&&latest.diagnosticHash===report.diagnosticHash?latest:null
   if(!prior&&saved.reviewRef){prior=await readRecord(path.join(directory,'heads',baseline.id,String(saved.reviewRef.version).padStart(12,'0')+'.json'));if(prior.hash!==saved.reviewRef.hash||!same(prior,report)||prior.diagnosticHash!==report.diagnosticHash)fail('Parent 审核引用失配',409);for(let v=prior.version+1;v<=(latest?.version??0);v++){const h=await readRecord(path.join(directory,'heads',baseline.id,String(v).padStart(12,'0')+'.json'));if(same(h,report)&&h.diagnosticHash===report.diagnosticHash)prior=h}}
   let accepted=[]
   if(prior?.acceptedDiagnostic)accepted=acceptance(report,prior.acceptedDiagnostic)?.accepted??[]
   else if(await grant(prior,report))accepted=report.geometry.issues.filter(i=>i.severity==='error')
   const map=new Map(module.pieces.map(p=>[p.sourceId,p.id]))
   for(const issue of accepted)oldIssues.push({...issue,...(issue.pieceId?{pieceId:map.get(issue.pieceId)}:{}),...(issue.relatedPieceIds?{relatedPieceIds:issue.relatedPieceIds.map(id=>map.get(id))}:{}),...(issue.connectionIndex!==undefined?{connectionIndex:issue.connectionIndex+offset}:{})})
   offset+=baseline.connections.length
  }
  const evidence={version:1,origin:{id:origin.id,hash:origin.hash},parents:origin.parents,assembly,geometry:{...c.geometry,issues:oldIssues}}
  const review=acceptance(c,evidence),g=review?.complete&&!c.geometry.valid?await publishGrant(assembly,c,evidence.origin,evidence):null
  return commit(null,{assembly,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys:(review?.accepted??[]).filter(i=>i.code==='intersection').map(i=>canonical(i)).sort(),approvalId:g?.id??null,origin:evidence.origin,acceptedDiagnostic:evidence,savedTutorials:[]})
 }
 return {initializeCombined,async capture(assembly){const h=await head(assembly.id),c=checked(assembly);return same(h,c)&&h.diagnosticHash===c.diagnosticHash?{version:h.version,hash:h.hash}:null},async dispatch(method,route,body={},context){
  authorize(context,route!=='session');if(method!=='POST')fail('Use POST',405)
  if(route==='session'){for(const [k,v]of sessions)if(v<Date.now())sessions.delete(k);if(sessions.size>1024)fail('本机会话过多。',429);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+8*3600000);return {token,scope:'local-human-collision-review'}}
  const allowed={status:['assembly'],'restore-saved':['assembly','expectedVersion','savedHash'],'accept-diagnostic':['assembly','expectedVersion','originId'],sync:['assembly','expectedVersion','originId'],accept:['assembly','expectedVersion','acceptedKeys'],approve:['assembly','expectedVersion','acceptedKeys'],revalidate:['assembly','expectedVersion'],generate:['assembly','expectedVersion','approvalId','options'],saveTutorial:['assembly','expectedVersion','approvalId','tutorial']}
  if(!allowed[route]||!body||Object.keys(body).some(k=>!allowed[route].includes(k)))fail('人工审核请求字段或操作无效。',400)
  const assembly=body.assembly;assertCanonicalProfiles(assembly?.profiles??[],await getProfiles());const c=checked(assembly),h=await head(assembly.id)
  if(h?.origin&&readOrigin){const origin=await readOrigin(h.origin.id,{requireSelected:true});if(origin.hash!==h.origin.hash)fail('Assembly 来源 Hash 已变化，不能继续授权',409);try{assertModuleOrigin(assembly,origin)}catch(e){fail(e.message,409)}}
  if(route==='status')return response(h,c)
  if(route==='restore-saved'){
   cas(h,body.expectedVersion)
   const saved=readSavedAssembly&&await readSavedAssembly(assembly.id)
   if(!saved||saved.hash!==body.savedHash||canonical(saved.snapshot.assembly)!==c.assemblyCanonical||!saved.reviewRef)fail('保存作品或审核引用不一致，未恢复授权。',409)
   if(readOrigin){const origin=await readOrigin(saved.snapshot.photoOrigin.origin.id,{requireSelected:true});if(origin.hash!==saved.snapshot.photoOrigin.origin.hash)fail('保存作品来源已变化。',409)}
   let prior=await readRecord(path.join(directory,'heads',assembly.id,String(saved.reviewRef.version).padStart(12,'0')+'.json'))
   if(prior.hash!==saved.reviewRef.hash||!same(prior,c)||prior.diagnosticHash!==c.diagnosticHash||canonical(prior.origin??null)!==canonical({id:saved.snapshot.photoOrigin.origin.id,hash:saved.snapshot.photoOrigin.origin.hash}))fail('保存的审核与当前几何快照不一致。',409)
   // Later explicit accepts/revocations of THIS exact snapshot take precedence.
   // A saved receipt must never resurrect an authorization the user revoked.
   for(let version=prior.version+1;version<=(h?.version??0);version++){const r=await readRecord(path.join(directory,'heads',assembly.id,String(version).padStart(12,'0')+'.json'));if(same(r,c)&&r.diagnosticHash===c.diagnosticHash)prior=r}
   if(h&&same(h,c)&&h.diagnosticHash===c.diagnosticHash&&canonical(h.acceptedKeys)===canonical(prior.acceptedKeys)&&h.approvalId===prior.approvalId)return response(h,c)
   const {version,hash:_,previousHash,updatedAt,...rest}=prior
   return response(await commit(h,rest),c)
  }
  if(route==='accept-diagnostic'){
   if(!safeId(body.originId)||!readOrigin)fail('人工采用缺少可校验的 Diagnostic 来源。')
   const origin=await readOrigin(body.originId,{acceptingDiagnostic:true})
   if(origin.entryMode!=='human-accepted-diagnostic'||origin.authorization?.explicit!==true||origin.authorization?.scope!=='accepted-diagnostic-errors'||canonical(origin.assembly)!==c.assemblyCanonical||!origin.executionId||!origin.executionHash||!origin.diagnostic?.hash)fail('Human Accepted Diagnostic 来源或几何快照不一致。',409)
   if(h&&same(h,c)&&h.origin?.id===origin.id&&h.acceptedDiagnostic&&await grant(h,c))return response(h,c)
   cas(h,body.expectedVersion)
   if(h)fail('Diagnostic 已有其他审核状态，不能覆盖。',409)
   const policy=diagnosticAcceptanceEligibility(assembly,c.geometry)
   if(!policy.eligible)fail('Diagnostic 包含无法可靠定位或比较的错误，不能人工采用。')
   const acceptedDiagnostic={version:1,origin:{id:origin.id,hash:origin.hash},execution:{id:origin.executionId,hash:origin.executionHash},diagnostic:{id:origin.candidateId,hash:origin.diagnostic.hash},assembly,geometry:c.geometry}
   const g=await publishGrant(assembly,c,acceptedDiagnostic.origin,acceptedDiagnostic)
   const next=await commit(h,{assembly,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys:c.policy.keys,approvalId:g.id,origin:acceptedDiagnostic.origin,acceptedDiagnostic,savedTutorials:[]})
   return response(next,c)
  }
  cas(h,body.expectedVersion)
  if(route==='sync'){
   let origin=h?.origin
   if(body.originId){if(!safeId(body.originId)||!readOrigin)fail('来源 ID 无效');const r=await readOrigin(body.originId);if(r.assembly?.id!==assembly.id)fail('照片来源与作品 ID 不一致');try{assertModuleOrigin(assembly,r)}catch(e){fail(e.message,409)}origin={id:r.id,hash:r.hash}}
   const evidence=h?.acceptedDiagnostic&&(!origin||origin.id===h.origin?.id)?h.acceptedDiagnostic:undefined,review=acceptance(c,evidence)
   const g=evidence&&review?.complete&&!c.geometry.valid?await publishGrant(assembly,c,origin,evidence):null
   const acceptedKeys=review?review.accepted.filter(i=>i.code==='intersection').map(i=>canonical(i)).sort():[]
   const next=await commit(h,{assembly,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys,approvalId:g?.id??null,...(origin?{origin}:{}),...(evidence?{acceptedDiagnostic:evidence}:{}),savedTutorials:h?.savedTutorials??[]});return response(next,c)
  }
  if(!same(h,c))fail('作品 Revision / Hash 与服务端当前快照不一致。',409)
  if(route==='revalidate'){
   if(h.diagnosticHash===c.diagnosticHash)return response(h,c)
   const {version,hash:_,previousHash,updatedAt,...rest}=h,review=acceptance(c,h.acceptedDiagnostic),g=review?.complete&&!c.geometry.valid?await publishGrant(assembly,c,h.origin,h.acceptedDiagnostic):null;return response(await commit(h,{...rest,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys:review?.accepted.filter(i=>i.code==='intersection').map(i=>canonical(i)).sort()??[],approvalId:g?.id??null}),c)
  }
  if(h.diagnosticHash!==c.diagnosticHash)fail('Validator 诊断已变化，请先重新验证并审核。',409)
  if(['accept','approve'].includes(route)){
   if(!c.policy.eligible)fail('存在不可人工接受的结构错误、未知错误或不可定位碰撞。')
   const keys=body.acceptedKeys;if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string'||!c.policy.keys.includes(k))||new Set(keys).size!==keys.length)fail('接受项不属于当前碰撞集合。')
   const acceptedKeys=[...keys].sort()
   const {version,hash:_,previousHash,updatedAt,...rest}=h
   if(route==='accept'){const accepted=acceptance(c,h.acceptedDiagnostic),keepsAcceptance=accepted?.accepted.filter(i=>i.code==='intersection').every(i=>acceptedKeys.includes(canonical(i)));return response(await commit(h,{...rest,acceptedKeys,approvalId:null,...(h.acceptedDiagnostic&&!keepsAcceptance?{acceptedDiagnostic:null}:{})}),c)}
   if(canonical(acceptedKeys)!==canonical(c.policy.keys)||canonical(h.acceptedKeys)!==canonical(c.policy.keys))fail('尚未逐项接受全部当前碰撞。')
   // Record is immutable; only a successful head CAS makes it authoritative.
   const acceptedDiagnostic=h.acceptedDiagnostic?{...h.acceptedDiagnostic,assembly,geometry:c.geometry}:undefined
   const g=await publishGrant(assembly,c,h.origin,acceptedDiagnostic)
   return response(await commit(h,{...rest,acceptedKeys,approvalId:g.id,...(acceptedDiagnostic?{acceptedDiagnostic}:{})}),c)
  }
  const g=await grant(h,c);if(!g||body.approvalId!==g.id)fail('当前作品没有有效的服务端 Human Approved 授权。',403)
  if(route==='generate'){
   const result=generateBuildOrder3D(assembly,body.options??{},g);const latest=await head(assembly.id);cas(latest,h.version);if(h.origin&&readOrigin)await readOrigin(h.origin.id,{requireSelected:true})
   if(result.tutorial&&h.origin)result.tutorial.source.reconstructionOrigin={...h.origin}
   return {result,review:await response(latest,c)}
  }
  if(route==='saveTutorial'){
   const t=body.tutorial;assertTutorial3D(t)
   if(h.origin&&(t.source.reconstructionOrigin?.id!==h.origin.id||t.source.reconstructionOrigin?.hash!==h.origin.hash))fail('教程 Reconstruction 来源与当前作品不一致',409)
   if(canonical(t.assembly)!==c.assemblyCanonical||canonical(t.source.humanCollisionApproval)!==canonical(referenceFor(g)))fail('教程来源或人工批准引用不匹配。')
   if(!tutorialReadyToSave(t,validateTutorial3D(t,g),assembly))fail('教程仍有未批准的几何错误或顺序问题。')
   const id=randomUUID();await publish(path.join(directory,'tutorials',id+'.json'),{id,tutorial:t,approvalId:g.id,createdAt:new Date().toISOString()})
   // Keep every explicit save reference; the existing local Tutorial workspace
   // still manages its 50-document UI limit. Never silently prune server evidence.
   const {version,hash:_,previousHash,updatedAt,...rest}=h,next=await commit(h,{...rest,savedTutorials:[id,...h.savedTutorials]})
   return {review:await response(next,c),recordId:id}
  }
  fail('未知人工审核操作',404)
 }}
}
