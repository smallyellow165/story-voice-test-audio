import {useEffect,useRef,useState} from 'react'
import {intakeApi,prepareSourceImage} from './api.ts'
import type {SourceImageSelection} from './api.ts'
import type {Source} from './contracts.ts'
import {sourceImages,imageRoles,imageDirections} from './image-set.ts'
import type {AnalysisImage} from './image-set.ts'
import {SourceThumbnail,clearLibraryImageCache} from './SourceImages.tsx'
import './source-images.css'
/** One immutable Source collection, shared across tabs; workflows retain independent histories. */
export function SourceImagePicker({sourceType,onSourceTypeChange,currentSource,onSource,onOpenSource,disabled,onPendingChange,onSelectImage,activeImageId}:{
 sourceType:''|'upload'|'server';onSourceTypeChange:(type:'upload'|'server')=>void;currentSource:Source|null
 onPendingChange:(value:boolean)=>void;onSelectImage:(id:string)=>void;activeImageId:string
 onSource:(source:Source|null)=>Promise<void>;onOpenSource:(id:string)=>void;disabled:boolean
}){
 const file=useRef<HTMLInputElement>(null),lock=useRef(false)
 const [library,setLibrary]=useState<{name:string;mimeType:string}[]>([]),[sources,setSources]=useState<Source[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const [libraryRevision,setLibraryRevision]=useState(0)
 const entries=sourceImages(currentSource),blocked=disabled||loading
 async function action(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setLoading(true);onPendingChange(true);setError('');try{await work()}catch(e){setError(String(e))}finally{lock.current=false;setLoading(false);onPendingChange(false)}}
 async function refreshLibrary(){clearLibraryImageCache();const r=await intakeApi<{images:typeof library}>('library');setLibrary(r.images);setLibraryRevision(n=>n+1)}
 useEffect(()=>{if(sourceType==='server')void action(refreshLibrary)},[sourceType])
 async function publish(next:AnalysisImage[]){if(!next.length){await onSource(null);return}await onSource(await intakeApi<Source>('source-sets',{images:next}))}
 async function add(selections:SourceImageSelection[]){
  if(entries.length+selections.length>4)throw Error('每次 Analysis 最多 4 张图片；请先移除不需要的图片')
  const next=[...entries]
  for(const selection of selections){const s=await intakeApi<Source>('sources',await prepareSourceImage(selection));if(next.some(e=>e.sourceId===s.id))throw Error('该图片已在本次 Analysis 中');next.push({...sourceImages(s)[0],name:selection.kind==='server'?selection.name:selection.file.name,origin:selection.kind})}
  await publish(next)
 }
 function update(index:number,patch:Partial<AnalysisImage>){void action(()=>publish(entries.map((e,i)=>i===index?{...e,...patch}:e)))}
 return <div className="source-image-picker">
  <div role="tablist" aria-label="图片来源" className="source-tabs">{(['upload','server'] as const).map(t=><button key={t} role="tab" aria-selected={(sourceType||'upload')===t} disabled={blocked} onClick={()=>onSourceTypeChange(t)}>{t==='upload'?'上传图片':'服务器图片'}</button>)}</div>
  {sourceType!=='server'?<div role="tabpanel" aria-label="上传图片"><button disabled={blocked||entries.length>=4} onClick={()=>file.current?.click()}>上传磁力片图片</button><input data-testid="intake-upload" aria-label="上传磁力片图片文件" hidden multiple ref={file} type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)void action(()=>add(files.map(file=>({kind:'upload',file}))))}}/>
   <details><summary>重新打开图片集合</summary><select aria-label="已有图片来源" value={currentSource?.id??''} disabled={blocked} onFocus={()=>void intakeApi<{sources:Source[]}>('history').then(h=>setSources(h.sources)).catch(e=>setError(String(e)))} onChange={e=>{if(e.target.value)onOpenSource(e.target.value)}}><option value="">选择图片快照</option>{currentSource&&!sources.some(s=>s.id===currentSource.id)&&<option value={currentSource.id}>{currentSource.name}</option>}{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}</select></details></div>:<div role="tabpanel" aria-label="服务器图片"><div className="source-library-row"><input aria-label="搜索服务器图片" placeholder="搜索文件名" value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={blocked} onClick={()=>void action(refreshLibrary)} aria-label="刷新 Server Library">刷新</button></div><div className="source-library-list"><table><tbody>{library.filter(e=>e.name.toLowerCase().includes(query.toLowerCase())).map(item=>{const checked=entries.some(e=>e.name===item.name&&e.origin==='server');return <tr key={item.name+libraryRevision}><td><SourceThumbnail id={item.name} library/></td><td><label>{item.name}<input aria-label={'加入 '+item.name} type="checkbox" checked={checked} disabled={blocked||!checked&&entries.length>=4} onChange={()=>void action(()=>checked?publish(entries.filter(e=>e.name!==item.name||e.origin!=='server')):add([{kind:'server',name:item.name}]))}/></label></td></tr>})}</tbody></table></div>{!library.length&&!loading&&<p>图库暂无图片。</p>}</div>}
  <div className="source-set-heading"><b>本次 Analysis · {entries.length}/4</b><small>选择图片不会调用模型</small></div>
  <p className="hint">首张 Final 作为主图；未指定时使用第一张。角色、方向和备注均可留空。</p><ol className="source-set-list">{entries.map((e,i)=><li key={e.sourceId}><div className="source-set-item"><button className="source-set-select" aria-label={"查看 "+e.name} aria-pressed={activeImageId===e.sourceId} onClick={()=>onSelectImage(e.sourceId)}><SourceThumbnail id={e.sourceId}/></button><span className="source-set-name" title={e.name}>{i+1}. {e.name}<small>{e.origin==='upload'?'上传图片':e.origin==='server'?'服务器图片':'历史图片'}</small></span><button aria-label={'上移 '+e.name} disabled={blocked||i===0} onClick={()=>void action(()=>{const n=[...entries];[n[i-1],n[i]]=[n[i],n[i-1]];return publish(n)})}>↑</button><button aria-label={'下移 '+e.name} disabled={blocked||i===entries.length-1} onClick={()=>void action(()=>{const n=[...entries];[n[i+1],n[i]]=[n[i],n[i+1]];return publish(n)})}>↓</button><button aria-label={'移除 '+e.name} disabled={blocked} onClick={()=>void action(()=>publish(entries.filter((_,j)=>j!==i)))}>×</button></div><details className="source-image-metadata"><summary>{e.role} · {e.direction}{e.note?' · 已备注':' · 可选元数据'}</summary><div className="source-set-meta"><label>角色<select aria-label={'图片角色 '+e.name} disabled={blocked} value={e.role} onChange={v=>update(i,{role:v.target.value as AnalysisImage['role']})}>{imageRoles.map(v=><option key={v}>{v}</option>)}</select></label><label>方向<select aria-label={'拍摄方向 '+e.name} disabled={blocked} value={e.direction} onChange={v=>update(i,{direction:v.target.value as AnalysisImage['direction']})}>{imageDirections.map(v=><option key={v}>{v}</option>)}</select></label></div><input key={e.sourceId+e.note} aria-label={'图片备注 '+e.name} placeholder="备注（可选，失焦保存）" maxLength={500} defaultValue={e.note} disabled={blocked} onBlur={v=>{if(v.target.value!==e.note)update(i,{note:v.target.value})}}/></details></li>)}</ol>
  {loading&&<p role="status">正在保存图片集合…</p>}{error&&<p role="alert">{error}</p>}
 </div>
}
