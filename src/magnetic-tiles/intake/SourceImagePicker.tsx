import {libraryContents,libraryBasename} from './library-browser.ts'
import type {LibraryImage} from './library-browser.ts'
import {currentWorkspace} from '../workspace-context.ts'
import {useEffect,useId,useRef,useState} from 'react'
import {intakeApi,prepareSourceImage} from './api.ts'
import type {SourceImageSelection} from './api.ts'
import type {Source} from './contracts.ts'
import {sourceImages,imageRoles,imageDirections} from './image-set.ts'
import type {AnalysisImage} from './image-set.ts'
import {SourceThumbnail,clearLibraryImageCache} from './SourceImages.tsx'
import './source-images.css'

/** Use the same native popover as Review, above the table's scroll container. */
function ImageActions({name,disabled,first,last,onMove,onRemove}:{name:string;disabled:boolean;first:boolean;last:boolean;onMove:(offset:number)=>void;onRemove:()=>void}){
 const id=useId(),menu=useRef<HTMLDivElement>(null),[position,setPosition]=useState({top:0,left:0})
 useEffect(()=>{
  const close=()=>menu.current?.hidePopover()
  window.addEventListener('resize',close);document.addEventListener('scroll',close,true)
  return()=>{window.removeEventListener('resize',close);document.removeEventListener('scroll',close,true)}
 },[])
 function run(work:()=>void){menu.current?.hidePopover();work()}
 return <>
  <button className="source-image-actions-trigger" aria-label={'更多操作 '+name} aria-haspopup="menu" popoverTarget={id} disabled={disabled} onClick={e=>{
   const r=e.currentTarget.getBoundingClientRect()
   setPosition({top:Math.max(8,Math.min(r.bottom+4,window.innerHeight-128)),left:Math.max(8,Math.min(r.right-128,window.innerWidth-136))})
  }}>···</button>
  <div ref={menu} id={id} popover="auto" role="menu" aria-label={'图片操作 '+name} className="source-image-actions" style={position}>
   <button role="menuitem" aria-label={'上移 '+name} disabled={disabled||first} onClick={()=>run(()=>onMove(-1))}>上移</button>
   <button role="menuitem" aria-label={'下移 '+name} disabled={disabled||last} onClick={()=>run(()=>onMove(1))}>下移</button>
   <button role="menuitem" aria-label={'移除 '+name} disabled={disabled} onClick={()=>run(onRemove)}>删除</button>
  </div>
 </>
}
/** One immutable Source collection, shared across tabs; workflows retain independent histories. */
export function SourceImagePicker({sourceType,onSourceTypeChange,currentSource,onSource,onOpenSource,disabled,onPendingChange,onSelectImage,activeImageId}:{
 sourceType:''|'upload'|'server';onSourceTypeChange:(type:'upload'|'server')=>void;currentSource:Source|null
 onPendingChange:(value:boolean)=>void;onSelectImage:(id:string)=>void;activeImageId:string
 onSource:(source:Source|null)=>Promise<void>;onOpenSource:(id:string)=>void;disabled:boolean
}){
 const file=useRef<HTMLInputElement>(null),lock=useRef(false)
 const [library,setLibrary]=useState<LibraryImage[]>([]),[sources,setSources]=useState<Source[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const [folder,setFolder]=useState(''),[folders,setFolders]=useState<string[]>([])
 const [libraryRevision,setLibraryRevision]=useState(0)
 const entries=sourceImages(currentSource),blocked=disabled||loading,activeSourceType=sourceType||'server'
 const contents=libraryContents(library,folders,folder,query),crumbs=folder?folder.split('/').map((name,i,parts)=>({name,path:parts.slice(0,i+1).join('/')})):[]
 async function action(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setLoading(true);onPendingChange(true);setError('');try{await work()}catch(e){setError(String(e))}finally{lock.current=false;setLoading(false);onPendingChange(false)}}
 async function refreshLibrary(){clearLibraryImageCache();const r=await intakeApi<{images:LibraryImage[];folders?:string[]}>('library');setLibrary(r.images);setFolders(r.folders??[]);setFolder(current=>(r.folders??[]).includes(current)?current:'');setLibraryRevision(n=>n+1)}
 useEffect(()=>{if(activeSourceType==='server')void action(refreshLibrary)},[activeSourceType])
 async function publish(next:AnalysisImage[]){if(!next.length){await onSource(null);return}await onSource(await intakeApi<Source>('source-sets',{images:next}))}
 async function add(selections:SourceImageSelection[]){
  if(entries.length+selections.length>4)throw Error('每次 Analysis 最多 4 张图片；请先移除不需要的图片')
  const next=[...entries]
  for(const selection of selections){const s=await intakeApi<Source>('sources',await prepareSourceImage(selection));if(next.some(e=>e.sourceId===s.id))throw Error('相同图片内容已在本次 Analysis 中：'+next.find(e=>e.sourceId===s.id)!.name);next.push({...sourceImages(s)[0],name:selection.kind==='server'?selection.name:selection.file.name,origin:selection.kind})}
  await publish(next)
 }
 function update(index:number,patch:Partial<AnalysisImage>){void action(()=>publish(entries.map((e,i)=>i===index?{...e,...patch}:e)))}
 return <div className="source-image-picker">
  <div role="tablist" aria-label="图片来源" className="source-tabs">{(['upload','server'] as const).map(t=><button key={t} role="tab" aria-selected={activeSourceType===t} disabled={blocked} onClick={()=>onSourceTypeChange(t)}>{t==='upload'?'上传图片':'服务器图片'}</button>)}</div>
  {activeSourceType!=='server'?<div role="tabpanel" aria-label="上传图片"><button disabled={blocked||entries.length>=4} onClick={()=>file.current?.click()}>上传磁力片图片</button><input data-testid="intake-upload" aria-label="上传磁力片图片文件" hidden multiple ref={file} type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)void action(()=>add(files.map(file=>({kind:'upload',file}))))}}/>
   <details hidden={!!currentWorkspace()}><summary>重新打开图片集合</summary><select aria-label="已有图片来源" value={currentSource?.id??''} disabled={blocked} onFocus={()=>void intakeApi<{sources:Source[]}>('history').then(h=>setSources(h.sources)).catch(e=>setError(String(e)))} onChange={e=>{if(e.target.value)onOpenSource(e.target.value)}}><option value="">选择图片快照</option>{currentSource&&!sources.some(s=>s.id===currentSource.id)&&<option value={currentSource.id}>{currentSource.name}</option>}{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}</select></details></div>:<div role="tabpanel" aria-label="服务器图片" className="source-library-panel">
   <div className="source-library-row"><input aria-label="搜索服务器图片" placeholder="搜索文件名或路径" value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={blocked} onClick={()=>void action(refreshLibrary)} aria-label="刷新 Server Library">刷新</button></div>
   {(folder||query.trim())&&<nav className="source-library-breadcrumbs" aria-label="服务器图片文件夹">{folder&&<button disabled={blocked} onClick={()=>{setFolder('');setQuery('')}}>图库</button>}{crumbs.map(c=><span key={c.path}><span aria-hidden="true">/</span><button disabled={blocked} title={c.path} aria-current={c.path===folder?'location':undefined} onClick={()=>{setFolder(c.path);setQuery('')}}>{c.name}</button></span>)}{query.trim()&&<small>搜索全部文件夹 · {contents.images.length} 张</small>}</nav>}
   <div className="source-library-list" role="region" aria-label="服务器图片列表" tabIndex={0}>
    {contents.folders.map(name=><button key={name} className="source-library-folder" disabled={blocked} aria-label={'打开文件夹 '+name} title={name} onClick={()=>setFolder(name)}><span aria-hidden="true">▸</span><span>{libraryBasename(name)}</span><small>文件夹</small></button>)}
    <table><tbody>{contents.images.map(item=>{const checked=entries.some(e=>e.name===item.name&&e.origin==='server');return <tr key={item.name+libraryRevision}><td><SourceThumbnail id={item.name} library/></td><td><label title={item.name}><span className="source-library-name">{query.trim()?item.name:libraryBasename(item.name)}</span><input aria-label={'加入 '+item.name} type="checkbox" checked={checked} disabled={blocked||!checked&&entries.length>=4} onChange={()=>void action(()=>checked?publish(entries.filter(e=>e.name!==item.name||e.origin!=='server')):add([{kind:'server',name:item.name}]))}/></label></td></tr>})}</tbody></table>
    {!loading&&!contents.images.length&&!contents.folders.length&&<p className="source-library-empty">{query.trim()?'没有匹配的图片。':'此文件夹暂无图片。'}</p>}
   </div>
  </div>}

  <div className="source-set-heading"><b>本次 Analysis · {entries.length}/4</b><small>最多 4 张 · 可跨文件夹</small></div>
  {!!entries.length&&<p className="source-set-hint">首张 Final 为主图，否则使用第一张；元数据可留空。</p>}
  {!!entries.length&&<div className="source-set-table-scroll" role="region" aria-label="本次 Analysis 图片列表" tabIndex={0}>
   <table className="source-set-table" aria-label="本次 Analysis 图片">
    <colgroup><col className="source-image-column"/><col className="source-role-column"/><col className="source-direction-column"/><col className="source-note-column"/><col className="source-actions-column"/></colgroup>
    <thead><tr><th scope="col">图片</th><th scope="col">角色</th><th scope="col">方向</th><th scope="col">备注</th><th scope="col">操作</th></tr></thead>
    <tbody>{entries.map((e,i)=><tr key={e.sourceId}>
     <td><button className="source-set-select" aria-label={'查看 '+e.name} aria-pressed={activeImageId===e.sourceId} title={e.name+' · '+(e.origin==='upload'?'上传图片':e.origin==='server'?'服务器图片':'历史图片')} onClick={()=>onSelectImage(e.sourceId)}><span className="source-image-order">{i+1}.</span><SourceThumbnail id={e.sourceId}/><span className="source-set-name">{e.name}</span></button></td>
     <td><select aria-label={'图片角色 '+e.name} title={e.role} disabled={blocked} value={e.role} onChange={v=>update(i,{role:v.target.value as AnalysisImage['role']})}>{imageRoles.map(v=><option key={v}>{v}</option>)}</select></td>
     <td><select aria-label={'拍摄方向 '+e.name} title={e.direction} disabled={blocked} value={e.direction} onChange={v=>update(i,{direction:v.target.value as AnalysisImage['direction']})}>{imageDirections.map(v=><option key={v}>{v}</option>)}</select></td>
     <td><input key={e.sourceId+e.note} aria-label={'图片备注 '+e.name} title={e.note||'可选备注，失焦保存'} placeholder="可选" maxLength={500} defaultValue={e.note} disabled={blocked} onBlur={v=>{if(v.target.value!==e.note)update(i,{note:v.target.value})}}/></td>
     <td><ImageActions name={e.name} disabled={blocked} first={i===0} last={i===entries.length-1} onMove={offset=>void action(()=>{const n=[...entries];[n[i+offset],n[i]]=[n[i],n[i+offset]];return publish(n)})} onRemove={()=>void action(()=>publish(entries.filter((_,j)=>j!==i)))}/></td>
    </tr>)}</tbody>
   </table>
  </div>}
  {loading&&<p role="status">正在处理图片…</p>}{error&&<p role="alert">{error}</p>}
 </div>
}
