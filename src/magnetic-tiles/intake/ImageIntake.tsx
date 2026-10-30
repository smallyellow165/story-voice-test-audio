import { workflowTerms, reconstructionAction, workModeNames } from '../studio-terms.ts'
import { workflowStages } from '../studio-url.ts'
import { PREFERENCES_KEY, resolveIntakePreferences, readStudioUrl, useUrlRequest, writeStudioUrl } from '../studio-url.ts'
import { estimateRelativeScale } from './relative-size.ts'
import { outlineEvidenceKey } from './profile-match.ts'
import { InfoHint } from '../../brick-vision/InfoHint.tsx'
import { PartActions } from './PartActions.tsx'
import { compactReviewSummary, removeManualPart, setPartExcluded } from './review-edit.ts'
import { SnapshotHistory } from './SnapshotHistory.tsx'
import { mergeSelectedHistory, resolveSelectedDefaults, selectedFor, sourceReviews } from './selected-snapshots.ts'
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
import type { Analysis, Candidate, Evidence, IntakeHistory, Observation, Origin, Reconstruction, Review, SelectedStage, Source } from './contracts.ts'
type ReviewUndo={evidence:Evidence;review:Review|null;selected:string;label:string}
type Config={models:{id:string;label:string;provider:string}[];providers:Record<string,boolean>}
const emptyHistory=():IntakeHistory=>({selectedSnapshots:[],sources:[],analyses:[],reviews:[],reconstructions:[],origins:[],warnings:[]})
export function ImageIntake({assembly,onApply}:{assembly:Assembly;onApply:(candidate:Assembly,bind:(actual:Assembly)=>Promise<Origin>)=>Promise<void>}){
 const {stage,navigate}=useStudio()
 const urlRequest=useUrlRequest(), currentRequest=useRef<typeof urlRequest>(urlRequest), restored=useRef<typeof urlRequest|null>(null)
 currentRequest.current=urlRequest
 const [urlReady,setUrlReady]=useState(false),[draftAvailable,setDraftAvailable]=useState(false)
 const [confirmedProfiles,setConfirmedProfiles]=useState<Set<string>>(()=>new Set())
 const [config,setConfig]=useState<Config|null>(null),[history,setHistory]=useState<IntakeHistory>(emptyHistory),[source,setSource]=useState<Source|null>(null),[image,setImage]=useState('')
 const [analysis,setAnalysis]=useState<Analysis|null>(null),[draft,setDraft]=useState<Evidence|null>(null),[review,setReview]=useState<Review|null>(null),[result,setResult]=useState<Reconstruction|null>(null)
 const [reviewUndo,setReviewUndo]=useState<ReviewUndo|null>(null)
 const [selected,setSelected]=useState(''),[model,setModel]=useState(''),[candidateId,setCandidateId]=useState(''),[checked,setChecked]=useState(false)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('选择当前图片或历史快照，继续工作。'),[error,setError]=useState(''),[currentHash,setCurrentHash]=useState('')
 const [target,setTarget]=useState(''),[intent,setIntent]=useState<'connect'|'separate'|'uncertain'>('connect')
 const [imageSource,setImageSource]=useState<''|'upload'|'server'>('upload'),[library,setLibrary]=useState<{name:string;mimeType:string}[]>([]),[libraryName,setLibraryName]=useState('')
 const [preferencesRestored,setPreferencesRestored]=useState<typeof urlRequest|null>(null)
 const [preferencesReady,setPreferencesReady]=useState(false),[preferenceWarnings,setPreferenceWarnings]=useState({sourceType:'',model:''})
 const [preferenceStorageError,setPreferenceStorageError]=useState('')
 const [mode,setMode]=useState<WorkMode>('connected-construction')

 const reviewInspector=useRef<HTMLElement>(null)
 useEffect(()=>{if(stage==='review')reviewInspector.current?.closest<HTMLElement>('.studio-inspector')?.scrollTo({top:0})},[selected,stage])
 const lock=useRef(false),file=useRef<HTMLInputElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:string;index:number;pointerId:number}|null>(null)
 useEffect(()=>{let live=true;intakeApi<Config>('status').then(c=>{if(live)setConfig(c)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[])
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
  void intakeApi<{images:{name:string;mimeType:string}[]}>('library').then(list=>{if(alive)setLibrary(list.images)}).catch(e=>{if(alive)setError('服务器图库加载失败：'+String(e))})
  return()=>{alive=false}
 },[imageSource])
 function chooseSource(value:'upload'|'server'){setImageSource(value);setPreferenceWarnings(w=>({...w,sourceType:''}))}
 function chooseModel(value:string){setModel(value);setPreferenceWarnings(w=>({...w,model:''}))}
 function acceptHistory(next:IntakeHistory){setHistory(previous=>mergeSelectedHistory(previous,next))}
 async function refresh(){acceptHistory(await intakeApi<IntakeHistory>('history'))}
 function defaults(h:IntakeHistory,sourceId:string,requestedStage:string){
  try{return {...resolveSelectedDefaults(h,sourceId,requestedStage,id=>!!localStorage.getItem('magnetic-review-draft:'+id)),warning:''}}
  catch(e){return {analysisId:undefined,reviewId:undefined,draftBlocked:false,warning:String((e as Error).message)}}
 }
 async function toggleSelected(kind:SelectedStage){
  if(!source)return
  const state=selectedFor(history,source.id,kind),id=kind==='analysis'?analysis?.id:review?.id
  const snapshotId=!state.valid||state.snapshotId===id?null:id
  if(snapshotId===undefined||state.revision===null)return
  try{await intakeApi('selected',{sourceId:source.id,stage:kind,snapshotId,expectedRevision:state.revision})}
  finally{await refresh()}
 }

 async function refreshLibrary(){const list=await intakeApi<{images:{name:string;mimeType:string}[]}>('library');setLibrary(list.images);setLibraryName('')}
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action()}catch(e){setError(String(e))}finally{lock.current=false;setBusy(false)}}
 async function preserveEdits(){
  if(analysis?.status==='complete'&&draft&&!review&&canonical(draft)!==canonical(analysis.evidence)){
   const saved=await intakeApi<Review>('reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:draft})
   setReview(saved);setReviewUndo(null);localStorage.removeItem('magnetic-review-draft:'+analysis.id);setDraftAvailable(false);await refresh()
  }
 }
 async function openSource(s:Source){
  const request=urlRequest;await preserveEdits()
  const h=await intakeApi<IntakeHistory>('history'),choice=defaults(h,s.id,stage)
  const full=choice.analysisId?await intakeApi<Analysis>('analyses/'+choice.analysisId):null,rv=h.reviews.find(r=>r.id===choice.reviewId)
  const img=await intakeApi<{mimeType:string;imageBase64:string}>('image/'+s.id)
  if(currentRequest.current!==request)return
  acceptHistory(h);setSource(s);setLibraryName('');setImage(`data:${img.mimeType};base64,${img.imageBase64}`);setAnalysis(full);setReviewUndo(null);setConfirmedProfiles(new Set());setDraft(rv?structuredClone(rv.evidence):(full?.evidence?structuredClone(full.evidence):null));setReview(rv??null);setResult(null);setChecked(false);setSelected('');setTarget('');setDraftAvailable(!!full&&!!localStorage.getItem('magnetic-review-draft:'+full.id))
  setMessage(choice.warning|| (choice.draftBlocked?'存在本地未保存草稿，暂不自动打开 Selected；可恢复草稿或从历史选择快照。':choice.analysisId?'已打开该阶段的 Selected Snapshot；浏览其他记录不会改变 Selected。':'图片已打开。选择历史分析，或明确发起一次新识别。'))
 }

 function edit(next:Evidence,undo:ReviewUndo|null=null){setDraft(next);setReview(null);setResult(null);setChecked(false);setReviewUndo(undo)}
 function editPart(next:Evidence,label:string){if(draft)edit(next,{evidence:draft,review,selected,label})}
 function undoPartEdit(){if(!reviewUndo)return;setDraft(reviewUndo.evidence);setReview(reviewUndo.review);setSelected(reviewUndo.selected);setResult(null);setChecked(false);setReviewUndo(null);setTarget('');if(reviewUndo.review&&analysis){localStorage.removeItem('magnetic-review-draft:'+analysis.id);setDraftAvailable(false)}}
 function assignProfile(o:Observation,profileId:string,profileVersion:number){
  patch(o.id,{profileId,profileVersion})
  if(source)setConfirmedProfiles(previous=>{const next=new Set(previous),key=outlineEvidenceKey(o,source.id);if(profileId==='unknown')next.delete(key);else next.add(key);return next})
 }
 function deletePart(o:Observation){if(!draft)return;const index=draft.observations.findIndex(p=>p.id===o.id),next=removeManualPart(draft,o.id);editPart(next,`删除 ${o.id}`);setSelected(next.observations[Math.min(index,next.observations.length-1)]?.id??'');setTarget('')}
 function toggleExcluded(o:Observation){if(draft)editPart(setPartExcluded(draft,o.id,!o.excluded),`${o.excluded?'恢复':'排除'} ${o.id}`)}
 function patch(id:string,change:Partial<Observation>){if(draft)edit({...draft,observations:draft.observations.map(o=>o.id===id?{...o,...change}:o)})}
 async function openAnalysis(a:Analysis,preserve=true){const request=urlRequest;if(preserve)await preserveEdits();const full=await intakeApi<Analysis>('analyses/'+a.id);if(currentRequest.current!==request)return;setAnalysis(full);setDraftAvailable(!!localStorage.getItem('magnetic-review-draft:'+a.id));setReviewUndo(null);setConfirmedProfiles(new Set());setTarget('');setDraft(full.evidence?structuredClone(full.evidence):null);setSelected(full.evidence?.observations[0]?.id??'');setReview(null);setResult(null);setChecked(false);setMessage(full.status==='complete'?recognitionSummary(full.evidence):full.status==='processing'?'请求进行中或服务曾中断；刷新历史查看结果，不自动重试。':'识别失败，原始记录已保留。')}
 async function openReview(r:Review){const request=urlRequest,a=history.analyses.find(a=>a.id===r.analysisId);if(!a)throw Error('审核来源不在历史中');await openAnalysis(a);if(currentRequest.current!==request)return;setDraft(structuredClone(r.evidence));setReview(r);setSelected(r.evidence.observations[0]?.id??'')}
 async function saveReview(){await run(async()=>{if(!analysis||!draft)return;const r=await intakeApi<Review>('reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:draft});setReview(r);setReviewUndo(null);setMessage('审核快照已保存。');localStorage.removeItem('magnetic-review-draft:'+analysis.id);setDraftAvailable(false);await refresh()})}
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
   let rv=find(h.reviews,v.reviewId||rc?.reviewId,'Review')
   let a=find(h.analyses,v.analysisId||rv?.analysisId,'Analysis')
   const src=find(h.sources,v.sourceId||a?.sourceId||rc?.sourceId,'Source')
   const explicit=['analysisId','reviewId','reconstructionId','candidateId','observationId'].some(key=>v[key])
   const choice=src&&!explicit?defaults(h,src.id,v.stage||'assembly'):null
   if(choice?.reviewId)rv=find(h.reviews,choice.reviewId,'Review')
   if(choice?.analysisId)a=find(h.analyses,choice.analysisId,'Analysis')
   if(rc&&(!rv||rc.reviewId!==rv.id||rc.reviewHash!==rv.hash||rc.sourceId!==src?.id||rc.sourceHash!==src?.hash))throw Error('URL Reconstruction 与 Review / Source 来源不匹配')
   if(rv&&(!a||rv.analysisId!==a.id||rv.analysisHash!==a.hash))throw Error('URL Review 与 Analysis 来源不匹配')
   if(a&&(!src||a.sourceId!==src.id||a.sourceHash!==src.hash))throw Error('URL Analysis 与 Source 来源不匹配')
   if(v.candidateId&&!rc?.candidates.some(c=>c.id===v.candidateId))throw Error('URL Candidate 不属于所选重建结果')
   const full=a?await intakeApi<Analysis>('analyses/'+a.id):null
   const evidence=rv?.evidence??full?.evidence
   if(v.observationId&&!evidence?.observations.some(o=>o.id===v.observationId))throw Error('URL Observation 不属于所选审核 / 分析')
   const img=src?await intakeApi<{mimeType:string;imageBase64:string}>('image/'+src.id):null
   if(!alive)return
   setReviewUndo(null);setConfirmedProfiles(new Set());setTarget('');acceptHistory(h);setSource(src??null);setImage(img?`data:${img.mimeType};base64,${img.imageBase64}`:'');setAnalysis(full);setDraft(evidence?structuredClone(evidence):null);setReview(rv??null);setResult(rc??null);setCandidateId(v.candidateId??'');setSelected(v.observationId??'');setChecked(false)
   if(rc)setMode(rc.mode??'connected-construction')
   setDraftAvailable(!!a&&!!localStorage.getItem('magnetic-review-draft:'+a.id))
   setError('');if(src)setMessage(choice?.warning|| (choice?.draftBlocked?'存在本地未保存草稿，暂不自动打开 Selected；可恢复草稿或从历史选择快照。':choice?.analysisId?'已恢复该阶段的 Selected Snapshot；Current 已写入 URL。':'已按 URL 恢复保存的图片与工作上下文；未执行识别、重建或教程生成。'));restored.current=urlRequest;setUrlReady(true)
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
 const selectedAnalysis=selectedFor(history,source?.id??'','analysis'),selectedReview=selectedFor(history,source?.id??'','review')
 const selectedMismatch=selectedReview.analysisId&&selectedAnalysis.snapshotId&&selectedReview.analysisId!==selectedAnalysis.snapshotId?`Selected Review 来源 Analysis ${selectedReview.analysisId} 与 Selected Analysis ${selectedAnalysis.snapshotId} 不同；关联保持原样。`:undefined
 const disabled=busy||!config||!urlReady||!preferencesReady
 function addPiece(){if(!draft||draft.observations.length>=25)return;const p=profiles[0],xs=p.vertices.map(v=>v[0]),ys=p.vertices.map(v=>v[1]),scale=.2/Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));const id='manual-'+crypto.randomUUID().slice(0,8);editPart({...draft,observations:[...draft.observations,{id,profileId:profiles[0].id,profileVersion:profiles[0].version,color:'#f5b942',outline:p.vertices.map(([x,y])=>[.4+(x-Math.min(...xs))*scale,.4+(Math.max(...ys)-y)*scale]),confidence:0,evidence:'人工补片',uncertainty:'请将轮廓角点拖到图片中真实边界',origin:'manual',excluded:false}]},`新增 ${id}`);setSelected(id)}
 return <>
  <StudioSlot column="workflow" stages={[...workflowStages]}><section className="intake-controls shared-intake-context" aria-label="共享图片与历史">
   <label className="compact-field current-source">当前图片<select aria-label="当前图片" title={source?`${source.name} · ${source.id}`:'选择当前 Source Image'} disabled={disabled} value={source?.id??''} onChange={e=>{const s=history.sources.find(s=>s.id===e.target.value);if(s)void run(async()=>{await openSource(s);chooseSource('upload')})}}><option value="">选择图片</option>{history.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}</select></label>
   <section className="intake-history" aria-label="History"><div className="intake-history-heading"><strong>History</strong><button disabled={busy} onClick={()=>void run(refresh)}>刷新图片历史</button></div>
   <SnapshotHistory stage="analysis" currentId={analysis?.id??''} selection={selectedAnalysis} disabled={disabled||!source} canSelect={!!analysis&&analysis.status!=='processing'} entries={history.analyses.filter(a=>a.sourceId===source?.id).map(a=>({id:a.id,label:`${a.createdAt.slice(0,19)} · ${a.id.slice(0,8)} · ${a.model} · ${a.status}`}))} onOpen={id=>{const a=history.analyses.find(a=>a.id===id);if(a)void run(()=>openAnalysis(a))}} onToggle={()=>void run(()=>toggleSelected('analysis'))}/>
   <SnapshotHistory stage="review" currentId={review?.id??''} selection={selectedReview} disabled={disabled||!source} entries={sourceReviews(history,source?.id??'').map(r=>({id:r.id,label:`${r.createdAt.slice(0,19)} · ${r.id.slice(0,8)} · A:${r.analysisId.slice(0,8)}`}))} mismatch={selectedMismatch} onOpen={id=>{const r=history.reviews.find(r=>r.id===id);if(r)void run(()=>openReview(r))}} onToggle={()=>void run(()=>toggleSelected('review'))}/>
   <label className="compact-field" title="历史 Reconstruction">重建<select aria-label="历史 Reconstruction" disabled={disabled} value={result?.id??''} onChange={e=>{const r=history.reconstructions.find(r=>r.id===e.target.value);if(r)void run(async()=>{const rv=history.reviews.find(v=>v.id===r.reviewId);if(!rv)throw Error('缺少来源 Review');await openReview(rv);setMode(r.mode??'connected-construction');setResult(r);setCandidateId(r.candidates[0]?.id??'');setChecked(false);navigate('reconstruction')})}}><option value="">选择结果</option>{history.reconstructions.filter(r=>r.sourceId===source?.id).map(r=><option key={r.id} value={r.id}>{r.createdAt.slice(0,19)} · {r.candidates.length} 个候选</option>)}</select></label>
   </section>
  </section></StudioSlot>
  <StudioSlot column="workspace" stages={imageStages}>
    <ReviewWorkspace active={stage==='review'} evidence={shown} onAdd={addPiece} addDisabled={disabled||!draft||draft.observations.length>=25} imageWidth={source?.view.width??0} imageHeight={source?.view.height??0} selected={selected} onSelect={setSelected} busy={busy} saveControl={<><span role="status">{draft?(review?'已保存':'未保存'):'未打开审核'}</span><button disabled={disabled||!draft||!analysis} onClick={()=>void saveReview()}>保存审核快照</button></>}><SourceComparison comparing={stage==='reconstruction'} source={
      <section aria-label="来源图片"><h3>原图与零件轮廓（Source）</h3>{source&&<p>{source.name} · 快照 {source.id.slice(0,8)}</p>}
   {source&&<svg ref={svg} className="intake-image" viewBox={`0 0 ${source.view.width} ${source.view.height}`} aria-label="图片与识别轮廓" onPointerMove={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId||!chosen||busy)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());patch(d.id,{outline:chosen.outline.map((v,i)=>i===d.index?[Math.max(0,Math.min(1,p.x/source.view.width)),Math.max(0,Math.min(1,p.y/source.view.height))]:v)})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
    <image href={image} width={source.view.width} height={source.view.height}/>
    {shown?.observations.filter(o=>!o.excluded).map(o=>{const pts=o.outline.map(([x,y]):Vec=>[x*source.view.width,y*source.view.height]),cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;return <g key={o.id}><polygon data-observation={o.id} points={pts.map(p=>p.join(',')).join(' ')} className={selected===o.id?'observation selected':'observation'} role="button" tabIndex={0} aria-label={`识别零件 ${o.id}`} onClick={()=>setSelected(o.id)} onKeyDown={e=>{if(e.key==='Enter')setSelected(o.id)}}/><text x={cx} y={cy} fontSize={source.view.width*.025} className="observation-label">{o.id}</text>{selected===o.id&&draft&&!busy&&pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={source.view.width*.009} className="observation-handle" onPointerDown={e=>{e.preventDefault();drag.current={id:o.id,index:i,pointerId:e.pointerId};svg.current!.setPointerCapture(e.pointerId)}}/>)}</g>})}
   </svg>}
      {!source&&<p className="studio-empty">在图片与识别阶段选择来源或上传图片，也可从左栏打开当前图片。</p>}</section>} candidate={
      <section aria-label="候选对照"><h3>几何重建候选（Candidate）</h3>{candidate?<CandidateView candidate={candidate} selected={selected} onSelect={setSelected}/>:<p className="studio-empty">从 History 选择审核快照，在几何重建 Inspector 中生成候选。</p>}</section>
    }/>
    {selected&&stage!=='review'&&<p className="hint">当前零件：{selected} <button onClick={()=>navigate('review')}>修正选中零件</button></p>}</ReviewWorkspace>
  </StudioSlot>
  <StudioSlot column="inspector" stages={['source']}><section className="intake-controls source-inspector" aria-label="图片与识别操作">
   <div className="review-inspector-heading"><h2>{workflowTerms.source.label}</h2><InfoHint label="图片与识别操作">上传本地图片或选择服务器图库会保存 Source 快照，不调用模型。下次识别模型与历史 Analysis 的实际模型独立；只有明确点击「识别图片（调用模型）」才发起新识别。支持清晰二维平铺照片 / 分块示意图，1–25 片。</InfoHint></div>
   <label className="compact-field">图片来源<select aria-label="图片来源" disabled={disabled} value={imageSource} onChange={e=>{const value=e.target.value as 'upload'|'server';chooseSource(value)}}><option value="" disabled>选择图片来源</option><option value="upload">上传图片（Uploaded Images）</option><option value="server">服务器图库（Server Library）</option></select></label>
   {imageSource==='server'&&<><div className="source-library-row"><label className="compact-field">服务器图片<select aria-label="服务器图片" disabled={disabled} value={libraryName} onChange={e=>{const name=e.target.value;if(name)void run(async()=>{const s=await intakeApi<Source>('sources',await prepareLibraryImage(name));await openSource(s);setLibraryName(name);await refresh()})}}><option value="">选择服务器图片</option>{library.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button disabled={busy} onClick={()=>void run(refreshLibrary)} aria-label="刷新 Server Library" title="刷新服务器图库">刷新</button></div>{!library.length&&<p role="status">图库暂无图片。</p>}</>}
   <div className="button-row"><button disabled={disabled} onClick={()=>file.current?.click()}>上传磁力片图片</button><input data-testid="intake-upload" hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async()=>{const s=await intakeApi<Source>('sources',await prepareImage(f));await openSource(s);chooseSource('upload');await refresh()})}}/></div>
   <label className="compact-field">下次识别模型<select aria-label="识别模型" disabled={disabled} value={model} onChange={e=>chooseModel(e.target.value)}><option value="">选择模型</option>{config?.models.map(m=><option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}{config.providers[m.provider]?'':'（未配置）'}</option>)}</select></label>
   <button className="primary" disabled={disabled||!source||!model} onClick={()=>void run(async()=>{await preserveEdits();setMessage('正在真实识别，可能需要数分钟；不会自动重试。');const a=await intakeApi<Analysis>('recognize',{sourceId:source!.id,model,requestId:crypto.randomUUID()});await refresh();await openAnalysis(a,false)})}>识别图片（调用模型）</button>
   {preferenceWarnings.sourceType&&<p role="alert">{preferenceWarnings.sourceType}</p>}{preferenceWarnings.model&&<p role="alert">{preferenceWarnings.model}</p>}{preferenceStorageError&&<p role="alert">{preferenceStorageError}</p>}
   {analysis?.status==='complete'&&<div className="context-notice-row"><p className="context-notice" role="status" data-testid="recognition-summary" title={recognitionSummary(analysis.evidence)}>{recognitionSummary(analysis.evidence)}</p><InfoHint label="识别结果"><p>{recognitionSummary(analysis.evidence)}</p><p>{analysis.evidence?.reason}</p></InfoHint></div>}
   {analysis&&<details><summary>Analysis · 实际模型 / Usage / 原始输出</summary><p>{analysis.model} / {analysis.modelVersion??'版本未返回'} · {analysis.status}</p>{analysis.error&&<p>{analysis.error}</p>}<pre>{JSON.stringify(analysis.usageMetadata,null,2)}</pre><pre>{analysis.rawOutput}</pre></details>}
  </section></StudioSlot>
  <StudioSlot column="inspector" stages={['review']}><section ref={reviewInspector} className="intake-controls review-inspector" aria-label="识别审核（Review）">
   <div className="review-inspector-heading"><h2>{workflowTerms.review.label}</h2><InfoHint label="审核状态">{draft&&<p>{recognitionSummary(draft)}</p>}<p>Unknown 保留编号与轮廓，需人工选择 Profile 后才能进入正式作品。轮廓不确定时分数仅供参考，匹配结果不代表几何合法或与原图完全吻合。排除零件后只重建采用部分；超出二维支持范围的输入可在高级信息中审查和修正。</p></InfoHint></div>
   {draft&&<><p className="review-compact-summary" role="status" data-testid="review-summary">{compactReviewSummary(draft)}</p>
   {reviewUndo&&<div className="review-undo" role="status">已{reviewUndo.label}<button disabled={busy} onClick={undoPartEdit}>撤销{reviewUndo.label}</button></div>}
   {chosen?<fieldset disabled={busy}><legend>{chosen.id} · {chosen.origin==='manual'?'人工补充':'图片观察'} · 置信度 {Math.round(chosen.confidence*100)}%</legend>
    <label>Profile<select aria-label="修正形状" value={chosen.profileId==='unknown'?'unknown':`${chosen.profileId}@${chosen.profileVersion}`} onChange={e=>{const p=profiles.find(p=>`${p.id}@${p.version}`===e.target.value);assignProfile(chosen,p?.id??'unknown',p?.version??1)}}>{profiles.map(p=><option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{p.name} · v{p.version}</option>)}<option value="unknown">未知 / 不支持</option></select></label>
    {source&&<ProfileMatcher key={JSON.stringify([chosen.id,chosen.outline,chosen.uncertainty,chosen.confidence,source.id])} observation={chosen} scale={estimateRelativeScale(draft.observations,chosen.id,source.view.width,source.view.height,profiles,confirmedProfiles,source.id)} width={source.view.width} height={source.view.height} onApply={(profileId,profileVersion)=>assignProfile(chosen,profileId,profileVersion)}/>}
    <PartActions key={chosen.id} observation={chosen} relationCount={draft.relations.filter(r=>r.from===chosen.id||r.to===chosen.id).length} onDelete={()=>deletePart(chosen)} onExclude={()=>toggleExcluded(chosen)}/>
    <details className="review-part-details"><summary>零件证据与轮廓编辑</summary>
     <label>颜色<input aria-label="修正颜色" type="color" value={chosen.color} onChange={e=>patch(chosen.id,{color:e.target.value})}/></label><p>观察证据 / 候选形状：{chosen.evidence||'未提供'}</p><p>未知原因 / 不确定性：{chosen.uncertainty||'未提供；不代表已核实'}</p>
    <p className="hint">拖动图片上的角点修正外轮廓，也可输入坐标（0–1；左上为原点）。改形状后请检查角点数。</p>
    {chosen.outline.map((p,i)=><div className="intake-point" key={i}><span>角 {i+1}</span>{p.map((v,j)=><input key={j} aria-label={`角 ${i+1} ${j?'y':'x'}`} type="number" min="0" max="1" step=".001" value={v} onChange={e=>patch(chosen.id,{outline:chosen.outline.map((a,k)=>k===i?a.map((b,l)=>l===j?Number(e.target.value):b) as Vec:a)})}/>)}<button disabled={chosen.outline.length<=3} onClick={()=>patch(chosen.id,{outline:chosen.outline.filter((_,k)=>k!==i)})}>删除角点</button></div>)}<button disabled={chosen.outline.length>=8} onClick={()=>{const a=chosen.outline.at(-1)!,b=chosen.outline[0];patch(chosen.id,{outline:[...chosen.outline,[(a[0]+b[0])/2,(a[1]+b[1])/2]]})}}>增加角点（拖到真实角）</button>
    </details>
    <details className="review-part-details"><summary>连接关系编辑</summary>
    <label>连接到<select aria-label="连接到" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择目标零件</option>{draft.observations.filter(o=>o.id!==chosen.id&&!o.excluded).map(o=><option key={o.id}>{o.id}</option>)}</select></label><label>关系<select aria-label="关系意图" value={intent} onChange={e=>setIntent(e.target.value as typeof intent)}><option value="connect">必须整边连接</option><option value="separate">不得接触连接</option><option value="uncertain">不确定，仅作为线索</option></select></label><button disabled={!target||target===chosen.id} onClick={()=>edit({...draft,relations:[...draft.relations.filter(r=>!([r.from,r.to].includes(chosen.id)&&[r.from,r.to].includes(target))),{from:chosen.id,to:target,intent,evidence:'人工修正关系'}]})}>设置关系</button>
    </details>
   </fieldset>:<p>从表格选择零件，或点击「新增零件」。</p>}
   <details className="review-advanced"><summary>高级信息 / 编辑</summary>
    <label>输入类别<select aria-label="输入类别" disabled={busy} value={draft.sourceKind} onChange={e=>edit({...draft,sourceKind:e.target.value as Evidence['sourceKind']})}><option value="flat_photo">二维平铺照片</option><option value="diagram">平面示意图</option><option value="unsupported">超出支持范围</option></select></label>
    <label>输入说明 / 修正理由<textarea aria-label="输入说明 / 修正理由" disabled={busy} value={draft.reason} onChange={e=>edit({...draft,reason:e.target.value})}/></label>
    <p>{draft.observations.filter(o=>!o.excluded).length} 块采用 · {draft.relations.length} 个关系假设</p>
   <ul className="intake-relations">{draft.relations.map((r,i)=><li key={i}>{r.from} ↔ {r.to} · {r.intent}<p>{r.evidence}</p><button disabled={busy} onClick={()=>edit({...draft,relations:draft.relations.filter((_,j)=>i!==j)})}>删除关系</button></li>)}</ul>
   </details>
   </>}{!draft&&<p>请先从左栏打开 Analysis 或 Review。</p>}
  </section></StudioSlot>
  <StudioSlot column="inspector" stages={['reconstruction']}><section className="intake-controls reconstruction-controls" aria-label="几何重建操作"><h2>{workflowTerms.reconstruction.label}</h2><div className="context-notice-row"><p className="context-notice" title={review?review.id:'先保存或从左栏 History 选择 Review 快照'}>审核来源：{review?review.id.slice(0,8):'未保存 / 未选择'}</p><InfoHint label="几何重建来源">从左栏 History 选择 Review，或在识别审核中保存快照后再生成。生成使用该 Review 的 ID / Hash，Selected 不会被自动更改。</InfoHint></div>
