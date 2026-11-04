import {mkdir,writeFile,rename,readFile,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const id=value=>{if(typeof value!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value))fail('无效记录 ID');return value}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
async function write(file,data,exclusive=false){await mkdir(path.dirname(file),{recursive:true});if(exclusive)return writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data),{flag:'wx',mode:0o600});await rename(temp,file)}
async function acquire(lock){
 try{await writeFile(lock,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:'wx',mode:0o600})}
 catch(e){
  if(e.code!=='EEXIST')throw e
  const old=await read(lock);let alive=true;try{process.kill(old.pid,0)}catch(error){if(error.code==='ESRCH')alive=false}
  if(alive&&old.at>=Date.now()-process.uptime()*1000-1000)fail('当前任务正在提交或查询，请稍后查询同一任务。',409)
  await unlink(lock).catch(error=>{if(error.code!=='ENOENT')throw error});await acquire(lock)
 }
}
export function recordedSpatialOperation(requests) { return async function operation(body,kind,work){
  const requestId=id(body.requestId),file=path.join(requests,requestId+'.json'),fingerprint=hash({kind,...body})
  const pending={id:requestId,kind,...(body.projectId?{projectId:body.projectId}:{}),fingerprint,state:'running',createdAt:new Date().toISOString(),analysisId:body.analysisId??null,planId:body.planId??null,...(body.refinement?{refinement:body.refinement}:{}),...(body.reconstructionScope?{reconstructionScope:body.reconstructionScope}:{}),...(body.sourceHash?{sourceId:body.sourceId,sourceHash:body.sourceHash}:{})}
  try{await write(file,pending,true)}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(file);if(old.fingerprint!==fingerprint)fail('请求 ID 已用于不同输入',409);return old}
  const checkpoint=async partial=>{Object.assign(pending,partial);await write(file,pending)}
  const lock=kind==='analyze'?file+'.resume-lock':null
  if(lock)await acquire(lock)
  try{const result=await work(checkpoint);const done={...pending,state:'complete',...result};await write(file,done);return done}
  catch(e){const failed={...pending,state:'failed',error:e.statusCode?e.message:'执行失败；记录已保留，未自动重试。'};await write(file,failed);return failed}
  finally{if(lock)await unlink(lock)}
 }
}
// A resume updates the existing operation, serialized across factories/processes.
// It never claims the original submission key again or invokes generation.
export async function resumeSpatialOperation(requests,requestId,work){
 const file=path.join(requests,id(requestId)+'.json'),lock=file+'.resume-lock'
 await acquire(lock)
 try{
  let saved=await read(file)
  const checkpoint=async partial=>{saved={...saved,...partial};await write(file,saved)}
  const result=await work(saved,checkpoint),updated={...saved,...result};await write(file,updated);return updated
 }finally{await unlink(lock)}
}
