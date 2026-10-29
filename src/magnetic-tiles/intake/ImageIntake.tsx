import { PREFERENCES_KEY, resolveIntakePreferences, readStudioUrl, useUrlRequest, writeStudioUrl } from '../studio-url.ts'
import { outlineEvidenceKey } from './profile-match.ts'
import { ProfileMatcher } from './ProfileMatcher.tsx'
import { ReviewWorkspace } from './ReviewWorkspace.tsx'
import { AssemblyPreview } from '../AssemblyPreview.tsx'
import { SourceComparison } from '../SourceComparison.tsx'
import { StudioSlot, imageStages, useStudio } from '../StudioLayout.tsx'
import { parseEvidence, recognitionSummary, reconstructionSummary as resultMessage } from './contracts.ts'
import { useEffect, useRef, useState } from 'react'
import type { Assembly, Vec, WorkMode } from '../geometry.ts'
import { validate } from '../geometry.ts'
import { profiles } from '../profiles.ts'
import { canonical, contentHash } from '../build-plan.ts'
import { intakeApi, prepareImage, prepareLibraryImage } from './api.ts'
import type { Analysis, Candidate, Evidence, IntakeHistory, Observation, Origin, Reconstruction, Review, Source } from './contracts.ts'
type Config={models:{id:string;label:string;provider:string}[];providers:Record<string,boolean>}
const emptyHistory=():IntakeHistory=>({sources:[],analyses:[],reviews:[],reconstructions:[],origins:[],warnings:[]})
export function ImageIntake({assembly,onApply}:{assembly:Assembly;onApply:(candidate:Assembly,bind:(actual:Assembly)=>Promise<Origin>)=>Promise<void>}){
 const {stage,navigate}=useStudio()
 const urlRequest=useUrlRequest(), restored=useRef<typeof urlRequest|null>(null)
 const [urlReady,setUrlReady]=useState(false),[draftAvailable,setDraftAvailable]=useState(false)
 const [confirmedOutlines,setConfirmedOutlines]=useState<Set<string>>(()=>new Set())
 const [config,setConfig]=useState<Config|null>(null),[history,setHistory]=useState<IntakeHistory>(emptyHistory),[source,setSource]=useState<Source|null>(null),[image,setImage]=useState('')
 const [analysis,setAnalysis]=useState<Analysis|null>(null),[draft,setDraft]=useState<Evidence|null>(null),[review,setReview]=useState<Review|null>(null),[result,setResult]=useState<Reconstruction|null>(null)
 const [selected,setSelected]=useState(''),[model,setModel]=useState(''),[candidateId,setCandidateId]=useState(''),[checked,setChecked]=useState(false)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('上传图片后点击识别；模型只在明确点击时调用。'),[error,setError]=useState(''),[currentHash,setCurrentHash]=useState('')
 const [target,setTarget]=useState(''),[intent,setIntent]=useState<'connect'|'separate'|'uncertain'>('connect')
 const [imageSource,setImageSource]=useState<''|'upload'|'server'>('upload'),[library,setLibrary]=useState<{name:string;mimeType:string}[]>([]),[libraryName,setLibraryName]=useState('')
 const [preferencesRestored,setPreferencesRestored]=useState<typeof urlRequest|null>(null)
 const [preferencesReady,setPreferencesReady]=useState(false),[preferenceWarnings,setPreferenceWarnings]=useState({sourceType:'',model:''})
 const [preferenceStorageError,setPreferenceStorageError]=useState('')
 const [mode,setMode]=useState<WorkMode>('connected-construction')

 const lock=useRef(false),file=useRef<HTMLInputElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:string;index:number;pointerId:number}|null>(null)
 useEffect(()=>{let live=true;Promise.all([intakeApi<Config>('status'),intakeApi<IntakeHistory>('history')]).then(([c,h])=>{if(live){setConfig(c);setHistory(h)}}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[])
 useEffect(()=>{let live=true;void contentHash(assembly).then(h=>{if(live)setCurrentHash(h)});return()=>{live=false}},[assembly])
 useEffect(()=>{
  if(!config)return
  let saved:unknown={}
  try{saved=JSON.parse(localStorage.getItem(PREFERENCES_KEY)||'{}')}catch{setPreferenceStorageError('本地图片来源 / 模型偏好无法读取；使用 URL 或默认值。')}
  const resolved=resolveIntakePreferences(urlRequest.href,saved,config)
  setImageSource(resolved.sourceType==='uploaded'?'upload':resolved.sourceType);setModel(resolved.model);setPreferenceWarnings(resolved.warnings)
  setPreferencesRestored(urlRequest);setPreferencesReady(true)
 },[config,urlRequest])
 useEffect(()=>{
  if(!preferencesReady||preferencesRestored!==urlRequest)return
  const values:Record<string,string|undefined>={}
  if(imageSource&&!preferenceWarnings.sourceType)values.sourceType=imageSource==='upload'?'uploaded':'server'
  if(!preferenceWarnings.model)values.model=model||undefined
  writeStudioUrl(values)
  try{const raw=JSON.parse(localStorage.getItem(PREFERENCES_KEY)||'{}');localStorage.setItem(PREFERENCES_KEY,JSON.stringify({...raw,...values}))}catch{setPreferenceStorageError('图片来源 / 模型偏好无法写入本地；URL 仍可用于恢复。')}
 },[imageSource,model,preferencesReady,preferencesRestored,urlRequest,preferenceWarnings])
 useEffect(()=>{
  if(imageSource!=='server')return
  let alive=true
  void intakeApi<{images:{name:string;mimeType:string}[]}>('library').then(list=>{if(alive)setLibrary(list.images)}).catch(e=>{if(alive)setError('Server Library 加载失败：'+String(e))})
  return()=>{alive=false}
 },[imageSource])
 function chooseSource(value:'upload'|'server'){setImageSource(value);setPreferenceWarnings(w=>({...w,sourceType:''}))}
 function chooseModel(value:string){setModel(value);setPreferenceWarnings(w=>({...w,model:''}))}
 async function refresh(){setHistory(await intakeApi<IntakeHistory>('history'))}
 async function refreshLibrary(){const list=await intakeApi<{images:{name:string;mimeType:string}[]}>('library');setLibrary(list.images);setLibraryName('')}
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action()}catch(e){setError(String(e))}finally{lock.current=false;setBusy(false)}}
 async function preserveEdits(){
  if(analysis?.status==='complete'&&draft&&!review&&canonical(draft)!==canonical(analysis.evidence)){
   const saved=await intakeApi<Review>('reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:draft})
   setReview(saved);await refresh()
  }
 }
 async function openSource(s:Source){await preserveEdits();const img=await intakeApi<{mimeType:string;imageBase64:string}>('image/'+s.id);setSource(s);setLibraryName('');setImage(`data:${img.mimeType};base64,${img.imageBase64}`);setAnalysis(null);setDraft(null);setReview(null);setResult(null);setChecked(false);setSelected('');setMessage('图片已打开。选择历史分析，或明确发起一次新识别。')}
 function edit(next:Evidence){setDraft(next);setReview(null);setResult(null);setChecked(false)}
 function patch(id:string,change:Partial<Observation>){if(draft)edit({...draft,observations:draft.observations.map(o=>o.id===id?{...o,...change}:o)})}
 async function openAnalysis(a:Analysis,preserve=true){if(preserve)await preserveEdits();const full=await intakeApi<Analysis>('analyses/'+a.id);setAnalysis(full);setDraft(full.evidence?structuredClone(full.evidence):null);setSelected(full.evidence?.observations[0]?.id??'');setReview(null);setResult(null);setChecked(false);setMessage(full.status==='complete'?recognitionSummary(full.evidence):full.status==='processing'?'请求进行中或服务曾中断；刷新历史查看结果，不自动重试。':'识别失败，原始记录已保留。')}
 async function openReview(r:Review){const a=history.analyses.find(a=>a.id===r.analysisId);if(!a)throw Error('审核来源不在历史中');await openAnalysis(a);setDraft(structuredClone(r.evidence));setReview(r);setSelected(r.evidence.observations[0]?.id??'')}
 async function saveReview(){await run(async()=>{if(!analysis||!draft)return;const r=await intakeApi<Review>('reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:draft});setReview(r);setMessage('审核快照已保存。');localStorage.removeItem('magnetic-review-draft:'+analysis.id);setDraftAvailable(false);await refresh()})}
 // Keep unsaved evidence local, separately from immutable server snapshots.
 useEffect(()=>{if(urlReady&&restored.current===urlRequest&&analysis&&draft&&!review&&canonical(draft)!==canonical(analysis.evidence)){
  try{localStorage.setItem('magnetic-review-draft:'+analysis.id,JSON.stringify({analysisHash:analysis.hash,evidence:draft}));setDraftAvailable(true)}catch(e){setError('审核草稿本地保存失败：'+String(e))}
 }},[analysis,draft,review,urlReady,urlRequest])
 useEffect(()=>{
  let alive=true;setUrlReady(false)
  const restore=async()=>{
   const {values:v,errors}=readStudioUrl(urlRequest.href)
   if(errors.length)throw Error(errors.join('；'))
   const h=await intakeApi<IntakeHistory>('history')
   const find=<T extends {id:string}>(items:T[],id:string|undefined,label:string)=>{if(!id)return undefined;const item=items.find(x=>x.id===id);if(!item)throw Error(label+' 不存在或不可读取：'+id);return item}
   const rc=find(h.reconstructions,v.reconstructionId,'Reconstruction')
   const rv=find(h.reviews,v.reviewId||rc?.reviewId,'Review')
   const a=find(h.analyses,v.analysisId||rv?.analysisId,'Analysis')
   const src=find(h.sources,v.sourceId||a?.sourceId||rc?.sourceId,'Source')
   if(rc&&(!rv||rc.reviewId!==rv.id||rc.reviewHash!==rv.hash||rc.sourceId!==src?.id||rc.sourceHash!==src?.hash))throw Error('URL Reconstruction 与 Review / Source 来源不匹配')
   if(rv&&(!a||rv.analysisId!==a.id||rv.analysisHash!==a.hash))throw Error('URL Review 与 Analysis 来源不匹配')
   if(a&&(!src||a.sourceId!==src.id||a.sourceHash!==src.hash))throw Error('URL Analysis 与 Source 来源不匹配')
   if(v.candidateId&&!rc?.candidates.some(c=>c.id===v.candidateId))throw Error('URL Candidate 不属于所选重建结果')
   const full=a?await intakeApi<Analysis>('analyses/'+a.id):null
   const evidence=rv?.evidence??full?.evidence
   if(v.observationId&&!evidence?.observations.some(o=>o.id===v.observationId))throw Error('URL Observation 不属于所选审核 / 分析')
   const img=src?await intakeApi<{mimeType:string;imageBase64:string}>('image/'+src.id):null
   if(!alive)return
   setHistory(h);setSource(src??null);setImage(img?`data:${img.mimeType};base64,${img.imageBase64}`:'');setAnalysis(full);setDraft(evidence?structuredClone(evidence):null);setReview(rv??null);setResult(rc??null);setCandidateId(v.candidateId??'');setSelected(v.observationId??'');setChecked(false)
   if(rc)setMode(rc.mode??'connected-construction')
   setDraftAvailable(!!a&&!!localStorage.getItem('magnetic-review-draft:'+a.id))
   setError('');if(src)setMessage('已按 URL 恢复保存的图片与工作上下文；未执行识别、重建或教程生成。');restored.current=urlRequest;setUrlReady(true)
  }
  void restore().catch(e=>{if(alive){setError('URL 恢复失败：'+String(e));restored.current=urlRequest;setUrlReady(true)}})
  return()=>{alive=false}
 },[urlRequest])
 useEffect(()=>{if(!urlReady||restored.current!==urlRequest||error.startsWith('URL 恢复失败'))return
  writeStudioUrl({sourceId:source?.id,analysisId:analysis?.id,reviewId:review?.id,reconstructionId:result?.id,candidateId:candidateId||undefined,observationId:selected||undefined})
 },[source,analysis,review,result,candidateId,selected,urlReady,urlRequest,error])
 const chosen=draft?.observations.find(o=>o.id===selected),candidate=result?.candidates.find(c=>c.id===candidateId)
 const origins=history.origins.filter(o=>o.assembly.id===assembly.id),origin=origins.find(o=>o.assemblyHash===currentHash)??origins[0]
 const shown=draft??analysis?.evidence
 const resultEvidence=result?history.reviews.find(r=>r.id===result.reviewId)?.evidence:undefined
 const disabled=busy||!config||!urlReady||!preferencesReady
 function addPiece(){if(!draft)return;const p=profiles[0],xs=p.vertices.map(v=>v[0]),ys=p.vertices.map(v=>v[1]),scale=.2/Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));const id='manual-'+crypto.randomUUID().slice(0,8);edit({...draft,observations:[...draft.observations,{id,profileId:profiles[0].id,profileVersion:profiles[0].version,color:'#f5b942',outline:p.vertices.map(([x,y])=>[.4+(x-Math.min(...xs))*scale,.4+(Math.max(...ys)-y)*scale]),confidence:0,evidence:'人工补片',uncertainty:'请将轮廓角点拖到图片中真实边界',origin:'manual',excluded:false}]});setSelected(id)}
 return <>
  <StudioSlot column="workflow" stages={imageStages}><section className="intake-controls" aria-label="图片与分析">
   <label>图片来源<select aria-label="图片来源" disabled={disabled} value={imageSource} onChange={e=>{const value=e.target.value as 'upload'|'server';chooseSource(value)}}><option value="" disabled>选择图片来源</option><option value="upload">Uploaded Images / 上传图片与历史</option><option value="server">Server Library / 服务器图片</option></select></label>
   {imageSource==='server'&&<><label>服务器图片<select aria-label="服务器图片" disabled={disabled} value={libraryName} onChange={e=>{const name=e.target.value;if(name)void run(async()=>{const s=await intakeApi<Source>('sources',await prepareLibraryImage(name));await openSource(s);setLibraryName(name);await refresh()})}}><option value="">选择服务器图片</option>{library.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button disabled={busy} onClick={()=>void run(refreshLibrary)}>刷新 Server Library</button><p className="hint">public/test-images/maganetic/ · 选择后保存独立图片快照，不调用模型。{!library.length?'目录中暂无支持的图片。':''}</p></>}
   <div className="button-row"><button disabled={disabled} onClick={()=>file.current?.click()}>上传磁力片图片</button><input data-testid="intake-upload" hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async()=>{const s=await intakeApi<Source>('sources',await prepareImage(f));await openSource(s);chooseSource('upload');await refresh()})}}/><button disabled={busy} onClick={()=>void run(refresh)}>刷新图片历史</button></div>
   <label>已保存图片（上传与服务器快照）<select aria-label="已保存图片" disabled={disabled} value={source?.id??''} onChange={e=>{const s=history.sources.find(s=>s.id===e.target.value);if(s)void run(async()=>{await openSource(s);chooseSource('upload')})}}><option value="">选择图片</option>{history.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}</select></label>
   {preferenceWarnings.sourceType&&<p role="alert">{preferenceWarnings.sourceType}</p>}{preferenceWarnings.model&&<p role="alert">{preferenceWarnings.model}</p>}{preferenceStorageError&&<p role="alert">{preferenceStorageError}</p>}
   <label>下次识别模型<select aria-label="识别模型" disabled={disabled} value={model} onChange={e=>chooseModel(e.target.value)}><option value="">选择模型</option>{config?.models.map(m=><option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}{config.providers[m.provider]?'':'（未配置）'}</option>)}</select></label>
   <button className="primary" disabled={disabled||!source||!model} onClick={()=>void run(async()=>{await preserveEdits();setMessage('正在真实识别，可能需要数分钟；不会自动重试。');const a=await intakeApi<Analysis>('recognize',{sourceId:source!.id,model,requestId:crypto.randomUUID()});await refresh();await openAnalysis(a,false)})}>识别图片（调用模型）</button>
   <label>历史 Analysis<select aria-label="历史 Analysis" disabled={disabled} value={analysis?.id??''} onChange={e=>{const a=history.analyses.find(a=>a.id===e.target.value);if(a)void run(()=>openAnalysis(a))}}><option value="">选择分析</option>{history.analyses.filter(a=>a.sourceId===source?.id).map(a=><option key={a.id} value={a.id}>{a.createdAt.slice(0,19)} · {a.model} · {a.status}</option>)}</select></label>
   <label>历史 Review<select aria-label="历史 Review" disabled={disabled} value={review?.id??''} onChange={e=>{const r=history.reviews.find(r=>r.id===e.target.value);if(r)void run(()=>openReview(r))}}><option value="">当前编辑 / 未保存</option>{history.reviews.filter(r=>r.analysisId===analysis?.id).map(r=><option key={r.id} value={r.id}>{r.createdAt.slice(0,19)} · {r.id.slice(0,8)}</option>)}</select></label>
   <label>历史重建<select aria-label="历史重建" disabled={disabled} value={result?.id??''} onChange={e=>{const r=history.reconstructions.find(r=>r.id===e.target.value);if(r)void run(async()=>{const rv=history.reviews.find(v=>v.id===r.reviewId);if(!rv)throw Error('缺少来源 Review');await openReview(rv);setMode(r.mode??'connected-construction');setResult(r);setCandidateId(r.candidates[0]?.id??'');setChecked(false);navigate('reconstruction')})}}><option value="">选择结果</option>{history.reconstructions.filter(r=>r.sourceId===source?.id).map(r=><option key={r.id} value={r.id}>{r.createdAt.slice(0,19)} · {r.candidates.length} 个候选</option>)}</select></label>
  </section></StudioSlot>
  <StudioSlot column="workspace" stages={imageStages}>
    <ReviewWorkspace active={stage==='review'} evidence={shown} confirmedOutlines={confirmedOutlines} sourceId={source?.id??''} imageWidth={source?.view.width??0} imageHeight={source?.view.height??0} selected={selected} onSelect={setSelected} busy={busy} saveControl={<><span role="status">{draft?(review?'已保存':'未保存'):'未打开审核'}</span><button disabled={disabled||!draft||!analysis} onClick={()=>void saveReview()}>保存审核快照</button></>}><SourceComparison comparing={stage==='reconstruction'} source={
      <section aria-label="来源图片"><h3>Source · 原图与编号轮廓</h3>{source&&<p>{source.name} · 快照 {source.id.slice(0,8)}</p>}
   {source&&<svg ref={svg} className="intake-image" viewBox={`0 0 ${source.view.width} ${source.view.height}`} aria-label="图片与识别轮廓" onPointerMove={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId||!chosen||busy)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());patch(d.id,{outline:chosen.outline.map((v,i)=>i===d.index?[Math.max(0,Math.min(1,p.x/source.view.width)),Math.max(0,Math.min(1,p.y/source.view.height))]:v)})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
    <image href={image} width={source.view.width} height={source.view.height}/>
    {shown?.observations.filter(o=>!o.excluded).map(o=>{const pts=o.outline.map(([x,y]):Vec=>[x*source.view.width,y*source.view.height]),cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;return <g key={o.id}><polygon data-observation={o.id} points={pts.map(p=>p.join(',')).join(' ')} className={selected===o.id?'observation selected':'observation'} role="button" tabIndex={0} aria-label={`识别零件 ${o.id}`} onClick={()=>setSelected(o.id)} onKeyDown={e=>{if(e.key==='Enter')setSelected(o.id)}}/><text x={cx} y={cy} fontSize={source.view.width*.025} className="observation-label">{o.id}</text>{selected===o.id&&draft&&!busy&&pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={source.view.width*.009} className="observation-handle" onPointerDown={e=>{e.preventDefault();drag.current={id:o.id,index:i,pointerId:e.pointerId};svg.current!.setPointerCapture(e.pointerId)}}/>)}</g>})}
   </svg>}
      {!source&&<p className="studio-empty">从左栏选择 Server Library、上传图片或打开已保存图片。</p>}</section>} candidate={
      <section aria-label="候选对照"><h3>Candidate · 精确几何</h3>{candidate?<CandidateView candidate={candidate} selected={selected} onSelect={setSelected}/>:<p className="studio-empty">选择审核快照，在右栏执行重建。</p>}</section>
    }/>
    {selected&&stage!=='review'&&<p className="hint">当前零件：{selected} <button onClick={()=>navigate('review')}>修正选中零件</button></p>}</ReviewWorkspace>
  </StudioSlot>
  <StudioSlot column="inspector" stages={['source']}><section className="intake-controls"><h2>Analysis · 识别信息</h2>{analysis?.status==='complete'&&<><p role="status" data-testid="recognition-summary">{recognitionSummary(analysis.evidence)}</p><p>{analysis.evidence?.reason}</p></>}<p className="hint">清晰平铺照片 / 分块示意图 · 1–25 片 · 有限搜索预算。上传、重建和打开历史不调用模型。</p>
   {analysis&&<p>实际分析模型：{analysis.model} · {analysis.status}</p>}{analysis&&<details><summary>实际模型、Usage 与原始输出</summary><p>{analysis.model} / {analysis.modelVersion??'版本未返回'} · {analysis.status}</p>{analysis.error&&<p>{analysis.error}</p>}<pre>{JSON.stringify(analysis.usageMetadata,null,2)}</pre><pre>{analysis.rawOutput}</pre></details>}
  </section></StudioSlot>
  <StudioSlot column="inspector" stages={['review']}><section className="intake-controls" aria-label="审核与重建"><h2>Review · 修正证据</h2>{draft&&<><p role="status" data-testid="review-summary">{recognitionSummary(draft)}</p><p className="hint">Unknown 会保留编号与轮廓，但不能进入正式作品。请查看证据和未知原因，再选择经核实的 Profile；不要为了重建而猜测替换。若输入类别为超出支持范围，需先确认所采用部分适合二维再手动修改。排除零件后只重建部分作品。</p></>}
   {draft&&<><label>输入类别<select aria-label="输入类别" disabled={busy} value={draft.sourceKind} onChange={e=>edit({...draft,sourceKind:e.target.value as Evidence['sourceKind']})}><option value="flat_photo">二维平铺照片</option><option value="diagram">平面示意图</option><option value="unsupported">超出支持范围</option></select></label><label>输入说明 / 修正理由<textarea aria-label="输入说明 / 修正理由" disabled={busy} value={draft.reason} onChange={e=>edit({...draft,reason:e.target.value})}/></label>
   <p>{draft.observations.filter(o=>!o.excluded).length} 块采用 · {draft.relations.length} 个关系假设</p>

   <button disabled={busy||draft.observations.length>=25} onClick={addPiece}>补一块漏检零件</button>
   {chosen&&<fieldset disabled={busy}><legend>{chosen.id} · {chosen.origin==='manual'?'人工补充':'图片观察'} · 模型置信度 {chosen.confidence}</legend><label>形状<select aria-label="修正形状" value={chosen.profileId==='unknown'?'unknown':`${chosen.profileId}@${chosen.profileVersion}`} onChange={e=>{const p=profiles.find(p=>`${p.id}@${p.version}`===e.target.value);patch(chosen.id,{profileId:p?.id??'unknown',profileVersion:p?.version??1})}}>{profiles.map(p=><option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{p.name} · v{p.version}</option>)}<option value="unknown">未知 / 不支持</option></select></label>{source&&<ProfileMatcher key={JSON.stringify([chosen.id,chosen.outline,chosen.uncertainty,chosen.confidence,source.id])} observation={chosen} confirmed={confirmedOutlines.has(outlineEvidenceKey(chosen,source.id))} onConfirm={value=>setConfirmedOutlines(previous=>{const next=new Set(previous),key=outlineEvidenceKey(chosen,source.id);if(value)next.add(key);else next.delete(key);return next})} width={source.view.width} height={source.view.height} onApply={(profileId,profileVersion)=>patch(chosen.id,{profileId,profileVersion})}/>}<label>颜色<input aria-label="修正颜色" type="color" value={chosen.color} onChange={e=>patch(chosen.id,{color:e.target.value})}/></label><label className="intake-check"><input type="checkbox" checked={chosen.excluded} onChange={e=>patch(chosen.id,{excluded:e.target.checked})}/>不采用本片（误检或仅重建局部）</label><p className="hint">观察证据 / 候选形状：{chosen.evidence||'未提供'}</p><p className="hint">未知原因 / 不确定性：{chosen.uncertainty||'未提供；不代表已核实'}</p>
    <p className="hint">拖动图片上的角点修正外轮廓，也可输入坐标（0–1；左上为原点）。改形状后请检查角点数。</p>
    {chosen.outline.map((p,i)=><div className="intake-point" key={i}><span>角 {i+1}</span>{p.map((v,j)=><input key={j} aria-label={`角 ${i+1} ${j?'y':'x'}`} type="number" min="0" max="1" step=".001" value={v} onChange={e=>patch(chosen.id,{outline:chosen.outline.map((a,k)=>k===i?a.map((b,l)=>l===j?Number(e.target.value):b) as Vec:a)})}/>)}<button disabled={chosen.outline.length<=3} onClick={()=>patch(chosen.id,{outline:chosen.outline.filter((_,k)=>k!==i)})}>删除角点</button></div>)}<button disabled={chosen.outline.length>=8} onClick={()=>{const a=chosen.outline.at(-1)!,b=chosen.outline[0];patch(chosen.id,{outline:[...chosen.outline,[(a[0]+b[0])/2,(a[1]+b[1])/2]]})}}>增加角点（拖到真实角）</button>
    <label>连接到<select aria-label="连接到" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择目标零件</option>{draft.observations.filter(o=>o.id!==chosen.id&&!o.excluded).map(o=><option key={o.id}>{o.id}</option>)}</select></label><label>关系<select aria-label="关系意图" value={intent} onChange={e=>setIntent(e.target.value as typeof intent)}><option value="connect">必须整边连接</option><option value="separate">不得接触连接</option><option value="uncertain">不确定，仅作为线索</option></select></label><button disabled={!target||target===chosen.id} onClick={()=>edit({...draft,relations:[...draft.relations.filter(r=>!([r.from,r.to].includes(chosen.id)&&[r.from,r.to].includes(target))),{from:chosen.id,to:target,intent,evidence:'人工修正关系'}]})}>设置关系</button>
   </fieldset>}
   <ul className="intake-relations">{draft.relations.map((r,i)=><li key={i}>{r.from} ↔ {r.to} · {r.intent}<p>{r.evidence}</p><button disabled={busy} onClick={()=>edit({...draft,relations:draft.relations.filter((_,j)=>i!==j)})}>删除关系</button></li>)}</ul>
</>}{!draft&&<p>请先从左栏打开 Analysis 或 Review。</p>}</section></StudioSlot>
  <StudioSlot column="inspector" stages={['review','reconstruction']}><section className="intake-controls">
{draft&&<><label>重建作品模式<select aria-label="重建作品模式" disabled={busy} value={mode} onChange={e=>setMode(e.target.value as WorkMode)}><option value="connected-construction">Connected Construction · 整体连通</option><option value="flat-mosaic">Flat Mosaic · 允许独立组件</option></select></label><p className="hint">平面拼图按明确整边连接意图分组；独立组件按图片位置摆放，不虚构磁吸。</p><div className="button-row"><button className="primary" disabled={busy||!review} onClick={()=>void run(async()=>{const r=await intakeApi<Reconstruction>('reconstruct',{reviewId:review!.id,reviewHash:review!.hash,mode});setMode(r.mode??'connected-construction');setResult(r);setCandidateId(r.candidates[0]?.id??'');setChecked(false);setMessage(resultMessage(r,review!.evidence));navigate('reconstruction');await refresh()})}>重建二维布局</button></div></>}</section></StudioSlot>
  <StudioSlot column="inspector" stages={['reconstruction']}><section className="intake-controls" aria-label="重建结果"><h2>Reconstruction · 候选与诊断</h2>
   {result&&<><p role="status"><b>{resultMessage(result,resultEvidence)}</b></p><p>作品模式：{result.mode??'connected-construction'}</p><ul>{result.diagnostics.map((d,i)=><li key={i}>{d}</li>)}</ul><p>搜索 {result.explored} 个状态{result.truncated?'（预算已用尽）':''}</p><label>候选<select aria-label="重建候选" value={candidateId} disabled={busy} onChange={e=>{setCandidateId(e.target.value);setChecked(false)}}>{result.candidates.map(c=><option key={c.id} value={c.id}>{c.id} · 偏差 {c.imageError.toFixed(3)}</option>)}</select></label></>}
   {candidate&&<><p><b>几何合法</b> · {candidate.assembly.instances.length} 片 / {candidate.connections} 条连接 · {candidate.components?.length??1} 个组件</p>{candidate.components?.map((c,i)=>{const links=validate(candidate.assembly.instances,profiles).connections.filter(e=>c.includes(e.a.tileId));return <details key={i}><summary>组件 {i+1}：{c.length} 片 / {links.length} 条真实连接</summary><p>{c.join('、')}</p>{links.map((e,j)=><p key={j}>{e.a.tileId}.{e.a.edgeId} ↔ {e.b.tileId}.{e.b.edgeId}</p>)}</details>})}<p>轮廓 RMS 偏差 {candidate.imageError.toFixed(3)}（标准边长=1） · {candidate.fidelity==='close'?'轮廓较接近':'需要重点修正'}。这不是识别准确率。</p><label className="intake-check"><input aria-label="已对照原图" type="checkbox" disabled={busy} checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已对照原图检查零件、颜色、形状和连接，接受此候选</label><button className="primary" disabled={busy||!checked} onClick={()=>void run(async()=>{await onApply(candidate.assembly,actual=>intakeApi<Origin>('origins',{reconstructionId:result!.id,reconstructionHash:result!.hash,candidateId:candidate.id,assembly:actual,visualChecked:checked}));await refresh();setMessage('已在作品编辑器中打开，可编辑、保存作品并生成搭建教程。');navigate('assembly')})}>在作品编辑器中打开</button></>}
