import {useEffect,useRef,useState} from 'react'
import {intakeApi} from './api.ts'
import type {SourceImageSelection} from './api.ts'
import type {Source} from './contracts.ts'

type SourceType=''|'upload'|'server'
/** Shared resource picker only. Each workflow owns opening the Source and its
 * separate Analysis/Review state. Choosing a resource never invokes Vision. */
export function SourceImagePicker({sourceType,onSourceTypeChange,currentSource,serverImage,onImage,onOpenSource,disabled}:{
 sourceType:SourceType;onSourceTypeChange:(type:'upload'|'server')=>void;currentSource:Source|null;serverImage:string
 onImage:(selection:SourceImageSelection)=>void;onOpenSource:(id:string)=>void;disabled:boolean
}){
 const file=useRef<HTMLInputElement>(null)
 const [library,setLibrary]=useState<{name:string;mimeType:string}[]>([]),[sources,setSources]=useState<Source[]>([])
 const [error,setError]=useState(''),[loading,setLoading]=useState(false)
 useEffect(()=>{
  if(sourceType!=='server')return
  let live=true;setLoading(true);setError('')
  void intakeApi<{images:typeof library}>('library').then(r=>{if(live)setLibrary(r.images)}).catch(e=>{if(live)setError('服务器图库加载失败：'+String(e))}).finally(()=>{if(live)setLoading(false)})
  return()=>{live=false}
 },[sourceType])
 async function refreshLibrary(){setLoading(true);setError('');try{const r=await intakeApi<{images:typeof library}>('library');setLibrary(r.images)}catch(e){setError('服务器图库加载失败：'+String(e))}finally{setLoading(false)}}
 async function refreshSources(){try{const h=await intakeApi<{sources:Source[]}>('history');setSources(h.sources);setError('')}catch(e){setError('已保存图片读取失败：'+String(e))}}
 return <div className="source-image-picker">
  <label className="compact-field">图片来源<select aria-label="图片来源" disabled={disabled} value={sourceType} onChange={e=>onSourceTypeChange(e.target.value as 'upload'|'server')}><option value="" disabled>选择图片来源</option><option value="upload">上传图片（Uploaded Images）</option><option value="server">服务器图片（Server Images）</option></select></label>
  {sourceType==='server'&&<>
   <div className="source-library-row"><label className="compact-field">服务器图片<select aria-label="服务器图片" disabled={disabled||loading} value={serverImage} onChange={e=>{if(e.target.value)onImage({kind:'server',name:e.target.value})}}><option value="">选择服务器图片</option>{library.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button disabled={disabled||loading} onClick={()=>void refreshLibrary()} aria-label="刷新 Server Library" title="刷新服务器图库">刷新</button></div>
   {loading?<p role="status">正在读取服务器图片…</p>:!library.length&&<p role="status">图库暂无图片。</p>}
  </>}
  <div className="button-row"><button disabled={disabled} onClick={()=>file.current?.click()}>上传磁力片图片</button><input data-testid="intake-upload" aria-label="上传磁力片图片文件" hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e=>{const chosen=e.target.files?.[0];e.target.value='';if(chosen)onImage({kind:'upload',file:chosen})}}/></div>
  {sourceType==='upload'&&<label className="compact-field">已保存图片<select aria-label="已有图片来源" value={currentSource?.id??''} disabled={disabled} onFocus={()=>void refreshSources()} onChange={e=>{if(e.target.value)onOpenSource(e.target.value)}}><option value="">选择图片快照</option>{currentSource&&!sources.some(s=>s.id===currentSource.id)&&<option value={currentSource.id}>{currentSource.name} · {currentSource.id.slice(0,8)}</option>}{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}</select></label>}
  {error&&<p role="alert">{error}</p>}
 </div>
}
