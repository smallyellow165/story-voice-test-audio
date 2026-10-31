import {mkdir,writeFile,rename,readFile} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const id=value=>{if(typeof value!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value))fail('无效记录 ID');return value}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
async function write(file,data,exclusive=false){await mkdir(path.dirname(file),{recursive:true});if(exclusive)return writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data),{flag:'wx',mode:0o600});await rename(temp,file)}
export function recordedSpatialOperation(requests) { return async function operation(body,kind,work){
  const requestId=id(body.requestId),file=path.join(requests,requestId+'.json'),fingerprint=hash({kind,...body})
  const pending={id:requestId,kind,fingerprint,state:'running',createdAt:new Date().toISOString(),analysisId:body.analysisId??null,planId:body.planId??null}
  try{await write(file,pending,true)}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(file);if(old.fingerprint!==fingerprint)fail('请求 ID 已用于不同输入',409);return old}
  try{const result=await work();const done={...pending,state:'complete',...result};await write(file,done);return done}
  catch(e){const failed={...pending,state:'failed',error:e.statusCode?e.message:'执行失败；记录已保留，未自动重试。'};await write(file,failed);return failed}
 }
}