</section></StudioSlot>
  <StudioSlot column="inspector" stages={['assembly']}>
   {origin&&<p className="intake-origin">当前画布来源：图片 {origin.sourceId.slice(0,8)} / {origin.candidateId}。{origin.assemblyHash===currentHash?'与打开时的快照一致。':'已手动修改或修订，不再宣称与原候选完全一致。'}</p>}
</StudioSlot>
  <StudioSlot column="workflow" stages={imageStages}><div className="intake-feedback">
{draftAvailable&&analysis&&<p>此 Analysis 有本地未保存草稿。{review?'当前显示已保存审核快照。':'URL 不包含未保存的草稿内容。'}<button onClick={()=>{try{const saved=JSON.parse(localStorage.getItem('magnetic-review-draft:'+analysis.id)||'null');if(!saved||saved.analysisHash!==analysis.hash)throw Error('草稿来源不匹配');edit(parseEvidence(saved.evidence));setMessage('已恢复本地未保存草稿；请另存审核快照。')}catch(e){setError(String(e))}}}>恢复本地审核草稿</button></p>}
<p aria-live="polite">{busy?'正在处理… ':''}{message}</p>{error&&<p className="storage-error" role="alert">{error}</p>}{history.warnings.map(w=><p key={w} className="storage-error">{w}</p>)}</div></StudioSlot>
 </>
}

function CandidateView({candidate,selected,onSelect}:{candidate:Candidate;selected:string;onSelect:(id:string)=>void}){
 return <AssemblyPreview assembly={candidate.assembly} profiles={profiles} selected={selected} onSelect={onSelect} label="重建候选预览"/>
}