<div className="source-library-row"><label className="compact-field">几何重建作品模式<select aria-label="几何重建作品模式" disabled={busy} value={mode} onChange={e=>setMode(e.target.value as WorkMode)}><option value="connected-construction">{workModeNames['connected-construction']}</option><option value="flat-mosaic">{workModeNames['flat-mosaic']}</option></select></label><InfoHint label="几何重建作品模式">整体连通要求作品连成一体；平面拼图按明确整边连接意图分组，允许按图片位置摆放独立组件，不虚构磁吸。此处只选择既有模式，不改变几何验证规则。</InfoHint></div><div className="button-row"><button className="primary" disabled={busy||!review} title={review?`使用 Review ${review.id}`:'先保存或选择 Review 快照'} onClick={()=>void run(async()=>{const r=await intakeApi<Reconstruction>('reconstruct',{reviewId:review!.id,reviewHash:review!.hash,mode});setMode(r.mode??'connected-construction');setResult(r);setCandidateId(r.candidates[0]?.id??'');setChecked(false);setMessage(resultMessage(r,review!.evidence));navigate('reconstruction');await refresh()})}>{reconstructionAction}</button></div></section></StudioSlot>
  <StudioSlot column="inspector" stages={['reconstruction']}><section className="intake-controls" aria-label="几何重建结果"><h3>候选与诊断</h3>
   {result&&<><p role="status"><b>{resultMessage(result,resultEvidence)}</b></p><p>几何重建作品模式：{workModeNames[result.mode??'connected-construction']}</p><ul>{result.diagnostics.map((d,i)=><li key={i}>{d}</li>)}</ul><p>搜索 {result.explored} 个状态{result.truncated?'（预算已用尽）':''}</p><label>候选<select aria-label="几何重建候选" value={candidateId} disabled={busy} onChange={e=>{setCandidateId(e.target.value);setChecked(false)}}>{result.candidates.map(c=><option key={c.id} value={c.id}>{c.id} · 偏差 {c.imageError.toFixed(3)}</option>)}</select></label></>}
   {candidate&&<><p><b>几何合法</b> · {candidate.assembly.instances.length} 片 / {candidate.connections} 条连接 · {candidate.components?.length??1} 个组件</p>{candidate.components?.map((c,i)=>{const links=validate(candidate.assembly.instances,profiles).connections.filter(e=>c.includes(e.a.tileId));return <details key={i}><summary>组件 {i+1}：{c.length} 片 / {links.length} 条真实连接</summary><p>{c.join('、')}</p>{links.map((e,j)=><p key={j}>{e.a.tileId}.{e.a.edgeId} ↔ {e.b.tileId}.{e.b.edgeId}</p>)}</details>})}<p>轮廓 RMS 偏差 {candidate.imageError.toFixed(3)}（标准边长=1） · {candidate.fidelity==='close'?'轮廓较接近':'需要重点修正'}。这不是识别准确率。</p><label className="intake-check"><input aria-label="已对照原图" type="checkbox" disabled={busy} checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已对照原图检查零件、颜色、形状和连接，接受此候选</label><button className="primary" disabled={busy||!checked} onClick={()=>void run(async()=>{await onApply(candidate.assembly,actual=>intakeApi<Origin>('origins',{reconstructionId:result!.id,reconstructionHash:result!.hash,candidateId:candidate.id,assembly:actual,visualChecked:checked}));await refresh();setMessage('已在作品编辑（Assembly）中打开，可编辑、保存作品并生成搭建教程。');navigate('assembly')})}>在作品编辑器中打开</button></>}
