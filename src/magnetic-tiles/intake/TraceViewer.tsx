import { useEffect, useRef, useState } from 'react'
import { intakeApi } from './api.ts'
// Small read-only modal following DUPLO's Trace Viewer pattern; no model actions.
export function TraceViewer({analysisId,reviewId,reconstructionId,diagnosticId,runtime}:{analysisId?:string;reviewId?:string;reconstructionId?:string;diagnosticId?:string;runtime?:()=>unknown}){
 const [open,setOpen]=useState(false),[tab,setTab]=useState('parts'),[text,setText]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState('')
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(open)dialog.current?.showModal()},[open])
 useEffect(()=>{
  if(!open)return
  let live=true;setText('');setError('');setCopied('')
  const parent=reviewId?'reviews/'+reviewId:analysisId?'analyses/'+analysisId:null
  const route=tab==='conflicts'?(reconstructionId&&diagnosticId?'reconstructions/'+reconstructionId+'/conflicts/'+diagnosticId:null):tab==='execution'?(reconstructionId?'reconstructions/'+reconstructionId:null):tab==='spatial'?(reconstructionId?'reconstructions/'+reconstructionId+'/planning':parent?parent+'/planning':null):parent
  if(!route){setText(tab==='execution'?'Not Run / 未选择 Reconstruction；没有执行输入或真实失败摆放。':'尚未选择已保存 Analysis / Review。');return}
  void intakeApi<{text:string}>('trace/'+route).then(data=>{if(live)setText(tab==='parts'&&runtime?JSON.stringify({saved:JSON.parse(data.text),runtime:{persisted:false,data:runtime()}},null,2):data.text)}).catch(e=>{if(live)setError(String(e))})
  return()=>{live=false}
 },[open,tab,analysisId,reviewId,reconstructionId,diagnosticId,runtime])
 return <><button className="trace-open" disabled={!analysisId} onClick={()=>{setTab('parts');setOpen(true)}}>Trace / Raw</button>{open&&<dialog ref={dialog} className="magnetic-trace-dialog" aria-label="Magnetic Tiles Trace" onCancel={()=>setOpen(false)}><header><b>Trace / Raw · 只读</b><button onClick={()=>setOpen(false)}>关闭 Trace</button></header><nav aria-label="Trace 输出">{[['parts','Parts / Review'],['spatial','Spatial Planning'],['execution','Geometry Execution'],...(diagnosticId?[['conflicts','Candidate 冲突']]:[])].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav><p className="hint">Source / Analysis / Review / Execution 的 ID 与 Hash 见 JSON。只显示已保存或明确标注的运行时数据；图片 base64 / 凭据使用现有 Trace 脱敏策略。</p>{error?<p role="alert">{error}</p>:<textarea aria-label="Trace JSON" spellCheck={false} readOnly value={text||'读取中…'}/>}<footer><button disabled={!text} onClick={()=>void navigator.clipboard.writeText(text).then(()=>setCopied('已复制完整文本'),()=>setCopied('复制失败，可在文本框中全选复制'))}>复制 Trace</button><span role="status">{copied}</span></footer></dialog>}</>
}
