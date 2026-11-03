import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {assertAssembly3D,serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {assertCanonicalProfiles} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {assertCameraView} from '../src/magnetic-tiles/three-d/camera-view.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {combineAssemblySnapshots,assertModuleOrigin} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {nonRepairableKeys} from '../src/magnetic-tiles/three-d/non-repairable.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex')
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)||['__proto__','constructor','prototype'].includes(value))fail('Assembly ID 无效');return value}
const projectId=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('Project ID 无效');return value}
/** Saved versions of the existing Assembly3D + origin sidecar, not another geometry model.
 * The editor Revision may go backwards through Undo. Storage version/hash is the CAS.
 */
export function createAssemblyLibrary(directory,{readOrigin,selectedOrigin,getProfiles}){
 async function latest(assemblyId,version){
  if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))fail('Assembly 固定版本无效')
  const dir=path.join(directory,id(assemblyId)),files=(await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(n=>/^\d{12}\.json$/.test(n)).sort()
  if(!files.length)return null
  const filename=version===undefined?files.at(-1):String(version).padStart(12,'0')+'.json'
  if(!files.includes(filename))fail('Assembly 固定版本不存在',404)
  const r=JSON.parse(await readFile(path.join(dir,filename),'utf8')),{hash:stored,...payload}=r
  if(stored!==hash(payload)||r.assembly.id!==assemblyId||r.version!==Number(filename.slice(0,12))||hash(r.snapshot)!==r.snapshotHash)fail('Assembly 存档 Hash 不一致',409)
  assertAssembly3D(r.snapshot.assembly)
  return r
 }
 async function state(r,depth=0){try{
  if(depth>8)throw Error('Combined Parent 链过深')
  if(r.type==='combined'){for(const ref of r.parent.assemblies){const p=await latest(ref.id,ref.version);if(!p||p.hash!==ref.hash||p.snapshotHash!==ref.snapshotHash||p.snapshot.assembly.revision!==ref.revision||p.project.id!==r.project.id)throw Error('Combined Parent Snapshot 不一致');const status=await state(p,depth+1);if(!status.selected)throw Error(status.error)}}
  else{const o=await selectedOrigin(r.parent.id);if(o.hash!==r.parent.hash)throw Error('Origin Hash 不一致')}
  return {selected:true,error:null}
 }catch(e){return {selected:false,error:String(e.message)}}}
 async function combinedOrigin(assemblyId,requireSelected=true){const r=await latest(assemblyId);if(r?.type!=='combined')fail('Combined 来源不存在',404);if(requireSelected){const s=await state(r);if(!s.selected)fail(s.error,409)}return r.snapshot.photoOrigin.origin}
 function summary(r){return {id:r.assembly.id,version:r.version,name:r.name,type:r.type,project:r.project,group:r.group,revision:r.snapshot.assembly.revision,tiles:r.snapshot.assembly.pieces.length,connections:r.snapshot.assembly.connections.length,hash:r.hash,snapshotHash:r.snapshotHash,savedAt:r.savedAt,parent:r.parent}}
 async function dispatch(method,route,body={},createdOrigin=null){
  if(method==='GET'&&route.startsWith('projects/')){
   const p=projectId(route.slice(9)),dirs=await readdir(directory,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
   const records=await Promise.all(dirs.filter(d=>d.isDirectory()).map(d=>latest(d.name)))
   return {assemblies:records.filter(r=>r?.project.id===p).map(summary).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))}
  }
  const fixed=route.match(/^records\/([^/]+)\/versions\/([1-9]\d*)$/)
  if(method==='GET'&&fixed){const r=await latest(fixed[1],Number(fixed[2]));if(!r)fail('Assembly 固定版本不存在',404);return r}
  if(method==='GET'&&route.startsWith('records/')){const r=await latest(route.slice(8));if(!r)fail('Assembly 尚未保存',404);return {...r,lineage:await state(r)}}
  if(method==='GET'&&route.startsWith('selected-origin/'))return combinedOrigin(route.slice(16))
  if(method==='POST'&&route==='build-check'){
   const o=await combinedOrigin(body.originId);assertAssembly3D(body.assembly);if(body.assembly.id!==o.id)fail('Combined Build ID 不一致',409);assertCanonicalProfiles(body.assembly.profiles,await getProfiles());assertModuleOrigin(body.assembly,o);const geometry=validateAssembly3D(body.assembly);return {origin:o,geometry}
  }
  if(method==='POST'&&route==='combine'){
   if(!body||Object.keys(body).some(k=>!['name','parents'].includes(k))||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||!Array.isArray(body.parents)||body.parents.length<2||body.parents.length>8)fail('请选择 2–8 个已保存作品并填写组合名称')
   const parents=await Promise.all(body.parents.map(async ref=>{if(!Number.isSafeInteger(ref.version)||ref.version<1)fail('Parent version 无效');const r=await latest(ref.id,ref.version);if(!r||r.hash!==ref.hash)fail('Parent CAS / Snapshot 已变化',409);return r}))
   if(new Set(parents.map(r=>r.project.id)).size!==1||new Set(parents.map(r=>r.project.hash)).size!==1)fail('不能跨 Project 组合',409)
   const refs=parents.map(r=>({id:r.assembly.id,version:r.version,hash:r.hash,snapshotHash:r.snapshotHash,revision:r.snapshot.assembly.revision})),a=combineAssemblySnapshots('combined-'+randomUUID(),parents.map((r,i)=>({name:r.name,parent:refs[i],assembly:r.snapshot.assembly})))
   if(a.pieces.length>64||a.connections.length>512)fail('组合 Draft V1 最多 64 片 / 512 条连接')
   const data={kind:'combined-assembly',id:a.id,name:body.name.trim(),sourceId:parents[0].project.id,sourceHash:parents[0].project.hash,parents:refs,assembly:a,createdAt:new Date().toISOString()},origin={...data,hash:hash(data)}
   const nonRepairable=parents.flatMap((r,i)=>r.snapshot.nonRepairable.map(key=>{const ids=JSON.parse(key),map=new Map(a.modules[i].pieces.map(p=>[p.sourceId,p.id]));return JSON.stringify(ids.map(id=>map.get(id)).sort())})).sort()
   const snapshot={assembly:a,photoOrigin:{origin,assemblyRaw:serializeAssembly3D(a)},nonRepairable}
   return dispatch('POST','save',{snapshot,expectedHash:null},origin)
  }
  if(method!=='POST'||route!=='save')fail('未知 Assembly 操作',404)
  if(!body||Object.keys(body).some(k=>!['snapshot','expectedHash'].includes(k)))fail('Assembly 保存字段无效')
  const s=body.snapshot,a=s?.assembly;assertAssembly3D(a);id(a.id)
  if(Buffer.byteLength(JSON.stringify(s))>4_000_000||!Array.isArray(s.nonRepairable)||s.nonRepairable.some(k=>typeof k!=='string')||canonical(nonRepairableKeys(a,s.nonRepairable))!==canonical(s.nonRepairable))fail('Assembly 快照或不可修复标记无效')
  assertCanonicalProfiles(a.profiles,await getProfiles())
  const sidecar=s.photoOrigin,o=sidecar?.origin
  if(!o||typeof o.id!=='string'||typeof o.hash!=='string'||o.assembly?.id!==a.id||sidecar.assemblyRaw!==serializeAssembly3D(o.assembly))fail('Assembly 缺少一致的不可变 Origin 快照',409)
  try{assertModuleOrigin(a,o)}catch(e){fail(e.message,409)}
  projectId(o.sourceId);if(sidecar.cameraView)assertCameraView(sidecar.cameraView)
  const previous=await latest(a.id)
  if(previous){if(canonical(previous.snapshot.photoOrigin.origin)!==canonical(o)||previous.snapshot.photoOrigin.assemblyRaw!==sidecar.assemblyRaw)fail('Assembly 的 Parent Lineage 不可重绑',409)}
  else if(o.kind==='combined-assembly'){if(!createdOrigin||canonical(createdOrigin)!==canonical(o))fail('Combined 来源必须由明确的组合操作创建',409)}
  else{const stored=await readOrigin(o.id);if(canonical(stored)!==canonical(o))fail('Assembly Origin 与实际来源不一致',409)}
  const snapshotHash=hash(s)
  // Safe registration of an already saved working slot; never overwrites a
  // different/newer server document or increments a geometry Revision.
  if(previous&&snapshotHash===previous.snapshotHash&&(body.expectedHash===null||body.expectedHash===previous.hash))return {...previous,lineage:await state(previous)}
  if(body.expectedHash!==(previous?.hash??null))fail('Assembly 已被其他页面更新；保存未覆盖，请重新选择已保存作品。',409)
  const payload={schemaVersion:1,type:o.kind==='combined-assembly'?'combined':'group',assembly:{id:a.id},name:o.kind==='combined-assembly'?o.name:o.reconstructionScope?.groupName??'Group Assembly',group:{id:o.kind==='combined-assembly'?'combined':o.reconstructionScope?.groupId??'all',name:o.kind==='combined-assembly'?o.name:o.reconstructionScope?.groupName??'全部模块'},project:{id:o.sourceId,hash:o.sourceHash},parent:o.kind==='combined-assembly'?{kind:'assemblies',assemblies:o.parents}:{kind:'geometry-origin',id:o.id,hash:o.hash},version:(previous?.version??0)+1,previousHash:previous?.hash??null,snapshot:s,snapshotHash,savedAt:new Date().toISOString()}
  const r={...payload,hash:hash(payload)},dir=path.join(directory,a.id),target=path.join(dir,String(r.version).padStart(12,'0')+'.json'),temp=target+'.'+randomUUID()+'.tmp'
  await mkdir(dir,{recursive:true});try{await writeFile(temp,JSON.stringify(r),{flag:'wx',mode:0o600});try{await link(temp,target)}catch(e){if(e.code==='EEXIST')fail('Assembly 并发保存冲突；未覆盖现有存档。',409);throw e}}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return {...r,lineage:await state(r)}
 }
 return {read:latest,origin:combinedOrigin,dispatch}
}
