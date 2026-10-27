import {readFile,readdir} from 'node:fs/promises'
import path from 'node:path'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const sources={reverse:{directory:'brick-reverse',kind:'reverse-analysis'},spatial:{directory:'brick-spatial-traces',task:'spatial-planning'},build:{directory:'brick-build-traces',task:'build-order'}}
const secret=k=>/^(authorization|proxyauthorization|cookie|setcookie|apikey|xapikey|accesskey|accesstoken|refreshtoken|clientsecret|password|secret)$/.test(k.toLowerCase().replace(/[-_\s]/g,''))
export function shareText(raw){
 const changes={credentials:0,images:0}
 const scrubText=s=>s.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi,x=>{changes.images++;return `[IMAGE BASE64 OMITTED: ${x.length} characters]`}).replace(/([?&](?:key|api_key|access_token)=)[^&\s"']+/gi,(_,prefix)=>{changes.credentials++;return prefix+'[REDACTED]'}).replace(/"(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token)"\s*:\s*"[^"]*"/gi,(_,key)=>{changes.credentials++;return JSON.stringify(key)+':"[REDACTED]"'}).replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,()=>{changes.credentials++;return 'Bearer [REDACTED]'}).replace(/\bsk-[A-Za-z0-9_-]{16,}/g,()=>{changes.credentials++;return '[REDACTED KEY]'}).replace(/^(\s*(?:authorization|cookie|set-cookie|x-api-key)\s*:\s*).+$/gim,(_,prefix)=>{changes.credentials++;return prefix+'[REDACTED]'})
 function clean(v){
  if(Array.isArray(v))return v.map(clean)
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>{
   if(secret(k)){changes.credentials++;return [k,'[REDACTED CREDENTIAL]']}
   if((k==='imageBase64'||k==='image_base64'||(k==='data'&&typeof v.mimeType==='string'&&v.mimeType.startsWith('image/')))&&typeof x==='string'){changes.images++;return [k,`[IMAGE BASE64 OMITTED: ${x.length} characters]`]}
   return [k,clean(x)]
  }))
  if(typeof v!=='string')return v
  if(v.startsWith('data:image/')&&v.includes(';base64,')){changes.images++;return `[IMAGE BASE64 OMITTED: ${v.length} characters]`}
  // Provider text fields may themselves contain a serialized JSON input.
  try {const p=JSON.parse(v);if(p&&typeof p==='object')return JSON.stringify(clean(p))}catch{}
  return scrubText(v)
 }
 let text
 try{text=JSON.stringify(clean(JSON.parse(raw)),null,2)}catch{text=scrubText(raw)}
 return {text,changes,copyLabel:'Copy 脱敏文本（图片 base64 已省略；不截断其余内容）'}
}
export function createLlmTraceStore(root){
 async function record(source,id){
  const config=sources[source];if(!config||!uuid.test(id||''))throw Object.assign(Error('无效 Trace 标识'),{statusCode:400})
  const file=path.join(root,config.directory,id+'.json'),value=JSON.parse(await readFile(file,'utf8'))
  if(value.id!==id||(config.kind&&value.kind!==config.kind)||(config.task&&value.task!==config.task))throw Object.assign(Error('记录不是该来源的 LLM Trace'),{statusCode:404})
  return {value,file}
 }
 const meta=(source,r)=>({source,id:r.id,createdAt:r.createdAt,provider:r.provider??null,model:r.model??null,promptVersion:source==='reverse'?`${r.prompt_id??'Unknown'} · v${r.prompt_version??'Unknown'}`:r.promptVersion??null,status:r.status??null})
 return {async list(){
  const items=[];let unreadable=0
  for(const [source,config]of Object.entries(sources))for(const name of await readdir(path.join(root,config.directory)).catch(e=>{if(e.code==='ENOENT')return [];throw e})){
   if(!name.endsWith('.json')||!uuid.test(name.slice(0,-5)))continue
   // One file at a time; only metadata leaves the server, no full trace batch.
   try{const {value}=await record(source,name.slice(0,-5));items.push(meta(source,value))}catch(e){if(e.statusCode!==404)unreadable++}
  }
  return {items:items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||a.id.localeCompare(b.id)),unreadable}
 },async detail(source,id){
  const {value:r,file}=await record(source,id),prefix=file.slice(0,-5)
  async function raw(suffix){
   try{return {available:true,origin:path.basename(prefix+suffix),...shareText(await readFile(prefix+suffix,'utf8'))}}
   catch(e){if(e.code==='ENOENT')return {available:false,text:'unavailable · 未保存实际 wire 文件；不会使用准备请求或解析结果补齐。'};throw e}
  }
  const parsed=source==='reverse'?r.analysis:source==='build'?{parsedOutput:r.parsedOutput,plan:r.plan,validation:r.validation,error:r.error,source:r.source,generationSettings:r.generationSettings,usage:r.usageMetadata??null}:r.plan
  return {...meta(source,r),request:await raw('.request.json'),response:await raw('.response.txt'),parsed:parsed==null?{available:false,text:'unavailable · 未保存解析结果'}:{available:true,origin:path.basename(file)+(source==='reverse'?' # analysis':' # plan'),...shareText(JSON.stringify(parsed))}}
 }}
}
