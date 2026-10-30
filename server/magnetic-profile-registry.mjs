import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {profiles as seeds,profileKey} from '../src/magnetic-tiles/profiles.ts'
import {parametricProfile} from '../src/magnetic-tiles/parametric-profile.ts'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
// Immutable append-only ledger. Atomic exclusive publication of revision N+1
// implements the same cross-process CAS convention as Selected Snapshots.
export function createProfileRegistry(directory){
 const dir=path.join(directory,'profile-registry')
 async function get(){
  const names=(await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(n=>/^[0-9]{12}\.json$/.test(n)).sort()
  let hash=await contentHash(seeds),revision=0
  const profiles=structuredClone(seeds)
  for(const filename of names){
   let record;try{record=JSON.parse(await readFile(path.join(dir,filename),'utf8'))}catch{fail('Profile Registry 记录无法读取：'+filename,409)}
   if(!record||typeof record!=='object')fail('Profile Registry 记录结构损坏',409)
   const {hash:actual,...payload}=record
   if(record.schemaVersion!==1||record.revision!==revision+1||filename!==String(record.revision).padStart(12,'0')+'.json'||record.previousHash!==hash||actual!==await contentHash(payload))fail('Profile Registry 版本链损坏；未使用其他 Catalog',409)
   let generated;try{generated=parametricProfile(record.input,record.profile.version)}catch{fail('Profile Registry 参数损坏',409)}
   const previous=profiles.filter(p=>p.id===record.profile.id),next=previous.length?Math.max(...previous.map(p=>p.version))+1:1
   if(record.profile.version!==next||await contentHash(generated)!==await contentHash(record.profile)||profiles.some(p=>profileKey(p)===profileKey(record.profile)))fail('Profile Registry 几何或版本损坏',409)
   profiles.push(record.profile);revision=record.revision;hash=actual
  }
  return {schemaVersion:1,revision,hash,profiles}
 }
 async function save({expectedRevision,operation,input}){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=999999999999||!['create','version'].includes(operation))fail('Registry CAS 或操作无效')
  const current=await get()
  if(current.revision!==expectedRevision)fail('Catalog 已被其他操作更新，请刷新 Catalog 后重试；编辑内容已保留，未覆盖任何版本。',409)
  const prior=current.profiles.filter(p=>p.id===input?.id)
  if(operation==='create'&&prior.length)fail('Profile ID 已存在；请使用不同 ID 或保存新版本',409)
  if(operation==='version'&&!prior.length)fail('原 Profile 不存在，不能创建新版本')
  let profile;try{profile=parametricProfile(input,prior.length?Math.max(...prior.map(p=>p.version))+1:1)}catch(e){fail(e.message)}
  if(current.profiles.length>=1000)fail('Catalog 已达到 V1 的 1000 个版本上限')
  input={id:profile.id,name:profile.name,parameters:profile.parametric,connectableEdges:profile.connectableEdges,estimated:!!profile.sizeEvidence,source:profile.geometrySource}
  const payload={schemaVersion:1,revision:current.revision+1,previousHash:current.hash,profile,input,createdAt:new Date().toISOString()}
  const record={...payload,hash:await contentHash(payload)},temp=path.join(dir,randomUUID()+'.tmp'),dest=path.join(dir,String(record.revision).padStart(12,'0')+'.json')
  await mkdir(dir,{recursive:true})
  try{await writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600});try{await link(temp,dest)}catch(e){if(e.code==='EEXIST')fail('Catalog 已被其他操作更新，请刷新 Catalog 后重试；未覆盖任何版本。',409);throw e}}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return {registry:await get(),profile}
 }
 return {get,save}
}
