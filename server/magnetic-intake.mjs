import {mkdir,readFile,readdir,writeFile,rename,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateImage} from './brick-image-validation.mjs'
import {modelOptions,providerStatus,resolveModel,providerConfigured} from './brick-model-registry.mjs'
import {recognize,promptVersion} from './magnetic-intake-vision.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {parseAssembly} from '../src/magnetic-tiles/storage.ts'
import {checkArtwork,workMode} from '../src/magnetic-tiles/artwork.ts'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'
import {reconstruct,reconstructionVersion} from '../src/magnetic-tiles/intake/reconstruct.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const validId=id=>{if(typeof id!=='string'||!/^([a-f0-9]{64}|[a-f0-9-]{36})$/.test(id))fail('记录 ID 无效');return id}
const kinds=['sources','analyses','reviews','reconstructions','origins']
export function createMagneticIntake(directory){
 const file=(kind,id)=>path.join(directory,kind,validId(id)+'.json')
 async function put(kind,value,{replace=false}={}){
  const {hash:_,...payload}=value, record={...payload,hash:await contentHash(payload)}
  const target=file(kind,record.id),temp=target+'.'+randomUUID()+'.tmp';await mkdir(path.dirname(target),{recursive:true})
  try {await writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600});if(replace)await rename(temp,target);else {try{await link(temp,target)}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(kind,record.id);if(old.hash!==record.hash)fail('记录 ID 已存在，未覆盖历史',409)}}}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return record
 }
 async function read(kind,id){const r=JSON.parse(await readFile(file(kind,id),'utf8'));const {hash,...payload}=r;if(hash!==await contentHash(payload)||r.id!==id)fail('记录内容 Hash 不一致');return r}
 async function asset(input){const img=validateImage(input),id=img.sha256;const existing=await read('assets',id).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(existing)return existing;return put('assets',{schemaVersion:1,id,mimeType:img.mimeType,imageBase64:img.imageBase64,bytes:img.bytes})}
 async function view(source){const a=await read('assets',source.view.hash);if(validateImage(a).sha256!==source.view.hash)fail('图片字节 Hash 不一致');return {...a,...source.view}}
 async function reviewed(id){const r=await read('reviews',id),a=await read('analyses',r.analysisId);if(a.hash!==r.analysisHash||a.status!=='complete')fail('Review 来源不一致');const s=await read('sources',a.sourceId);if(s.hash!==a.sourceHash)fail('Analysis 来源不一致');return {review:r,analysis:a,source:s}}
 async function result(id){const r=await read('reconstructions',id),{review,source}=await reviewed(r.reviewId);if(r.reviewHash!==review.hash||r.sourceHash!==source.hash||r.profileHash!==await contentHash(profiles))fail('重建来源或 Profile 已改变');return {reconstruction:r,review,source}}
 async function history(){const out={warnings:[]};for(const kind of kinds){out[kind]=[];const fs=await readdir(path.join(directory,kind)).catch(e=>{if(e.code==='ENOENT')return [];throw e});for(const f of fs.filter(f=>f.endsWith('.json'))){try{const r=await read(kind,f.slice(0,-5));if(kind==='analyses'){const {request,response,rawResponseBody,rawOutput,...summary}=r;out[kind].push(summary)}else out[kind].push(r)}catch{out.warnings.push(kind+'/'+f+' 无法读取')}}out[kind].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}return out}
 return {read,result,async dispatch(method,route,body={}){
  if(method==='GET'&&route==='status')return {schemaVersion:1,models:modelOptions('reverse'),providers:providerStatus(),promptVersion,algorithm:reconstructionVersion}
  if(method==='GET'&&route==='history')return history()
  if(method==='GET'&&route.startsWith('image/')){const s=await read('sources',route.slice(6));return view(s)}
  if(method==='GET'&&route.includes('/')){const [kind,id]=route.split('/');if(kinds.includes(kind))return read(kind,id)}
  if(method==='POST'&&route==='sources'){
   const original=await asset(body.original),image=validateImage(body.view),bytes=Buffer.from(image.imageBase64,'base64')
   if(image.mimeType!=='image/png'||bytes.length<24)fail('识别视图必须是浏览器方向归一化 PNG')
   const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20)
   if(width<1||height<1||width>1600||height>1600)fail('识别视图大小超出范围')
   const v=await asset(body.view),id=await contentHash({original:original.id,view:v.id})
   const old=await read('sources',id).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(old)return old
   return put('sources',{schemaVersion:1,id,name:String(body.name||'图片').slice(0,100),createdAt:new Date().toISOString(),originalHash:original.id,view:{hash:v.id,width,height,mimeType:v.mimeType,orientation:'display',transform:'oriented-resize'}})
  }
  if(method==='POST'&&route==='recognize'){
   const source=await read('sources',body.sourceId),definition=resolveModel(body.model,'reverse')
   if(!providerConfigured(definition.provider))fail('服务端未配置 '+definition.provider+' 凭据',503)
   const id=validId(body.requestId),fingerprint=await contentHash({sourceHash:source.hash,model:body.model,promptVersion})
   const previous=await read('analyses',id).catch(e=>{if(e.code==='ENOENT')return null;throw e})
   if(previous){if(previous.fingerprint!==fingerprint)fail('请求 ID 已用于其他识别',409);return previous}
   await mkdir(path.join(directory,'requests'),{recursive:true})
   try{await writeFile(path.join(directory,'requests',id),fingerprint,{flag:'wx',mode:0o600})}catch(e){if(e.code==='EEXIST')fail('识别请求已提交；请加载历史，不会重复调用模型',409);throw e}
   const record={schemaVersion:1,id,fingerprint,sourceId:source.id,sourceHash:source.hash,status:'processing',model:body.model,provider:definition.provider,promptVersion,createdAt:new Date().toISOString()}
   await put('analyses',record)
   try {record.evidence=parseEvidence(await recognize(body.model,await view(source),record));for(const o of record.evidence.observations){if(o.origin!=='observed'||o.excluded)fail('模型输出了非观察来源或排除项')}record.status='complete'}catch(e){record.status='failed';record.error=String(e.message).slice(0,3000)}
   return put('analyses',record,{replace:true})
  }
  if(method==='POST'&&route==='reviews'){
   const a=await read('analyses',body.analysisId);if(a.status!=='complete'||a.hash!==body.analysisHash)fail('Analysis 尚未完成或版本不一致')
   const evidence=parseEvidence(body.evidence)
   for(const o of evidence.observations){const old=a.evidence.observations.find(p=>p.id===o.id);if(o.origin!==(old?'observed':'manual'))fail('新增零件必须标记为人工补充')}
   return put('reviews',{schemaVersion:1,id:randomUUID(),analysisId:a.id,analysisHash:a.hash,evidence,createdAt:new Date().toISOString()})
  }
  if(method==='POST'&&route==='reconstruct'){
   const {review,source}=await reviewed(body.reviewId);if(review.hash!==body.reviewHash)fail('Review Hash 不一致')
   const mode=body.mode??'connected-construction';if(!['connected-construction','flat-mosaic'].includes(mode))fail('作品模式无效')
   const id=randomUUID(),output=reconstruct(review.evidence,source.view.width,source.view.height,profiles,id,mode)
   return put('reconstructions',{schemaVersion:2,mode,id,reviewId:review.id,reviewHash:review.hash,sourceId:source.id,sourceHash:source.hash,profileHash:await contentHash(profiles),algorithm:reconstructionVersion,...output,createdAt:new Date().toISOString()})
  }
  if(method==='POST'&&route==='origins'){
   const {reconstruction:r}=await result(body.reconstructionId),c=r.candidates.find(c=>c.id===body.candidateId)
   if(!c||r.hash!==body.reconstructionHash||body.visualChecked!==true)fail('请对照原图选择候选，并确认图片吻合情况')
   const a=parseAssembly(body.assembly,profiles)
   if(!checkArtwork(a,profiles).ready||workMode(a)!==workMode(c.assembly)||await contentHash(a.instances)!==await contentHash(c.assembly.instances))fail('载入实例与重建候选不一致')
   if(a.id!==c.assembly.id)fail('Assembly ID 与候选不一致')
   return put('origins',{schemaVersion:1,id:randomUUID(),reconstructionId:r.id,reconstructionHash:r.hash,candidateId:c.id,sourceId:r.sourceId,assembly:a,assemblyHash:await contentHash(a),instanceMap:a.instances.map(t=>({observationId:t.id,instanceId:t.id})),createdAt:new Date().toISOString()})
  }
  fail('未知 Magnetic Intake 操作',404)
 }}
}
