import {workflowTerms} from './studio-terms.ts'
import {InfoHint} from '../brick-vision/InfoHint.tsx'
import {readStudioUrl,useUrlRequest,writeStudioUrl} from './studio-url.ts'
import {AssemblyPreview} from './AssemblyPreview.tsx'
import {assemblySaveStatus,sameAssemblyContents} from './assembly-source.ts'
import {StudioSlot,useStudio} from './StudioLayout.tsx'
import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {BuildPlayer} from './BuildPlayer.tsx'
import {canonical,contentHash,generateBuild} from './build-plan.ts'
import type {BuildProgress} from './build-plan.ts'
import {BUILD_KEY,bundleFor,emptyLibrary,loadLibrary,saveLibrary,storeBundle,retainBuildPreview} from './build-storage.ts'
import type {BuildLibrary} from './build-storage.ts'
import {buildHistory,buildSaveState,matchingBuild} from './build-context.ts'
import type {Assembly,Profile} from './geometry.ts'
import {checkArtwork,modeLabel,workMode} from './artwork.ts'
function download(value:string,name:string){const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function BuildPanel({assembly,savedAssemblies,workspaceError,profiles,dragging,sourceContextId}:{assembly:Assembly;savedAssemblies:readonly Assembly[];workspaceError:string;profiles:readonly Profile[];dragging:boolean;sourceContextId?:string|null}){
 const {stage,navigate}=useStudio(),urlRequest=useUrlRequest()
 const [sourceId,setSourceId]=useState('current'),[library,setLibrary]=useState<BuildLibrary>(emptyLibrary),[loaded,setLoaded]=useState(false)
 const [busy,setBusy]=useState(true),[restoring,setRestoring]=useState(false),[blocked,setBlocked]=useState(false),[notice,setNotice]=useState('正在读取教程…'),[error,setError]=useState(''),[selectedId,setSelectedId]=useState('')
 const [playback,setPlayback]=useState<{id:string;scope:string;request?:typeof urlRequest}|null>(null)
 const source=sourceId==='current'?assembly:savedAssemblies.find(a=>a.id===sourceId.slice(6)),scope=source?canonical(source):'missing:'+sourceId
 const libraryRef=useRef(library),scopeRef=useRef(scope),requestRef=useRef(urlRequest),epoch=useRef(0),lock=useRef(true),pending=useRef<Promise<void>|null>(null),bootProfiles=useRef(profiles),file=useRef<HTMLInputElement>(null)
 libraryRef.current=library;scopeRef.current=scope;requestRef.current=urlRequest
 const updateLibrary=(l:BuildLibrary)=>{libraryRef.current=l;setLibrary(l)}
 const clearPlayback=()=>{epoch.current++;setPlayback(null);writeStudioUrl({buildId:undefined})}
 const previousStage=useRef(stage),enteredRequest=useRef<typeof urlRequest|null>(null),previousSource=useRef(sourceContextId),previousScope=useRef(scope)
 useLayoutEffect(()=>{
  const entering=stage==='build'&&previousStage.current!=='build',first=stage==='build'&&enteredRequest.current===null
  if(entering||first){
   const requested=readStudioUrl(urlRequest.href).values,explicit=requested.buildId&&requested.stage==='build'&&enteredRequest.current!==urlRequest
   enteredRequest.current=urlRequest
   if(!explicit){setSourceId('current');clearPlayback();setNotice('先查看当前作品，再生成或继续对应教程。')}
  }
  previousStage.current=stage
 },[stage,urlRequest])
 useLayoutEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;const incoming=readStudioUrl(urlRequest.href).values,actual=readStudioUrl(location.href).values;if(!(incoming.buildId&&incoming.buildId===actual.buildId&&actual.stage==='build')){clearPlayback();setNotice('作品来源或版本已切换；教程和进度仍保留在历史中。')}}},[scope,urlRequest])
 useLayoutEffect(()=>{
  const old=previousSource.current;previousSource.current=sourceContextId
  if(old!==sourceContextId){
   const incoming=readStudioUrl(urlRequest.href).values
   if(!(incoming.buildId&&incoming.sourceId===sourceContextId&&readStudioUrl(location.href).values.buildId===incoming.buildId)){clearPlayback();setNotice('图片上下文已切换，请确认当前作品后打开对应教程。')}
  }
 },[sourceContextId,urlRequest])
 useEffect(()=>{let alive=true;loadLibrary(localStorage,bootProfiles.current).then(l=>{if(alive){updateLibrary(l);setNotice('当前作品的教程可直接继续；其他教程请从历史中主动打开。')}}).catch(e=>{if(alive){setBlocked(true);setError('无法恢复教程，原存档未覆盖：'+String(e))}}).finally(()=>{if(alive){lock.current=false;setBusy(false);setLoaded(true)}});return()=>{alive=false}},[])
 async function activate(l:BuildLibrary,id:string){const b=bundleFor(l,id);if(!b)throw Error('教程不存在');if(!l.progress[id])l.progress[id]={planHash:await contentHash(b.plan),step:0,completed:false};l.activeId=id;return l}
 useEffect(()=>{
  if(!loaded)return
  const {values:v,errors}=readStudioUrl(urlRequest.href)
  if(errors.length){setRestoring(false);return}
  if(!v.buildId||v.stage!=='build'){setPlayback(null);setRestoring(false);return}
  let alive=true;setRestoring(true)
  setSourceId('current')
  void(async()=>{
   if(pending.current)await pending.current
   if(!alive)return
   const l=await activate(structuredClone(libraryRef.current),v.buildId!)
   if(alive&&requestRef.current===urlRequest&&readStudioUrl(location.href).values.buildId===v.buildId){updateLibrary(l);setPlayback({id:v.buildId!,scope:scopeRef.current,request:urlRequest});setSelectedId(v.buildId!);setError('');setNotice('已按 URL 恢复指定教程及其进度；固定作品来源见下方。')}
  })().catch(e=>{if(alive){setPlayback(null);setError('URL 教程恢复失败：'+String(e))}}).finally(()=>{if(alive)setRestoring(false)})
  return()=>{alive=false}
 },[loaded,urlRequest])
 async function run(action:(l:BuildLibrary)=>Promise<BuildLibrary>,message:string,open=false){
  if(lock.current||blocked||restoring)return
  lock.current=true;setBusy(true);setError('')
  const startScope=scopeRef.current,startEpoch=epoch.current,startRequest=requestRef.current
  const operation=(async()=>{
   try{
    const next=await saveLibrary(localStorage,await action(structuredClone(libraryRef.current)),profiles);updateLibrary(next)
    if(scopeRef.current===startScope&&epoch.current===startEpoch&&requestRef.current===startRequest){
     setNotice(message)
     if(open&&next.activeId){setPlayback({id:next.activeId,scope:startScope});setSelectedId(next.activeId);writeStudioUrl({buildId:next.activeId})}
    }else setNotice('原教程和进度已保留；当前作品上下文已切换。')
   }catch(e){setError('操作未保存，原教程保留：'+String(e))}
   finally{lock.current=false;setBusy(false);pending.current=null}
  })();pending.current=operation;await operation
 }
 const bundle=playback&&(playback.scope===scope||(playback.request===urlRequest&&readStudioUrl(location.href).values.buildId===playback.id))?bundleFor(library,playback.id):null,progress=bundle?library.progress[bundle.plan.id]:null,playing=!!bundle&&!!progress
 const match=matchingBuild(library,source),history=buildHistory(library),saveState=buildSaveState(library,bundle),disabled=busy||blocked||restoring
 const matchesPlaying=!!bundle&&!!source&&canonical(bundle.snapshot.assembly)===canonical(source)
 const management=<div className="build-management">
  <div className="build-save-row"><button className={playing&&saveState==='unsaved'?'primary':''} disabled={disabled||!bundle||saveState==='saved'} onClick={()=>void run(l=>storeBundle(l,bundle!,profiles),'教程已保存，来源及内容与保存版本一致。')}>保存教程</button><span data-testid="build-save-status" aria-live="polite">{saveState==='saved'?'已保存 · 与保存版本一致':saveState==='unsaved'?'未保存':saveState==='different'?'与保存版本不同':'未打开教程'}</span></div>
  <div className="build-file-actions"><button disabled={disabled||!bundle} onClick={()=>download(JSON.stringify(bundle,null,2),'magnetic-tiles-build.json')}>导出教程 JSON</button><button disabled={disabled} onClick={()=>file.current?.click()}>导入教程 JSON</button><input ref={file} data-testid="build-import" type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async l=>{if(f.size>1_000_000)throw Error('文件超过1 MB');const next=await storeBundle(l,JSON.parse(await f.text()),profiles);return activate(next,next.activeId!)},'已验证并保存导入教程，固定来源见当前播放信息。',true)}}/></div>
  <div className="build-saved"><label>历史教程<select aria-label="历史教程" value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">主动选择教程</option>{history.map(b=><option key={b.plan.id} value={b.plan.id}>{b.snapshot.assembly.name} · {b.snapshot.assembly.id.slice(0,8)} / r{b.snapshot.assembly.revision} · {b.plan.steps.length} 步 · {library.plans.some(p=>p.id===b.plan.id)?'已保存':'未保存预览'}</option>)}</select></label><button disabled={disabled||!selectedId} onClick={()=>void run(l=>activate(l,selectedId),'已主动打开历史教程；作品编辑内容保持原样。',true)}>打开教程</button></div>
  <p className="build-notice" aria-live="polite">{notice}</p>{error&&<p className="storage-error" role="alert">{error}</p>}
  {blocked&&<div className="button-row"><button onClick={()=>download(localStorage.getItem(BUILD_KEY)??'','magnetic-tiles-build-recovery.json')}>备份无法读取的教程存档</button><button onClick={async()=>{if(!confirm('只重置 Build 教程存档？已保存教程及其进度将被清除；原 Assembly 工作区不受影响。'))return;try{await saveLibrary(localStorage,emptyLibrary(),profiles);updateLibrary(emptyLibrary());setBlocked(false);setError('');setNotice('教程存档已重置。')}catch(e){setError(String(e))}}}>重置教程存档</button></div>}
 </div>
 return <><StudioSlot column="inspector" stages={['build']}><section className="tiles-panel build-panel" aria-label="搭建教程（Build）">
  <section className="build-source" aria-label="生成教程的作品来源"><div className="build-heading"><h2>{workflowTerms.build.label}</h2><button onClick={()=>navigate('assembly')}>编辑作品</button></div>
   <label className="compact-field">教程来源作品<select aria-label="教程来源作品" value={sourceId} disabled={disabled||dragging} onChange={e=>{setSourceId(e.target.value);clearPlayback()}}><option value="current">使用当前作品 · {assembly.name}</option><optgroup label="已保存作品">{savedAssemblies.map(a=><option key={a.id} value={'saved:'+a.id}>{a.name} · {a.instances.length} 块 · revision {a.revision}</option>)}</optgroup></select></label>
   {source?<><div className="context-notice-row"><p className="context-notice" title={`${source.name} · ${source.id} / r${source.revision} · ${modeLabel(workMode(source))}`}>{source.name} · {source.instances.length} 块 · r{source.revision}</p><InfoHint label="搭建教程来源">来源 ID {source.id} · revision {source.revision}。{modeLabel(workMode(source))}。教程按作品ID、版本和完整内容匹配。保存教程会固定独立来源；历史教程及未保存预览的进度均保留。{sourceId!=='current'&&assembly.id===source.id&&!sameAssemblyContents(assembly,source)&&'当前编辑器中的同名作品已有不同内容。'}</InfoHint></div><p className="context-notice" data-testid="build-source-status" title={sourceId==='current'?assemblySaveStatus(assembly,savedAssemblies):'已保存作品快照 · 使用保存时的内容'}>{sourceId==='current'?assemblySaveStatus(assembly,savedAssemblies):'已保存作品快照 · 使用保存时的内容'}</p></>:<p role="alert">所选作品已不可用，请重新选择来源。</p>}
   {workspaceError&&<p role="alert" className="storage-error">作品存储有错误：{workspaceError}</p>}
   <div className="build-start-actions">{playing?<button disabled={disabled} onClick={clearPlayback}>查看当前作品预览</button>:match?<button className="primary" disabled={disabled||dragging} onClick={()=>void run(l=>activate(l,match.plan.id),'已打开当前作品对应的教程及其进度。',true)}>继续当前教程</button>:<button className="primary" disabled={disabled||dragging||!source||!checkArtwork(source,profiles).ready} onClick={()=>void run(async l=>{const next=await retainBuildPreview(l,await generateBuild(source!,profiles),profiles);return activate(next,next.activeId!)},'已生成未保存教程；可播放、完成后保存，进度会持续保留。',true)}>生成搭建步骤</button>}</div>
   {!playing&&(!source||!checkArtwork(source,profiles).ready)&&<p className="hint">来源作品需非空且几何合法；整体连通模式还需全部连通。</p>}
  </section>
  {!playing&&management}
 </section></StudioSlot>
 {playing&&bundle&&progress?<BuildPlayer key={bundle.plan.id} bundle={bundle} progress={progress} profiles={profiles} disabled={disabled} footer={management} sourceInfo={<p className="build-playing-source" data-testid="build-playback-source" title={`${bundle.snapshot.assembly.name} · ${bundle.snapshot.assembly.id} / revision ${bundle.snapshot.assembly.revision} · Hash ${bundle.snapshot.hash}`}>{matchesPlaying?'当前作品教程':'主动打开的历史教程'} · {bundle.snapshot.assembly.name} · {bundle.snapshot.assembly.instances.length} 块 · r{bundle.snapshot.assembly.revision}{!matchesPlaying?'（与所选作品不同）':''}</p>} onProgress={(p:BuildProgress)=>void run(async l=>({...l,progress:{...l.progress,[bundle.plan.id]:p}}),p.completed?'本次播放已完成；可重新开始、查看步骤或保存教程。':'播放进度已记录。')}/>:<StudioSlot column="workspace" stages={['build']}><section aria-label="Build 作品预览"><h3>当前作品预览</h3>{source?<><p>{source.name} · {source.instances.length} 块 · {modeLabel(workMode(source))}</p><AssemblyPreview assembly={source} profiles={profiles} className="build-board"/>{!source.instances.length&&<p>当前作品为空，请先在作品编辑器中添加磁力片。</p>}</>:<p>请在右栏选择教程来源作品。</p>}</section></StudioSlot>}
 </>
}
