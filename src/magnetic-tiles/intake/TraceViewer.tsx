import { useEffect, useRef, useState } from 'react'
import { intakeApi } from './api.ts'
export type TraceFileReference={mode:'2d'|'visible3d';tab:string;sourceId?:string;sourceHash?:string;analysisId?:string;analysisHash?:string;reviewId?:string;reviewHash?:string;planId?:string;planHash?:string;executionId?:string;executionHash?:string;reconstructionId?:string;requestId?:string}
type TraceLocation={available:boolean;primary:string|null;files:{role:string;path:string}[];missing:string[];note:string;message?:string}
export type TraceSource={identity:string;initialTab:string;tabs:[string,string][];load:(tab:string)=>Promise<unknown>;fileReference?:(tab:string)=>TraceFileReference}
// Small read-only modal following DUPLO's Trace Viewer pattern; no model actions.
export function TraceViewer({analysisId,reviewId,reconstructionId,diagnosticId,runtime,source,openRequest}:{analysisId?:string;reviewId?:string;reconstructionId?:string;diagnosticId?:string;runtime?:()=>unknown;source?:TraceSource;openRequest?:{tab:string;sequence:number}}){
 const [open,setOpen]=useState(false),[tab,setTab]=useState('parts'),[text,setText]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState('')
 const [loadedKey,setLoadedKey]=useState('')
 const [fileToolsUsed,setFileToolsUsed]=useState(false),[fileLocation,setFileLocation]=useState<{key:string;data:TraceLocation}|null>(null),[fileMessage,setFileMessage]=useState<{key:string;text:string;failed:boolean}|null>(null),[fileBusy,setFileBusy]=useState(false)
 const dataKey=JSON.stringify([source?.identity,tab,analysisId,reviewId,reconstructionId,diagnosticId])
 const currentKey=useRef(dataKey);currentKey.current=dataKey
 const resolvedFiles=useRef('')
 const fileReference=source?.fileReference?.(tab)??{mode:'2d' as const,tab,analysisId,reviewId,...(tab==='parts'?{}:{reconstructionId})}
 const fileReferenceKey=JSON.stringify(fileReference)
 async function locate(action:'files'|'reveal',reference:TraceFileReference){const r=await fetch('/api/magnetic-trace-files/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reference)});let data;try{data=await r.json()}catch{throw Error('文件定位需要本地开发服务，请通过 npm run dev 启动。')}if(!r.ok)throw Error(data.error??`文件定位失败：HTTP ${r.status}`);return data as TraceLocation}
 useEffect(()=>{
  if(!open||!fileToolsUsed||resolvedFiles.current===dataKey)return
  let live=true
  void locate('files',JSON.parse(fileReferenceKey)).then(data=>{if(live&&currentKey.current===dataKey){resolvedFiles.current=dataKey;setFileLocation({key:dataKey,data})}}).catch(e=>{if(live&&currentKey.current===dataKey)setFileMessage({key:dataKey,text:String(e),failed:true})})
  return()=>{live=false}
 },[open,fileToolsUsed,dataKey,fileReferenceKey])
 async function fileAction(action:'copy'|'reveal'){
  const key=dataKey;setFileBusy(true);setFileMessage(null)
  try{
   const data=await locate(action==='copy'?'files':'reveal',fileReference)
   if(currentKey.current!==key)return
   resolvedFiles.current=key;setFileLocation({key,data});setFileToolsUsed(true)
   if(!data.available||!data.primary)throw Error(data.note)
   if(action==='copy'){await navigator.clipboard.writeText(data.primary);if(currentKey.current===key)setFileMessage({key,text:'已复制完整路径：'+data.primary,failed:false})}
   else setFileMessage({key,text:data.message??'文件管理器请求已返回。',failed:false})
  }catch(e){if(currentKey.current===key){resolvedFiles.current='';setFileLocation(null);setFileToolsUsed(true);setFileMessage({key,text:String(e),failed:true})}}
  finally{setFileBusy(false)}
 }
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(open)dialog.current?.showModal()},[open])
 useEffect(()=>{if(openRequest){setTab(openRequest.tab);setOpen(true)}},[openRequest])
 useEffect(()=>{
  if(!open)return
  let live=true;setText('');setError('');setCopied('')
  setLoadedKey(dataKey)
  if(source){void source.load(tab).then(data=>{if(live)setText(typeof data==='string'?data:JSON.stringify(data,null,2))}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}}
  const parent=reviewId?'reviews/'+reviewId:analysisId?'analyses/'+analysisId:null
  const route=tab==='conflicts'?(reconstructionId&&diagnosticId?'reconstructions/'+reconstructionId+'/conflicts/'+diagnosticId:null):tab==='execution'?(reconstructionId?'reconstructions/'+reconstructionId:null):tab==='spatial'?(reconstructionId?'reconstructions/'+reconstructionId+'/planning':parent?parent+'/planning':null):parent
  if(!route){setText(tab==='execution'?'Not Run / 未选择 Reconstruction；没有执行输入或真实失败摆放。':'尚未选择已保存 Analysis / Review。');return}
  void intakeApi<{text:string}>('trace/'+route).then(data=>{if(live)setText(tab==='parts'&&runtime?JSON.stringify({saved:JSON.parse(data.text),runtime:{persisted:false,data:runtime()}},null,2):data.text)}).catch(e=>{if(live)setError(String(e))})
  return()=>{live=false}
 },[open,tab,analysisId,reviewId,reconstructionId,diagnosticId,runtime,source,dataKey])
 const current=loadedKey===dataKey
 const location=fileLocation?.key===dataKey?fileLocation.data:null,message=fileMessage?.key===dataKey?fileMessage:null
 return <><button className="trace-open" disabled={!source&&!analysisId} onClick={()=>{setTab(source?.initialTab??'parts');setOpen(true)}}>Trace / Raw</button>{open&&<dialog ref={dialog} className="magnetic-trace-dialog" aria-label="Magnetic Tiles Trace" onCancel={()=>setOpen(false)}><header><b>Trace / Raw · 只读</b><button onClick={()=>setOpen(false)}>关闭 Trace</button></header><nav aria-label="Trace 输出">{(source?.tabs??[['parts','Parts / Review'],['spatial','Spatial Planning'],['execution','Geometry Execution'],...(diagnosticId?[['conflicts','Candidate 冲突']]:[])]).map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav><p className="hint">Source / Analysis / Review / Execution 的 ID 与 Hash 见 JSON。只显示已保存或明确标注的运行时数据；图片 base64 / 凭据使用现有 Trace 脱敏策略。</p>{current&&error?<p role="alert">{error}</p>:<textarea aria-label="Trace JSON" spellCheck={false} readOnly value={current&&text?text:'读取中…'}/>}<footer><button disabled={!current||!text||!!error} onClick={()=>void navigator.clipboard.writeText(text).then(()=>setCopied('已复制完整文本'),()=>setCopied('复制失败，可在文本框中全选复制'))}>复制 Trace</button><button disabled={fileBusy} onClick={()=>void fileAction('reveal')}>打开所在目录</button><button disabled={fileBusy} onClick={()=>void fileAction('copy')}>复制完整路径</button><span role="status">{current?copied:''}</span></footer><section className="trace-file-location" aria-label="当前 Trace 文件位置"><p className="hint">仅限本机开发。打开的是服务端桌面；SSH / 端口转发不能定位浏览器所在机器。原始日志文件不经过弹窗的复制脱敏。</p>{message&&<p role={message.failed?'alert':'status'}>{message.text}</p>}{location&&<><p>{location.available?'主文件：'+location.primary:location.note}</p>{location.available&&<p className="hint">{location.note}</p>}<details><summary>相关文件 · {location.files.length}</summary>{location.files.map(f=><p key={f.path}>{f.role}：{f.path}</p>)}{location.missing.map((s,i)=><p key={i}>{s}</p>)}</details></>}</section></dialog>}</>
}