</section></StudioSlot>
  <StudioSlot column="inspector" stages={['assembly']}>
   {origin&&<p className="intake-origin">当前画布来源：图片 {origin.sourceId.slice(0,8)} / {origin.candidateId}。{origin.assemblyHash===currentHash?'与打开时的快照一致。':'已手动修改或修订，不再宣称与原候选完全一致。'}</p>}
</StudioSlot>
  <StudioSlot column="workflow" stages={[...workflowStages]}><div className="intake-feedback">
{draftAvailable&&analysis&&<div className="draft-recovery-row"><button onClick={()=>{try{const saved=JSON.parse(localStorage.getItem('magnetic-review-draft:'+analysis.id)||'null');if(!saved||saved.analysisHash!==analysis.hash)throw Error('草稿来源不匹配');edit(parseEvidence(saved.evidence));setMessage('已恢复本地未保存草稿；请另存审核快照。')}catch(e){setError(String(e))}}}>恢复本地审核草稿</button><InfoHint label="审核草稿恢复">此 Analysis 有本地未保存草稿。{review?'当前显示已保存审核快照。':'URL 不包含未保存的草稿内容。'}恢复后请另存 Review 快照。</InfoHint></div>}
<p className="context-notice" title={message} aria-live="polite">{busy?'正在处理… ':''}{message}</p>{error&&<p className="storage-error" role="alert">{error}</p>}{history.warnings.map(w=><p key={w} className="storage-error">{w}</p>)}</div></StudioSlot>
 </>
}

function CandidateView({candidate,selected,onSelect}:{candidate:Candidate;selected:string;onSelect:(id:string)=>void}){
 return <AssemblyPreview assembly={candidate.assembly} profiles={profiles} selected={selected} onSelect={onSelect} label="几何重建候选预览"/>
}
