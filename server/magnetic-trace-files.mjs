// Local debug only. Resolve saved IDs through existing lineage; never accept a
// filesystem path, trust a trace's absolute paths, or create/copy trace files.
import {readFile,realpath,stat} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {createHash} from 'node:crypto'
const exec=promisify(execFile),fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const idPattern=/^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/
const inside=(root,file)=>file===root||file.startsWith(root+path.sep)
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
export function assertLocalTraceRequest(request,enabled){
 if(!enabled)fail('文件定位仅在本地开发环境开放。',403)
 const address=request.socket?.remoteAddress??'',headers=request.headers??{}
 if(!/^(?:127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(address)||Object.keys(headers).some(k=>/^(?:forwarded|x-forwarded-.*|x-real-ip)$/i.test(k)))fail('仅允许本机直接访问；远程或代理访问不能打开服务端文件管理器。',403)
 let origin,host;try{origin=new URL(headers.origin);host=new URL(`${request.socket?.encrypted?'https':'http'}://${headers.host}`)}catch{fail('文件定位要求本机浏览器同源请求。',403)}
 if(!['localhost','127.0.0.1','[::1]'].includes(host.hostname)||origin.origin!==host.origin||headers['sec-fetch-site']&&headers['sec-fetch-site']!=='same-origin')fail('文件定位只接受 localhost / loopback 上的同源请求。',403)
}
export async function revealTraceFile(file,{run=exec,env=process.env,platform=process.platform}={}){
 if(platform!=='linux')fail('当前仅支持 Linux 桌面文件管理器。',503)
 if(!env.DBUS_SESSION_BUS_ADDRESS||!(env.DISPLAY||env.WAYLAND_DISPLAY))fail('服务端没有可用图形桌面或会话总线；无法打开文件管理器。',503)
 const call=(method,uri)=>run('gdbus',['call','--session','--dest','org.freedesktop.FileManager1','--object-path','/org/freedesktop/FileManager1','--method',`org.freedesktop.FileManager1.${method}`,JSON.stringify([uri]),''],{shell:false,timeout:5000,maxBuffer:64*1024,env})
 try{await call('ShowItems',pathToFileURL(file).href);return {method:'FileManager1.ShowItems',selected:true,message:'服务端桌面文件管理器已接受选中文件请求。'}}catch(first){
  try{await call('ShowFolders',pathToFileURL(path.dirname(file)).href);return {method:'FileManager1.ShowFolders',selected:false,message:'选中文件不可用；服务端桌面文件管理器已接受打开所在目录请求。'}}catch(second){fail('无法打开服务端文件管理器：'+String(second.stderr||second.message||first.message).slice(0,1500),503)}
 }
}
export function createMagneticTraceFiles({projectRoot,directory,intake,enabled=false,reveal=revealTraceFile}){
 async function resolve(body){
  const allowed=['mode','tab','sourceId','sourceHash','analysisId','analysisHash','reviewId','reviewHash','planId','planHash','executionId','executionHash','reconstructionId','requestId']
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail('只接受 Trace 阶段及记录 ID / Hash，不接受路径或命令。',400)
  if(!['2d','visible3d'].includes(body.mode)||!['parts','spatial','execution','conflicts'].includes(body.tab))fail('无效 Trace 阶段。',400)
  for(const [k,v]of Object.entries(body))if(k.endsWith('Id')||k.endsWith('Hash'))if(typeof v!=='string'||!idPattern.test(v))fail('无效记录 ID / Hash。',400)
  const root=await realpath(directory),project=await realpath(projectRoot);if(!inside(project,root))fail('Trace 存储目录不在当前项目内。',403)
  const files=[],missing=[]
  async function add(kind,id,role,required=false,suffix='.json'){
   if(!id)return null
   if(!idPattern.test(id))fail('存档中的文件标识无效。',400)
   const candidate=path.join(root,kind,id+suffix);let file
   try{file=await realpath(candidate);if(!inside(root,file)||!inside(project,file))fail('拒绝定位项目之外的文件或符号链接。',403);if(!(await stat(file)).isFile())fail('目标不是普通文件。',400)}catch(e){if(e.code==='ENOENT'){if(required)fail(`${role} 文件不存在。`,404);missing.push(`${role}：文件未保存或已不存在`);return null}throw e}
   if(!files.some(f=>f.path===file))files.push({role,path:file});return file
  }
  function check(record,name){if(body[name+'Id']&&record?.id!==body[name+'Id']||body[name+'Hash']&&record?.hash!==body[name+'Hash'])fail(`${name} ID / Hash 与当前 Trace 来源不一致。`,409)}
  async function traceFiles(id,required=true){const file=await add('visible3d/model-traces',id,'完整模型 Trace',required);if(file){await add('visible3d/model-traces',id,'实际 HTTP Request',false,'.request.json');await add('visible3d/model-traces',id,'实际 HTTP Raw Response',false,'.response.txt')}return file}
  let primary=null,note='仅定位已保存文件；未保存草稿、运行时匹配及派生检查没有独立文件。'
  if(body.mode==='visible3d'){
   const kind=body.tab==='parts'?(body.reviewId?'reviews':body.analysisId?'analyses':null):body.tab==='spatial'?(body.planId?'plans':body.reviewId?'reviews':null):(body.executionId?'executions':body.planId?'plans':null)
   let lineage=null
   if(kind){const id=body[kind==='analyses'?'analysisId':kind==='reviews'?'reviewId':kind==='plans'?'planId':'executionId'];await add('visible3d/'+kind,id,'当前阶段记录',true);lineage=await intake.dispatch('GET','visible3d/'+kind+'/'+id)}
   const review=lineage?.review,analysis=lineage?.analysis;let source=lineage?.source
   if(lineage){check(source,'source');check(analysis,'analysis');if(review)check(review,'review');if(kind==='plans')check(lineage.record,'plan');if(kind==='executions')check(lineage.record,'execution')}
   if(body.tab==='parts'){
    if(body.requestId){
     if(!body.sourceId||!body.sourceHash)fail('Analysis 请求需要准确的 Source ID / Hash。',409)
     source=source??await intake.dispatch('GET','sources/'+body.sourceId);check(source,'source')
     const requestPath=await add('visible3d/requests',body.requestId,'Analysis 请求记录',true),request=JSON.parse(await readFile(requestPath,'utf8'))
     if(request.id!==body.requestId||request.kind!=='analyze'||!request.trace?.sources?.some(s=>s.sourceId===source.id&&s.sourceHash===source.hash)||body.analysisId&&request.record?.id!==body.analysisId)fail('Analysis 请求缺少匹配的 Source 来源，不能定位其他记录。',409)
     primary=await traceFiles(request.trace.id);if(hash(JSON.parse(await readFile(primary,'utf8')))!==hash(request.trace))fail('请求与模型 Trace 内容不一致。',409)
    }else primary=kind?await add('visible3d/'+kind,lineage.record.id,kind==='reviews'?'Review 快照':'Vision Analysis',true):null
    if(analysis){await add('visible3d/analyses',analysis.id,'Vision Analysis',true);if(!body.requestId&&analysis.traceId)await traceFiles(analysis.traceId)}
   }else if(body.tab==='spatial'){
    if(body.requestId){
     const requestPath=await add('visible3d/requests',body.requestId,'Spatial Planning 请求记录',true),request=JSON.parse(await readFile(requestPath,'utf8'))
     if(request.id!==body.requestId||request.kind!=='plan'||!review||!request.trace?.sources?.some(s=>s.sourceId===source.id&&s.sourceHash===source.hash&&s.reviewId===review.id&&s.reviewHash===review.hash)||request.record&&body.planId&&request.record.id!==body.planId)fail('Planning 请求缺少匹配的 Source / Review 来源，不能定位其他记录。',409)
     primary=await traceFiles(request.trace.id);if(hash(JSON.parse(await readFile(primary,'utf8')))!==hash(request.trace))fail('请求与模型 Trace 内容不一致。',409)
    }else if(kind==='plans')primary=lineage.record.traceId?await traceFiles(lineage.record.traceId):await add('visible3d/plans',lineage.record.id,'人工 Plan',true)
    if(kind==='plans')await add('visible3d/plans',lineage.record.id,'Spatial Plan',true)
   }else{
    if(kind==='executions'){
     primary=await add('visible3d/executions',lineage.record.id,'Geometry Execution / Candidates / Diagnostic / Validator',true)
     await add('visible3d/plans',lineage.record.planId,'执行来源 Plan',true);const p=(await intake.dispatch('GET','visible3d/plans/'+lineage.record.planId)).record;check(p,'plan')
    }else if(body.requestId&&kind==='plans'){
     primary=await add('visible3d/requests',body.requestId,'Geometry Execution 请求',true);const r=JSON.parse(await readFile(primary,'utf8'));if(r.id!==body.requestId||r.kind!=='execute'||r.planId!==lineage.record.id||r.record&&r.record.planId!==lineage.record.id)fail('执行请求不属于当前 Plan。',409)
    }
    if(body.requestId&&kind==='executions'){
     const file=await add('visible3d/requests',body.requestId,'Geometry Execution 请求',true),r=JSON.parse(await readFile(file,'utf8'))
     if(r.id!==body.requestId||r.kind!=='execute'||r.planId!==lineage.record.planId||r.record&&r.record.id!==lineage.record.id)fail('执行请求与所选 Execution 不一致。',409)
    }
   }
   if(review)await add('visible3d/reviews',review.id,'来源 Review',true)
   if(source){await add('sources',source.id,'来源图片与证据身份',true);await add('assets',source.originalHash,'原始图片资产');await add('assets',source.view.hash,'识别图片资产')}
  }else{
   let review=null,analysis=null,source=null,reconstruction=null
   if(body.reconstructionId){await add('reconstructions',body.reconstructionId,'2D Reconstruction',true);const r=await intake.result(body.reconstructionId);reconstruction=r.reconstruction;review=r.review;source=r.source;analysis=await intake.read('analyses',review.analysisId)}
   else if(body.reviewId){await add('reviews',body.reviewId,'2D Review',true);await intake.dispatch('GET','trace/reviews/'+body.reviewId);review=await intake.read('reviews',body.reviewId);analysis=await intake.read('analyses',review.analysisId);source=await intake.read('sources',analysis.sourceId)}
   else if(body.analysisId){await add('analyses',body.analysisId,'2D Analysis',true);await intake.dispatch('GET','trace/analyses/'+body.analysisId);analysis=await intake.read('analyses',body.analysisId);source=await intake.read('sources',analysis.sourceId)}
   if(analysis)check(analysis,'analysis');if(review)check(review,'review');if(source)check(source,'source')
   if(body.tab==='parts')primary=review?await add('reviews',review.id,'2D Review',true):analysis?await add('analyses',analysis.id,'2D Vision Analysis',true):null
   else if(reconstruction)primary=await add('reconstructions',reconstruction.id,'2D Execution / Planning / Diagnostic',true)
   else if(body.tab==='spatial')note='当前 2D Spatial Planning 是运行时证据推导，尚无已保存的 Reconstruction Trace 文件。'
   if(analysis)await add('analyses',analysis.id,'2D Vision Analysis',true)
   if(review)await add('reviews',review.id,'2D Review',true)
   if(source){await add('sources',source.id,'来源图片与证据身份',true);await add('assets',source.originalHash,'原始图片资产');await add('assets',source.view.hash,'识别图片资产')}
  }
  return {available:!!primary,primary,files,missing,note:primary?note:'当前 Tab 尚无已保存的阶段文件。'+note}
 }
 return {async dispatch(request,action,body){assertLocalTraceRequest(request,enabled);if(request.method!=='POST'||!['files','reveal'].includes(action))fail('仅支持本地文件定位操作。',405);let location;try{location=await resolve(body)}catch(e){if(e.code==='ENOENT')fail('所选 Trace / 来源文件不存在，未打开其他记录。',404);throw e}if(action==='files')return location;if(!location.available)fail(location.note,404);return {...location,...await reveal(location.primary)}}}
}
