import {SourceImageHistoryFilter} from '../brick-vision/SourceImageHistoryFilter'
import {historyForImage} from '../brick-vision/image-history.mjs'
import {designImageContext,analysisInImage} from './design-image-context'
import type {HistoryItem} from './reverse-types'
import {InfoHint} from '../brick-vision/InfoHint'
import { PartsGeometryPanel } from './PartsGeometryPanel'
import { SpatialPlanningHistory } from './SpatialPlanningHistory'
import {TraceLinks} from '../llm-traces/TraceLinks'
import {spatialPromptVersion} from './spatial-prompt-version.mjs'
import {GeometryIssues} from './GeometryIssues'
import {InspectorContent,InspectButton,InspectorContext} from './SpatialInspector'
import {GeometryRefinementPanel} from './GeometryRefinementPanel'
import { useContext, useEffect, useRef, useState } from 'react'
import { ModelSelector } from '../model-selector'
import { validateFinalAssembly } from './assembly'
import { geometrySupport, STUD_LDU, BODY_LDU, type Brick } from './catalog'
import {spatialStatus} from './spatial-status.mjs'

export type SpatialPreview={layoutKind?:'valid'|'diagnostic';bricks:Brick[];label:string;review:string;geometry:ReturnType<typeof validateFinalAssembly>}
type Props={onPreview(value:SpatialPreview|null):void;manualRevision:number;disabled:boolean;onBusy(busy:boolean):void;}
type History={id:string;analysisId?:string;createdAt:string;status:string;model?:string;usable?:boolean;state?:string;count?:number}
type Source={ready:boolean;reviewVersion:string;updatedAt:string;errors:string[];warnings:string[];rows:{id:string;excluded:boolean;quantity:number;confirmedPart:{part_num:string;color_id:number}|null}[]}
type Plan={partsSnapshotId?:string;partsInputMatch?:{status:string;reason?:string};provider?:string;model?:string;promptVersion?:string;generationSettings?:{reasoning?:{effort:string}};id:string;analysisId:string;status:string;usable:boolean;plan:unknown;rawOutput:string;image:{mimeType:string;imageBase64:string};validation:unknown;conversion:unknown;error:unknown;requestInput:{observations:{id:string;part:string;color:string;geometry:{bodySizeLdu:unknown}|null;confirmedPart?:{part_num:string};mapping?:{geometryBinding?:{basePartNum:string}}}[]}}
type Ranking={physicalTier:number;failedIntents:number;failedRanges:number;failedRelations:number;midpointDistanceLdu:number;yawPreference:number;explanation:string}
type CandidateSummary={id:string;kind?:string;rank?:number;ranking?:Ranking;layoutId?:string;bricks:Brick[];unverifiedCount?:number}
type LayoutDetail={kind?:string;id:string;rank?:number;assembly:{bricks:Brick[]};geometry:ReturnType<typeof validateFinalAssembly>;collision:{status:string};ranking?:Ranking;ranges:{id:string;satisfied:boolean}[];relations:{from:string;to:string;kind:string;satisfied:boolean|null}[];intents:{id:string;other:string;satisfied:boolean|null}[]}
type Geometry={search?:{complete:boolean;combinationCount:number;topK:number};validLayoutCount?:number;diagnosticCandidates?:CandidateSummary[];revisionId?:string;diagnosticAvailable?:boolean;id:string;planId:string;state:string;status:string;completeSearch:boolean;diagnostics:unknown[];rejectionSummary:unknown;error?:unknown;groups:unknown[];candidates:CandidateSummary[]}
const api='/api/brick-spatial/'
async function request(route:string,body?:unknown){const response=await fetch(api+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?240000:30000)});const value=await response.json();if(!response.ok)throw new Error(value.error||'请求失败');return value}
function urlPatch(values:Record<string,string>){const url=new URL(location.href);url.searchParams.set('workflow','spatial');url.searchParams.delete('generationId');for(const [key,value] of Object.entries(values)){if(value||key==='sourceImageId')url.searchParams.set(key,value);else url.searchParams.delete(key)}window.history.replaceState(null,'',url)}
export function SpatialAssemblyPanel({manualRevision,disabled,onBusy,onPreview}:Props){
 const [layoutChoice,setLayoutChoice]=useState<any>(null),[choiceRevision,setChoiceRevision]=useState(0)
 const [topK,setTopK]=useState(5),[savedSelections,setSavedSelections]=useState<{id:string;candidateId:string}[]>([])
 const [debugRefinement,setDebugRefinement]=useState<any>(null)
 const inspector=useContext(InspectorContext)
 const [analyses,setAnalyses]=useState<HistoryItem[]>([]),[analysisId,setAnalysisId]=useState('')
 const [sourceImageId,setSourceImageId]=useState(''),[historyWarnings,setHistoryWarnings]=useState<string[]>([])
 const [source,setSource]=useState<Source|null>(null),[plans,setPlans]=useState<History[]>([]),[plan,setPlan]=useState<Plan|null>(null)
 const [runs,setRuns]=useState<History[]>([]),[geometry,setGeometry]=useState<Geometry|null>(null),[candidate,setCandidate]=useState(''),[detail,setDetail]=useState<LayoutDetail|null>(null)
 const [models,setModels]=useState<{id:string;label:string;provider:string;reasoningEffort?:string}[]>([]),[providers,setProviders]=useState<Record<string,boolean>>({}),[model,setModel]=useState('')
 const [promptReady,setPromptReady]=useState(false)
 const [evidence,setEvidence]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[operations,setOperations]=useState<{id:string;state:string;error?:string;planId?:string;geometryId?:string}[]>([])
 const [phase,setPhase]=useState(''),[stageError,setStageError]=useState({planning:'',geometry:''})
 const contextEpoch=useRef(0)
 const gate=useRef(false),boot=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{setCandidate('');setDetail(null);onPreview(null)},[manualRevision])
 async function action(work:()=>Promise<void>,stage=''){if(gate.current||disabled)return;gate.current=true;setBusy(true);onBusy(true);setError('');setPhase(stage);if(stage)setStageError(v=>({...v,[stage]:''}));try{await work()}catch(e){if(mounted.current){setError(String(e)+'；未自动重试。如等待超时，请刷新历史查看已保存结果。');if(stage)setStageError(v=>({...v,[stage]:String(e)}))}}finally{gate.current=false;if(mounted.current){setBusy(false);setPhase('');onBusy(false)}}}
 async function refresh(a=analysisId){
  const epoch=contextEpoch.current
  if(!a){setPlans([]);setOperations([]);return}
  const [p,o]=await Promise.all([request('plans'+(a?'?analysisId='+encodeURIComponent(a):'')),request('requests'+(a?'?analysisId='+encodeURIComponent(a):''))])
  if(epoch!==contextEpoch.current)return
  setPlans(p.items);setOperations(o.items)
 }
 useEffect(()=>{const focus=()=>{if(gate.current||disabled)return;void refresh(analysisId||plan?.analysisId||'').catch(e=>setError(String(e)));if(plan)void request('plans/'+plan.id).then(p=>setPlan(current=>current&&current.id===p.id?{...current,partsInputMatch:p.partsInputMatch}:current)).catch(e=>setError(String(e)))};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)},[analysisId,plan?.id,disabled])
 async function loadSource(a:string){const epoch=contextEpoch.current;setSource(null);if(!a)return;try{const next=await request('source/'+a);if(epoch===contextEpoch.current)setSource(next)}catch(e){if(epoch===contextEpoch.current)setNotice('当前审核暂不可读取：'+String(e)+'。仍可加载历史计划的已确认快照。')}}
 useEffect(()=>{let active=true;setLayoutChoice(null);if(geometry?.planId)void request('plan-choice/'+geometry.planId).then(value=>{if(active)setLayoutChoice(value)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[geometry?.id,choiceRevision])
 async function adoptLayout(){
  if(!geometry||!candidate||!layoutChoice?.eligible)return
  await action(async()=>{
   const key='brick-layout-adoption:'+geometry.id+':'+candidate
   const cached=JSON.parse(sessionStorage.getItem(key)||'null')
   const {completedRevision,...savedBody}=cached||{}
   let body=cached&&(!completedRevision||completedRevision===layoutChoice.choice.revision)?savedBody:null
   if(!body){body={requestId:crypto.randomUUID(),planId:geometry.planId,geometryId:geometry.id,candidateId:candidate,selectionKey:layoutChoice.selectionKey,expectedRevision:layoutChoice.choice.revision};sessionStorage.setItem(key,JSON.stringify(body))}
   try{
    const op=await request('select-layout',body)
    if(op.state!=='complete')throw Error(op.error||'采用未完成')
    sessionStorage.setItem(key,JSON.stringify({...body,completedRevision:op.choice.revision}));setChoiceRevision(n=>n+1)
    setSavedSelections((await request('selections?geometryId='+geometry.id)).items)
    const current=await request('plan-choice/'+op.planId);setLayoutChoice(current)
    setNotice('Layout '+op.selectionId+' 已保存；'+(current.choice.selectedSpatialPlanId===op.planId?'来源 Spatial '+op.planId+' 已同步采用。':'本次采用曾完成，但当前 Selected 已被其他操作更改；请检查后决定是否再次采用。'))
   }catch(e){
    // A stale CAS rejects before any adoption writes. A new click may explicitly retry
    // against the freshly read revision; all other failures retain the original request.
    if(String(e).includes('选择已被其他页面更新')){sessionStorage.removeItem(key);setChoiceRevision(n=>n+1)}
    throw Error(String(e)+'；采用请求 '+body.requestId+'。未确认整体完成；可再次点击 Use This Layout 重试。')
   }
  })
 }
 async function showCandidate(g:Geometry,cid:string,focus=true){
  if(focus)inspector.select('geometry')
  setCandidate('');setDetail(null);onPreview(null)
  const diagnostic=g.diagnosticCandidates?.some(c=>c.id===cid)
  const c=await request('geometry/'+g.id+(diagnostic?'/diagnostics/':'/candidates/')+cid)
  if(!diagnostic&&(!c.currentGeometry?.valid||!validateFinalAssembly(c.assembly.bricks).valid))throw new Error('候选当前几何校验失败')
  onPreview({bricks:c.assembly.bricks,label:(diagnostic?'Diagnostic Layout / ':'Valid Layout / ')+cid,review:diagnostic?'仅诊断 · 原计划约束未通过，不能选择为正式方案':g.revisionId?'Approved · '+g.revisionId:'可人工选择 · 未检查照片相似度',layoutKind:diagnostic?'diagnostic':'valid',geometry:validateFinalAssembly(c.assembly.bricks)})
  setCandidate(cid);setDetail(c);urlPatch({spatialPlanId:g.planId,geometryId:g.id,candidateId:cid,spatialPreview:'geometry'})
 }
 async function loadGeometry(gid:string,expectedPlan:string,cid?:string,restore=false){
  if(!restore)inspector.select('geometry')
  const params=new URL(location.href).searchParams
  const previewKind=restore?(params.get('spatialPreview')||(params.has('refinementId')?'refinement':'geometry')):null
  setGeometry(null);setCandidate('');setDetail(null);onPreview(null)
  const g:Geometry=await request('geometry/'+gid)
  if(g.planId!==expectedPlan)throw new Error('Geometry 与当前 Spatial Plan 不匹配')
  setStageError(v=>({...v,geometry:''}));urlPatch({spatialPlanId:expectedPlan,geometryId:gid,candidateId:'',spatialPreview:previewKind||'geometry'})
  if(g.diagnosticAvailable){const v=await request('geometry/'+gid+'/viewer');if(v.diagnosticAssembly)onPreview({bricks:v.diagnosticAssembly.bricks,label:'Diagnostic / '+gid,review:'诊断布局 · 非合法候选',layoutKind:'diagnostic',geometry:validateFinalAssembly(v.diagnosticAssembly.bricks)})}
  const selections=(await request('selections?geometryId='+gid)).items;setSavedSelections(selections)
  const available=[...g.candidates,...(g.diagnosticCandidates||[])]
  const preferred=cid||selections[0]?.candidateId
  if(g.state==='complete'&&available.length)await showCandidate(g,available.some(c=>c.id===preferred)?preferred:available[0].id,!restore)
  setGeometry(g)
 }
 async function loadPlan(pid:string,gid?:string,cid?:string,context?:{records:HistoryItem[];imageId:string|null;analysisId:string}){
  const p:Plan=await request('plans/'+pid)
  if(context?.analysisId&&context.analysisId!==p.analysisId)throw Error('Spatial 与 URL Analysis 上下文不一致')
  const scope=designImageContext(context?.records??analyses,p.analysisId,context?context.imageId:sourceImageId)
  contextEpoch.current++
  if(!gid)inspector.select('planning')
  setPlan(null);setGeometry(null);setCandidate('');setDetail(null);onPreview(null);setRuns([]);setSavedSelections([]);setDebugRefinement(null)
  setPlan(p);setStageError({planning:'',geometry:''});setAnalysisId(scope.analysisId);setSourceImageId(scope.imageId);setNotice(scope.warning)
  urlPatch({sourceImageId:scope.imageId,analysisId:p.analysisId,spatialPlanId:pid,geometryId:'',candidateId:''})
  const r=await request('geometry?planId='+pid);setRuns(r.items)
  await refresh(p.analysisId);await loadSource(p.analysisId)
  if(gid||r.items[0]?.id)await loadGeometry(gid||r.items[0].id,pid,cid,!!gid)
 }
 useEffect(()=>{if(disabled||boot.current)return;boot.current=true;void action(async()=>{
  const params=new URL(location.href).searchParams
  const [s,h]=await Promise.all([request('status'),fetch('/api/brick-reverse/history').then(r=>{if(!r.ok)throw new Error('Analysis 历史不可用');return r.json()})])
  setPromptReady(s.prompt?.current===true&&s.prompt.version===spatialPromptVersion);setModels(s.models);setProviders(s.providers);setModel(params.get('spatialModel')||s.models[0]?.id||'');setAnalyses(h.items);setHistoryWarnings(h.warnings)
  const pid=params.get('spatialPlanId');if(pid)await loadPlan(pid,params.get('geometryId')||undefined,params.get('candidateId')||undefined,{records:h.items,imageId:params.get('sourceImageId'),analysisId:params.get('analysisId')||''});else {const scope=designImageContext(h.items,params.get('analysisId')||'',params.get('sourceImageId'));setSourceImageId(scope.imageId);setAnalysisId(scope.analysisId);setNotice(scope.warning);urlPatch({sourceImageId:scope.imageId,analysisId:scope.analysisId});await refresh(scope.analysisId);await loadSource(scope.analysisId)}
 })},[disabled])
 function clearViewedContext(a:string,imageId:string){
  contextEpoch.current++
  setAnalysisId(a);setSourceImageId(imageId);setSource(null);setPlan(null);setGeometry(null);setCandidate('');setDetail(null);setRuns([]);setPlans([]);setOperations([]);setSavedSelections([]);setDebugRefinement(null);setStageError({planning:'',geometry:''});setNotice('');onPreview(null)
  urlPatch({sourceImageId:imageId,analysisId:a,spatialPlanId:'',geometryId:'',candidateId:'',refinementId:'',refinementCandidateId:'',spatialPreview:''})
 }
 function allowContextSwitch(){return !(plan||geometry||manualRevision>0)||window.confirm('切换图片或 Analysis 会替换当前预览，并可能丢弃未提交的人工编辑。确认已保存需要保留的修改后继续？')}
 function filterImage(imageId:string){
  if(gate.current||disabled||imageId===sourceImageId)return
  if(analysisInImage(analyses,imageId,analysisId)){setSourceImageId(imageId);urlPatch({sourceImageId:imageId});return}
  if(!allowContextSwitch())return
  clearViewedContext('',imageId)
 }
 function chooseAnalysis(a:string){
  if(gate.current||disabled||a===analysisId)return
  if(a&&!analysisInImage(analyses,sourceImageId,a)){setError('Analysis 不属于当前图片筛选范围');return}
  if(!allowContextSwitch())return
  clearViewedContext(a,sourceImageId);void action(async()=>{await refresh(a);await loadSource(a)})
 }
 async function generate(prepareOnly=false){if(!source?.ready||!model||!promptReady||!analysisInImage(analyses,sourceImageId,analysisId))return;inspector.select('planning');await action(async()=>{
  setNotice('Parts Input Preparation：校验并保存零件输入…')
  const preparedResponse=await fetch('/api/brick-parts-inputs/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({analysisId,reviewVersion:source.reviewVersion})})
  const prepared=await preparedResponse.json();if(!preparedResponse.ok)throw Error(prepared.error)
  const op=await request(prepareOnly?'prepare':'plan',{requestId:crypto.randomUUID(),analysisId,partsSnapshotId:prepared.partsSnapshotId,preparationContextId:prepared.preparationContextId,model,includeEvidence:evidence,promptVersion:spatialPromptVersion})
  await refresh();if(op.state!=='complete'||!op.planId)throw new Error(op.error||'请求仍未完成；请刷新历史，勿重复生成')
  await loadPlan(op.planId);setNotice(prepareOnly?'请求已准备并保存，未调用 LLM；缺少几何 Profile 的零件仍保留为未知。':'Spatial Plan 已保存。Geometry Execution 需要另行点击。')
 },'planning')}
 async function execute(){if(!plan?.usable)return;inspector.select('geometry');await action(async()=>{
  setCandidate('');setDetail(null);onPreview(null)
  const op=await request('execute',{requestId:crypto.randomUUID(),planId:plan.id,analysisId:plan.analysisId,topK})
  if(op.state!=='complete'||!op.geometryId)throw new Error(op.error||'执行未完成')
  const r=await request('geometry?planId='+plan.id);setRuns(r.items)
  await loadGeometry(op.geometryId,plan.id);await refresh()
 },'geometry')}
 const availableCandidates=[...(geometry?.candidates||[]),...(geometry?.diagnosticCandidates||[])]
 const activeCandidate=availableCandidates.find(c=>c.id===candidate)
 const differences=activeCandidate?.bricks.flatMap(b=>{const first=availableCandidates[0]?.bricks.find(x=>x.id===b.id);return first&&JSON.stringify(first)!==JSON.stringify(b)?[{id:b.id,baseline:{x:first.x,z:first.z,layer:first.layer,rotation:first.rotation},selected:{x:b.x,z:b.z,layer:b.layer,rotation:b.rotation}}]:[]})||[]
 const planningStatus=spatialStatus('planning',plan,{running:phase==='planning',error:stageError.planning})
 const geometryStatus=spatialStatus('geometry',geometry,{running:phase==='geometry',error:stageError.geometry})
 const selected=models.find(m=>m.id===model)
 return <section className="brick-panel brick-spatial" aria-label="Spatial Assembly">
  <h2>Spatial Assembly <InfoHint label="Spatial Assembly">审核输入 → 空间计划 → 几何结果。各阶段独立保存；加载历史和执行几何不调用模型。</InfoHint></h2>
  <fieldset disabled={disabled||busy}>
   <SourceImageHistoryFilter records={analyses} value={sourceImageId} disabled={disabled||busy} onChange={filterImage} hint="仅按正式 Source Image 筛选。切换图片可能清空当前预览，不改变任何 Selected，也不准备或生成规划。"/>
   <label>已有 Analysis / Review<select aria-label="Spatial Analysis" value={analysisId} onChange={e=>chooseAnalysis(e.target.value)}><option value="">选择已有分析</option>{historyForImage(analyses,sourceImageId).map(a=><option key={a.id} value={a.id} title={a.id}>{a.id.slice(0,8)} · {a.image_reference?.name} · {a.status}</option>)}</select></label>
   {analysisId&&<a href={import.meta.env.BASE_URL+'brick-inventory.html?analysisId='+encodeURIComponent(analysisId)+'&sourceImageId='+encodeURIComponent(analyses.find(a=>a.id===analysisId)!.sourceImageId)}>返回 Part Explorer 审核型号与颜色 ↗</a>}
   {!!historyWarnings.length&&<details><summary>History · {historyWarnings.length} 条诊断</summary><ul>{historyWarnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
   <InspectorContent step="planning" disabled={disabled||busy}><p>{planningStatus.reason}</p>   {source&&<details><summary>当前已保存审核 · {source.rows.filter(r=>!r.excluded&&r.confirmedPart).length} 个确认项</summary><ul>{source.rows.map(r=><li key={r.id}>{r.id} · {r.excluded?'已排除':r.confirmedPart?r.confirmedPart.part_num+' / RB Color '+r.confirmedPart.color_id+' × '+r.quantity:'未确认'}</li>)}</ul>{source.warnings.map(w=><p key={w}>{w}</p>)}{source.errors.map(e=><p key={e} className="brick-error">{e}</p>)}</details>}</InspectorContent>
   <PartsGeometryPanel />
   <h3 className="workflow-step-title">1 · Spatial Planning <InspectButton step="planning"/></h3>
   <div data-testid="planning-state" className={"spatial-state "+planningStatus.tone} role="status"><strong>{planningStatus.label}</strong><small>计划状态不代表几何验证通过。</small></div>
   <ModelSelector models={models} value={{id:model,provider:selected?.provider||''}} label="Spatial Planning Provider / 模型（独立于图片识别）" onChange={m=>{setModel(m.id);urlPatch({spatialModel:m.id})}}/>
   <details className="workflow-options"><summary>视觉证据设置</summary>
   <label><input type="checkbox" checked={evidence} onChange={e=>setEvidence(e.target.checked)}/>使用已保存 Analysis / Relations 视觉证据</label>
</details>
   <button type="button" disabled={!promptReady||!source?.ready||!selected} onClick={()=>void generate(true)}>准备 Parts Input 与请求（不调用 LLM）</button>
   <p>请求 Prompt：{spatialPromptVersion}</p>
   {!promptReady&&<p role="alert" className="brick-error">服务端 Prompt 未就绪或与页面版本不一致，请重启开发服务并刷新页面。已禁止准备和模型调用。</p>}
   <p role="status" data-testid="spatial-next-model">即将调用：{selected?`${selected.provider} / ${selected.id}${selected.reasoningEffort?' · reasoning: '+selected.reasoningEffort:''}`:'模型不可用：'+model}。仅点击生成按钮才调用模型。</p>
   {(!selected||!providers[selected.provider])&&<p role="alert" className="brick-error">{!selected?'所选模型未登记或配置尚未加载，请明确选择可用模型。':'该 Provider 未配置 API Key，无法调用。'}不会自动切换模型。</p>}
   <button type="button" className="brick-primary" disabled={!promptReady||!source?.ready||!selected||!providers[selected.provider]} onClick={()=>void generate()}>生成新的 Spatial Plan（调用模型）</button>
   {plan&&<p data-testid="spatial-record-model">当前记录{plan.rawOutput?'实际调用':'准备请求'}：{plan.provider||'未记录 Provider'} / {plan.model||'未记录 Model'} · Prompt：{plan.promptVersion||'未记录'}{plan.generationSettings?.reasoning?.effort?' · reasoning: '+plan.generationSettings.reasoning.effort:''}</p>}
   {plan&&<div className="vision-history-line"><span>Parts Input · {plan.partsInputMatch?.status||'Unknown'}</span><InfoHint label="Parts Input 状态">Current：与当前审核及几何定义一致。Outdated：有效输入已变化。Unknown：历史未记录或无法确认。不会改变 Selected。</InfoHint><details><summary>Snapshot 证据</summary><pre>{JSON.stringify({partsSnapshotId:plan.partsSnapshotId,match:plan.partsInputMatch},null,2)}</pre></details></div>}
   <TraceLinks source="spatial" id={plan?.id}/>
   <SpatialPlanningHistory choiceRevision={choiceRevision} runs={plans} loadedId={plan?.id} disabled={disabled || busy} onLoad={id => {
     if (plan && id !== plan.id && !window.confirm('切换 Spatial 会替换当前预览，并可能丢弃未提交的人工编辑。确认已保存需要保留的修改后继续？')) return
     void action(() => loadPlan(id))
   }} />

   <details className="workflow-options"><summary>历史读取操作</summary><button type="button" onClick={() => void action(async () => { await refresh(); await loadSource(analysisId); if (plan) setRuns((await request('geometry?planId=' + plan.id)).items) })}>重新读取历史与当前审核</button></details>
   {plan&&<><InspectorContent step="planning" disabled={disabled||busy}><p data-testid="spatial-plan-status">计划：{plan.status} · {plan.id} · {plan.usable?'可执行（非几何成功）':'不可执行'}</p>
    {plan.image&&<img className="spatial-reference" src={'data:'+plan.image.mimeType+';base64,'+plan.image.imageBase64} alt="Spatial Assembly 原始参考照片"/>}
    <details><summary>本计划的确认零件快照 · {(plan.requestInput?.observations||[]).length} 块</summary><ul>{(plan.requestInput?.observations||[]).map(o=><li key={o.id}>{o.id} · {o.part} / {o.color} · LDU {o.geometry?JSON.stringify(o.geometry.bodySizeLdu):'未知：缺少经审核几何 Profile，禁止假定尺寸/接口'}</li>)}</ul><small>历史计划使用生成时的审核快照；重新审核不会覆盖旧计划。</small></details>
    {(plan.requestInput?.observations||[]).filter(o=>o.mapping?.geometryBinding).map(o=><p key={o.id} className="spatial-state review">{o.id} · {o.confirmedPart?.part_num}：印花未渲染；使用基础 {o.mapping!.geometryBinding!.basePartNum} 的真实几何与接口，原始型号和颜色保留。</p>)}
    {(plan.requestInput?.observations||[]).some(o=>!geometrySupport(o.part).supported)&&<p className="spatial-state review">当前共享库仍缺少 Geometry Profile：{plan.requestInput.observations.filter(o=>!geometrySupport(o.part).supported).map(o=>o.id).join('、')}。</p>}
    {(plan.requestInput?.observations||[]).some(o=>!o.geometry&&geometrySupport(o.part).supported)&&<p>部分历史快照的几何未知；执行时将单独记录新审核 Profile，不修改原始计划。</p>}
    <details><summary>查看 Spatial Plan 与不确定性（只读）</summary><pre>{JSON.stringify({plan:plan.plan,validation:plan.validation,conversion:plan.conversion,error:plan.error},null,2)}</pre></details>
    <details><summary>LLM 原始回答</summary><pre>{plan.rawOutput||'尚无模型输出'}</pre></details>
    <a href={api+'plans/'+plan.id+'/trace'} download>下载完整 Spatial Trace（含 Raw Request/Response）</a>
    </InspectorContent><h3 className="workflow-step-title">2 · Geometry Execution <InspectButton step="geometry"/></h3><div data-testid="geometry-state" className={"spatial-state "+geometryStatus.tone} role={geometryStatus.tone==='failed'?'alert':'status'}><strong>{geometryStatus.label}</strong></div><label>候选数量<select aria-label="Top K" value={topK} onChange={e=>setTopK(Number(e.target.value))}><option value={5}>Top 5</option><option value={10}>Top 10</option></select></label><button className="brick-primary" disabled={!plan.usable} onClick={()=>void execute()}>执行 Geometry（不调用 LLM）</button>
    <label>已保存 Geometry Result<select aria-label="Geometry history" value={geometry?.id||''} onChange={e=>{if(e.target.value)void action(()=>loadGeometry(e.target.value,plan.id))}}><option value="">选择已保存几何结果</option>{runs.map(r=><option key={r.id} value={r.id}>{r.createdAt} · {r.state} / {r.status} · {r.count} 候选</option>)}</select></label>
   </>}
   {!plan&&<><h3 className="workflow-step-title">2 · Geometry Execution <InspectButton step="geometry"/></h3><p className="workflow-status idle">Not Run · 等待 Spatial Plan</p></>}
   {!geometry&&<><h3 className="workflow-step-title">3 · Geometry Refinement <InspectButton step="refinement"/></h3><p className="workflow-status idle">Not Run · 等待 Geometry Result</p></>}
   {!plan&&<p className="brick-help">选择历史计划或生成新计划后，继续 Geometry 与 Refinement。</p>}
   <InspectorContent step="planning">{!plan&&<p>尚未加载 Spatial Plan；可先查看审核或选择历史记录。</p>}</InspectorContent>
   <InspectorContent step="geometry">{!geometry&&<><p>{geometryStatus.reason}</p><p>Not Run · 尚未加载 Geometry Result；没有候选或诊断布局。</p></>}</InspectorContent>
   {!geometry&&<InspectorContent step="refinement"><p>Not Run · 先选择 Geometry Result，再查看 Refinement 历史。</p></InspectorContent>}
   {geometry&&<><GeometryIssues selectedLayout={detail} geometryId={geometry.id} refinement={debugRefinement} onPreview={onPreview}/><InspectorContent step="geometry" disabled={disabled||busy}><p>{geometryStatus.reason}</p>{geometry.revisionId&&<p className="spatial-state review">当前为人工修订 {geometry.revisionId} 的执行结果；原始 LLM 计划未被修改。</p>}<p data-testid="spatial-geometry-status">Geometry：{geometry.state} / {geometry.status} · {geometry.candidates.length} 候选 / {geometry.groups.length} 布局</p>
</InspectorContent>
    {!!availableCandidates.length&&<label>候选布局（预览不会自动批准）<select aria-label="Spatial candidate" value={candidate} onChange={e=>{if(e.target.value)void action(()=>showCandidate(geometry,e.target.value))}}><option value="">选择候选</option>{availableCandidates.map(c=><option key={c.id} value={c.id}>#{c.rank??''} {c.id} · {c.kind==='diagnostic'?'Diagnostic':'Valid'}{c.ranking?` · 物理${c.ranking.physicalTier===0?'通过':'失败'} / 连接冲突 ${c.ranking.failedIntents} / 空间冲突 ${c.ranking.failedRelations}`:''}</option>)}</select></label>}
    {geometry.search&&<p>已保存 Top {geometry.search.topK} · {geometry.search.complete?'完整过滤域排名':'未完成搜索，不是全局 Top-K'} · {geometry.search.complete?'已验证':'待搜索'} {geometry.search.combinationCount} 组 · 合法 {geometry.validLayoutCount??0} 组。更改 Top-K 后需主动重新执行。</p>}
    {detail&&<div className={'spatial-state '+(detail.kind==='diagnostic'?'failed':'success')}>
      <strong>{detail.kind==='diagnostic'?'Diagnostic Layout · 不可作为正式方案':'Valid Layout · 可人工选择'} / {candidate}</strong>
      <p>物理检查：{detail.geometry.valid?'通过':'未通过'} · 碰撞：{detail.collision.status} · 连接意图：{detail.intents.filter(i=>i.satisfied===true).length} 满足 / {detail.intents.filter(i=>i.satisfied===false).length} 失败 · 硬关系：{detail.relations.filter(r=>r.satisfied===true).length} 满足 / {detail.relations.filter(r=>r.satisfied===false).length} 失败 · 区间：{detail.ranges.filter(r=>r.satisfied).length}/{detail.ranges.length}</p>
      {detail.ranking&&<><p>相对区间中心偏差总和：{detail.ranking.midpointDistanceLdu} LDU · yaw 顺序偏好：{detail.ranking.yawPreference}</p><details><summary>排序依据与限制</summary>{detail.ranking.explanation}</details></>}
      <details><summary>逐项检查：满足 / 违反 / 未验证</summary>
        <ul>{detail.intents.map((c,i)=><li key={'intent'+i}>{c.id} ↔ {c.other} 接合：{c.satisfied===null?'未验证':c.satisfied?'满足':'违反'}</li>)}{detail.relations.map((r,i)=><li key={'relation'+i}>{r.from} {r.kind} {r.to}：{r.satisfied===null?'未验证':r.satisfied?'满足':'违反'}</li>)}{detail.ranges.map(r=><li key={'range'+r.id}>{r.id} 相对位置区间：{r.satisfied?'满足':'违反'}</li>)}</ul>
      </details>
      <p>未验证视觉关系：{detail.relations.filter(r=>r.satisfied===null).length} · 不确定接合意图：{detail.intents.filter(i=>i.satisfied===null).length}；物理合法不代表照片相似度已验证。</p>
      {detail.kind!=='diagnostic'&&<button disabled={!layoutChoice?.eligible} onClick={()=>void adoptLayout()}>Use This Layout</button>}

      {savedSelections.some(s=>s.candidateId===candidate)&&<p>已独立保存选择：{savedSelections.find(s=>s.candidateId===candidate)?.id}；原始计划与 Geometry Result 未修改。 <a href={import.meta.env.BASE_URL+'brick-test.html?workflow=build&selectionId='+savedSelections.find(s=>s.candidateId===candidate)!.id} target="_blank" rel="noreferrer">Build Order · 创建 / 编辑步骤 ↗</a></p>}
    </div>}
    <InspectorContent step="geometry" disabled={disabled||busy}>    {detail&&candidate&&<p data-testid="spatial-connection-status">{detail.kind==='diagnostic'?'Diagnostic · 非合法完整方案':'Valid Layout'} · 物理 {detail.geometry.valid?'Valid':'Invalid'} · {detail.geometry.connections.length} 对连接 · {detail.geometry.connections.reduce((n,c)=>n+c.points.length,0)} 个接合点 · 碰撞：{detail.collision.status}</p>}
    <p data-testid="spatial-viewer-status">{candidate?'已在共享 BrickViewer 显示 '+candidate+'；未检查 Build Order。':'诊断与 Refinement 预览身份以中间 Viewer 标注为准。'}</p>
    <p>{candidate&&(differences.length?`相对首个候选，${differences.length} 块的位置或朝向不同；展开查看。`:"与首个候选位置和朝向一致。")}</p>
    {!!differences.length&&<details><summary>相对排名第一的主要变化</summary><ul>{differences.map(d=><li key={d.id}>{d.id}：ΔX {(d.selected.x-d.baseline.x)*STUD_LDU} / ΔY {(d.selected.layer-d.baseline.layer)*BODY_LDU} / ΔZ {(d.selected.z-d.baseline.z)*STUD_LDU} LDU；yaw {d.baseline.rotation}° → {d.selected.rotation}°</li>)}</ul></details>}
    <details><summary>连接、碰撞、差异与失败原因</summary><pre>{JSON.stringify({differencesFromFirst: differences,completeSearch:geometry.completeSearch,diagnostics:geometry.diagnostics,rejectionSummary:geometry.rejectionSummary,error:geometry.error,candidate:detail},null,2)}</pre></details>
    {geometry.diagnosticAvailable&&<p><a target="_blank" rel="noreferrer" href={import.meta.env.BASE_URL+'experiments/geometry-execution/viewer.html?result='+encodeURIComponent(api+'geometry/'+geometry.id+'/viewer')}>查看零件原始布局诊断（非合法候选） ↗</a></p>}
    <a href={api+'geometry/'+geometry.id+'/report'} download>下载完整 Geometry Report</a>
</InspectorContent>
    {plan&&<GeometryRefinementPanel onDiagnostics={setDebugRefinement} onPreview={value=>{setDetail(null);setCandidate('');onPreview(value)}} key={geometry.id} planId={plan.id} geometryId={geometry.id} eligible={plan.usable&&geometry.state==='complete'&&!geometry.candidates.length&&!geometry.revisionId} disabled={disabled||busy} onBusy={onBusy} onExecuted={async gid=>{await loadGeometry(gid,plan.id);setRuns((await request('geometry?planId='+plan.id)).items)}}/>}
   </>}
  </fieldset>
  {busy&&<p role="status">处理中，请勿重复提交。不会自动 Repair 或重新调用模型。</p>}
  {error&&<p role="alert" className="brick-error">{error}</p>}{(notice||error)&&<><p className="brick-help">{error?'操作失败；完整原因见 Inspector。':'操作信息已保存，详情见 Inspector。'}<InspectButton step="planning"/></p><InspectorContent step="planning">{notice&&<p>{notice}</p>}{error&&<p role="alert" className="brick-error">{error}</p>}</InspectorContent></>}
  <InspectorContent step="planning">{!!operations.filter(o=>o.state!=='complete').length&&<details><summary>未完成 / 失败操作</summary><pre>{JSON.stringify(operations.filter(o=>o.state!=='complete'),null,2)}</pre></details>}</InspectorContent>
 </section>
}
