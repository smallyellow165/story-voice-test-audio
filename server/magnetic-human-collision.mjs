// Local operator authorization. Uses the same append-only/exclusive-link CAS
// publication convention as the existing Profile Registry; no Assembly schema fork.
import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {assertLocalTraceRequest} from './magnetic-trace-files.mjs'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {assertAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {collisionReviewPolicy,grantMatches,referenceFor} from '../src/magnetic-tiles/three-d/human-collision-policy.ts'
import {generateBuildOrder3D} from '../src/magnetic-tiles/three-d/build-order.ts'
import {assertTutorial3D,validateTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
const fail=(m,statusCode=422)=>{throw Object.assign(Error(m),{statusCode})},hash=v=>createHash('sha256').update(canonical(v)).digest('hex')
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id)
export function createHumanCollisionReview(directory,{enabled=false,readOrigin}={}){
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
 function checked(assembly){assertAssembly3D(assembly);if(!assembly.pieces.length||assembly.pieces.length>64||assembly.connections.length>512||Buffer.byteLength(JSON.stringify(assembly))>2_000_000)fail('人工审核 V1 仅支持 1–64 片、最多 512 条连接及 2 MB 快照。');const geometry=validateAssembly3D(assembly),policy=collisionReviewPolicy(assembly,geometry);return {geometry,policy,assemblyHash:hash(assembly),assemblyCanonical:canonical(assembly),diagnosticHash:hash(geometry)}}
 function same(h,c){return h&&h.assemblyHash===c.assemblyHash&&h.assemblyCanonical===c.assemblyCanonical}
 function cas(h,version){if(version!==(h?.version??null))fail('审核版本已过期或发生并发修改；请重新读取审核。',409)}
 async function grant(h,c){
  if(!h?.approvalId||!same(h,c)||h.diagnosticHash!==c.diagnosticHash||!c.policy.eligible)return null
  const g=await readRecord(path.join(directory,'approvals',h.approvalId+'.json'))
  if(!grantMatches(h.assembly,g)||g.assemblyHash!==c.assemblyHash||g.diagnosticHash!==c.diagnosticHash||canonical(g.collisionKeys)!==canonical(c.policy.keys)||canonical(h.acceptedKeys)!==canonical(c.policy.keys))return null
  return g
 }
 async function response(h,c){return {matches:!h||same(h,c),version:h?.version??null,assemblyHash:c.assemblyHash,diagnosticHash:c.diagnosticHash,assemblyCanonical:c.assemblyCanonical,acceptedKeys:same(h,c)&&h.diagnosticHash===c.diagnosticHash?h.acceptedKeys:[],eligible:c.policy.eligible,collisionKeys:c.policy.keys,geometry:c.geometry,blockers:c.policy.blockers,grant:await grant(h,c)}}
 return {async dispatch(method,route,body={},context){
  authorize(context,route!=='session');if(method!=='POST')fail('Use POST',405)
  if(route==='session'){for(const [k,v]of sessions)if(v<Date.now())sessions.delete(k);if(sessions.size>1024)fail('本机会话过多。',429);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+8*3600000);return {token,scope:'local-human-collision-review'}}
  const allowed={status:['assembly'],sync:['assembly','expectedVersion','originId'],accept:['assembly','expectedVersion','acceptedKeys'],approve:['assembly','expectedVersion','acceptedKeys'],revalidate:['assembly','expectedVersion'],generate:['assembly','expectedVersion','approvalId','options'],saveTutorial:['assembly','expectedVersion','approvalId','tutorial']}
  if(!allowed[route]||!body||Object.keys(body).some(k=>!allowed[route].includes(k)))fail('人工审核请求字段或操作无效。',400)
  const assembly=body.assembly,c=checked(assembly),h=await head(assembly.id)
  if(route==='status')return response(h,c)
  cas(h,body.expectedVersion)
  if(route==='sync'){
   let origin=h?.origin
   if(body.originId){if(!safeId(body.originId)||!readOrigin)fail('来源 ID 无效');const r=await readOrigin(body.originId);if(r.assembly?.id!==assembly.id)fail('照片来源与作品 ID 不一致');origin={id:r.id,hash:r.hash}}
   const next=await commit(h,{assembly,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys:[],approvalId:null,...(origin?{origin}:{}),savedTutorials:h?.savedTutorials??[]});return response(next,c)
  }
  if(!same(h,c))fail('作品 Revision / Hash 与服务端当前快照不一致。',409)
  if(route==='revalidate'){
   if(h.diagnosticHash===c.diagnosticHash)return response(h,c)
   const {version,hash:_,previousHash,updatedAt,...rest}=h;return response(await commit(h,{...rest,diagnosticHash:c.diagnosticHash,geometry:c.geometry,acceptedKeys:[],approvalId:null}),c)
  }
  if(h.diagnosticHash!==c.diagnosticHash)fail('Validator 诊断已变化，请先重新验证并审核。',409)
  if(['accept','approve'].includes(route)){
   if(!c.policy.eligible)fail('存在不可人工接受的结构错误、未知错误或不可定位碰撞。')
   const keys=body.acceptedKeys;if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string'||!c.policy.keys.includes(k))||new Set(keys).size!==keys.length)fail('接受项不属于当前碰撞集合。')
   const acceptedKeys=[...keys].sort()
   const {version,hash:_,previousHash,updatedAt,...rest}=h
   if(route==='accept')return response(await commit(h,{...rest,acceptedKeys,approvalId:null}),c)
   if(canonical(acceptedKeys)!==canonical(c.policy.keys)||canonical(h.acceptedKeys)!==canonical(c.policy.keys))fail('尚未逐项接受全部当前碰撞。')
   // Record is immutable; only a successful head CAS makes it authoritative.
   const id=randomUUID(),g=await publish(path.join(directory,'approvals',id+'.json'),{id,assemblyId:assembly.id,revision:assembly.revision,assemblyHash:c.assemblyHash,assemblyCanonical:c.assemblyCanonical,diagnosticHash:c.diagnosticHash,collisionKeys:c.policy.keys,geometry:c.geometry,approvedAt:new Date().toISOString(),actor:'local-operator',...(h.origin?{origin:h.origin}:{})})
   return response(await commit(h,{...rest,acceptedKeys,approvalId:g.id}),c)
  }
  const g=await grant(h,c);if(!g||body.approvalId!==g.id)fail('当前作品没有有效的服务端 Human Approved 授权。',403)
  if(route==='generate'){
   const result=generateBuildOrder3D(assembly,body.options??{},g);const latest=await head(assembly.id);cas(latest,h.version)
   return {result,review:await response(latest,c)}
  }
  if(route==='saveTutorial'){
   const t=body.tutorial;assertTutorial3D(t)
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
