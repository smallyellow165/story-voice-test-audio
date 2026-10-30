import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const id=value=>{if(typeof value!=='string'||!/^([a-f0-9]{64}|[a-f0-9-]{36})$/.test(value))fail('Selected 记录 ID 无效');return value}
const stageName=value=>{if(!['analysis','review'].includes(value))fail('Selected 仅支持 Analysis / Review');return value}
// Tiny reference metadata, separate from immutable snapshots. Publishing revision
// N+1 with an exclusive hard link is an atomic CAS across processes as well as tabs.
// Complete revision files avoid locks or a partially written mutable pointer.
export function createSelectedSnapshots(directory,{read}){
 const folder=(sourceId,stage)=>path.join(directory,'selected',id(sourceId),stageName(stage))
 async function pointer(sourceId,stage){
  const dir=folder(sourceId,stage),names=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})
  const latest=names.filter(n=>/^[0-9]{12}\.json$/.test(n)).sort().at(-1)
  const empty={schemaVersion:1,sourceId,stage,snapshotId:null,revision:0,updatedAt:null}
  if(!latest)return empty
  const record=JSON.parse(await readFile(path.join(dir,latest),'utf8')), {hash,...payload}=record
  if(record.schemaVersion!==1||record.sourceId!==sourceId||record.stage!==stage||!Number.isSafeInteger(record.revision)||record.revision<1||String(record.revision).padStart(12,'0')+'.json'!==latest||!(record.snapshotId===null||id(record.snapshotId))||typeof record.updatedAt!=='string'||hash!==await contentHash(payload))fail('Selected 映射损坏；未选择其他版本',409)
  return payload
 }
 async function target(sourceId,stage,snapshotId){
  const source=await read('sources',id(sourceId))
  if(snapshotId===null)return {}
  const snapshot=await read(stage==='analysis'?'analyses':'reviews',id(snapshotId))
  const analysis=stage==='analysis'?snapshot:await read('analyses',snapshot.analysisId)
  if(analysis.sourceId!==source.id||analysis.sourceHash!==source.hash)fail('Selected Snapshot 不属于当前 Source Image')
  if(!['complete','failed'].includes(analysis.status))fail('Analysis 尚未成为最终快照，不能设为 Selected',409)
  if(stage==='review'&&(analysis.status!=='complete'||snapshot.analysisHash!==analysis.hash))fail('Selected Review 与来源 Analysis 不一致')
  return {analysisId:analysis.id}
 }
 async function get(sourceId,stage){
  let record
  try{record=await pointer(sourceId,stage)}catch(e){return {schemaVersion:1,sourceId,stage,snapshotId:null,revision:null,updatedAt:null,valid:false,error:String(e.message)}}
  try{return {...record,...await target(sourceId,stage,record.snapshotId),valid:true}}catch(e){return {...record,valid:false,error:`Selected ${stage==='analysis'?'Analysis':'Review'} ${record.snapshotId} 无效：${e.code==='ENOENT'?'快照或来源记录缺失':e.message}；未选择其他版本。`}}
 }
 async function getSource(sourceId){
  await read('sources',id(sourceId))
  return Promise.all(['analysis','review'].map(stage=>get(sourceId,stage)))
 }
 async function set({sourceId,stage,snapshotId,expectedRevision}){
  id(sourceId);stageName(stage);if(snapshotId!==null)id(snapshotId)
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=999999999999)fail('Selected expectedRevision 无效')
  const current=await pointer(sourceId,stage)
  if(current.revision!==expectedRevision)fail('Selected 已被其他操作更新，请刷新历史后重试；未覆盖新选择。',409)
  await target(sourceId,stage,snapshotId)
  const record={schemaVersion:1,sourceId,stage,snapshotId,revision:expectedRevision+1,updatedAt:new Date().toISOString()}
  const value={...record,hash:await contentHash(record)},dir=folder(sourceId,stage),temp=path.join(dir,randomUUID()+'.tmp'),dest=path.join(dir,String(record.revision).padStart(12,'0')+'.json')
  await mkdir(dir,{recursive:true})
  try{
   await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600})
   try{await link(temp,dest)}catch(e){if(e.code==='EEXIST')fail('Selected 已被其他操作更新，请刷新历史后重试；未覆盖新选择。',409);throw e}
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
  return getSource(sourceId)
 }
 return {getSource,set}
}
