import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {assertAssembly3D,serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {assertCanonicalProfiles} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {assertCameraView} from '../src/magnetic-tiles/three-d/camera-view.ts'
import {nonRepairableKeys} from '../src/magnetic-tiles/three-d/non-repairable.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex')
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)||['__proto__','constructor','prototype'].includes(value))fail('Assembly ID 无效');return value}
const projectId=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('Project ID 无效');return value}
/** Saved versions of the existing Assembly3D + origin sidecar, not another geometry model.
 * The editor Revision may go backwards through Undo. Storage version/hash is the CAS.
 */
export function createAssemblyLibrary(directory,{readOrigin,selectedOrigin,getProfiles,captureReview}){
 async function latest(assemblyId){
  const dir=path.join(directory,id(assemblyId)),files=(await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(n=>/^\d{12}\.json$/.test(n)).sort()
  if(!files.length)return null
  const r=JSON.parse(await readFile(path.join(dir,files.at(-1)),'utf8')),{hash:stored,...payload}=r
  if(stored!==hash(payload)||r.assembly.id!==assemblyId||r.version!==Number(files.at(-1).slice(0,12))||hash(r.snapshot)!==r.snapshotHash)fail('Assembly 存档 Hash 不一致',409)
  assertAssembly3D(r.snapshot.assembly)
  return r
 }
 async function state(r){try{const o=await selectedOrigin(r.parent.id);if(o.hash!==r.parent.hash)throw Error('Origin Hash 不一致');return {selected:true,error:null}}catch(e){return {selected:false,error:String(e.message)}}}
 function summary(r){return {id:r.assembly.id,name:r.name,type:r.type,project:r.project,group:r.group,revision:r.snapshot.assembly.revision,tiles:r.snapshot.assembly.pieces.length,connections:r.snapshot.assembly.connections.length,hash:r.hash,snapshotHash:r.snapshotHash,savedAt:r.savedAt,parent:r.parent}}
 return {read:latest,async dispatch(method,route,body={}){
  if(method==='GET'&&route.startsWith('projects/')){
   const p=projectId(route.slice(9)),dirs=await readdir(directory,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
   const records=await Promise.all(dirs.filter(d=>d.isDirectory()).map(d=>latest(d.name)))
   return {assemblies:records.filter(r=>r?.project.id===p).map(summary).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))}
  }
  if(method==='GET'&&route.startsWith('records/')){const r=await latest(route.slice(8));if(!r)fail('Assembly 尚未保存',404);return {...r,lineage:await state(r)}}
  if(method!=='POST'||route!=='save')fail('未知 Assembly 操作',404)
  if(!body||Object.keys(body).some(k=>!['snapshot','expectedHash'].includes(k)))fail('Assembly 保存字段无效')
  const s=body.snapshot,a=s?.assembly;assertAssembly3D(a);id(a.id)
  if(Buffer.byteLength(JSON.stringify(s))>4_000_000||!Array.isArray(s.nonRepairable)||s.nonRepairable.some(k=>typeof k!=='string')||canonical(nonRepairableKeys(a,s.nonRepairable))!==canonical(s.nonRepairable))fail('Assembly 快照或不可修复标记无效')
  assertCanonicalProfiles(a.profiles,await getProfiles())
  const sidecar=s.photoOrigin,o=sidecar?.origin
  if(!o||typeof o.id!=='string'||typeof o.hash!=='string'||o.assembly?.id!==a.id||sidecar.assemblyRaw!==serializeAssembly3D(o.assembly))fail('Assembly 缺少一致的不可变 Origin 快照',409)
  projectId(o.sourceId);if(sidecar.cameraView)assertCameraView(sidecar.cameraView)
  const previous=await latest(a.id)
  if(previous){if(canonical(previous.snapshot.photoOrigin.origin)!==canonical(o)||previous.snapshot.photoOrigin.assemblyRaw!==sidecar.assemblyRaw)fail('Assembly 的 Parent Lineage 不可重绑',409)}
  else{const stored=await readOrigin(o.id);if(canonical(stored)!==canonical(o))fail('Assembly Origin 与实际来源不一致',409)}
  const snapshotHash=hash(s)
  const reviewRef=await captureReview(a)??(previous?.snapshotHash===snapshotHash?previous.reviewRef:null)
  // Safe registration of an already saved working slot; never overwrites a
  // different/newer server document or increments a geometry Revision.
  if(previous&&snapshotHash===previous.snapshotHash&&canonical(reviewRef)===canonical(previous.reviewRef)&&(body.expectedHash===null||body.expectedHash===previous.hash))return {...previous,lineage:await state(previous)}
  if(body.expectedHash!==(previous?.hash??null))fail('Assembly 已被其他页面更新；保存未覆盖，请重新选择已保存作品。',409)
  const payload={schemaVersion:1,type:'group',assembly:{id:a.id},name:o.reconstructionScope?.groupName??'Group Assembly',group:{id:o.reconstructionScope?.groupId??'all',name:o.reconstructionScope?.groupName??'全部模块'},project:{id:o.sourceId,hash:o.sourceHash},parent:{kind:'geometry-origin',id:o.id,hash:o.hash},version:(previous?.version??0)+1,previousHash:previous?.hash??null,snapshot:s,snapshotHash,reviewRef,savedAt:new Date().toISOString()}
  const r={...payload,hash:hash(payload)},dir=path.join(directory,a.id),target=path.join(dir,String(r.version).padStart(12,'0')+'.json'),temp=target+'.'+randomUUID()+'.tmp'
  await mkdir(dir,{recursive:true});try{await writeFile(temp,JSON.stringify(r),{flag:'wx',mode:0o600});try{await link(temp,target)}catch(e){if(e.code==='EEXIST')fail('Assembly 并发保存冲突；未覆盖现有存档。',409);throw e}}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return {...r,lineage:await state(r)}
 }}
}
