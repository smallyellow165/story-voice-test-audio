import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '../model-selector'
import { validateAssembly } from './assembly'
import { geometrySupport, type Brick } from './catalog'
import {spatialStatus} from './spatial-status.mjs'

type Props={manualRevision:number;disabled:boolean;onBusy(busy:boolean):void;onSceneChange(value:string):void;onApply(bricks:Brick[]):Promise<boolean>}
type History={id:string;analysisId?:string;createdAt:string;status:string;model?:string;usable?:boolean;state?:string;count?:number}
type Source={ready:boolean;reviewVersion:string;updatedAt:string;errors:string[];warnings:string[];rows:{id:string;excluded:boolean;quantity:number;confirmedPart:{part_num:string;color_id:number}|null}[]}
type Plan={id:string;analysisId:string;status:string;usable:boolean;plan:unknown;rawOutput:string;image:{mimeType:string;imageBase64:string};validation:unknown;conversion:unknown;error:unknown;requestInput:{observations:{id:string;part:string;color:string;geometry:{bodySizeLdu:unknown}|null}[]}}
type Geometry={diagnosticAvailable?:boolean;id:string;planId:string;state:string;status:string;completeSearch:boolean;diagnostics:unknown[];rejectionSummary:unknown;error?:unknown;groups:unknown[];candidates:{id:string;layoutId:string;bricks:Brick[];unverifiedCount:number}[]}
const api='/api/brick-spatial/'
async function request(route:string,body?:unknown){const response=await fetch(api+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?240000:30000)});const value=await response.json();if(!response.ok)throw new Error(value.error||'请求失败');return value}
function urlPatch(values:Record<string,string>){const url=new URL(location.href);url.searchParams.set('workflow','spatial');url.searchParams.delete('generationId');for(const [key,value] of Object.entries(values)){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key)}window.history.replaceState(null,'',url)}
export function SpatialAssemblyPanel({manualRevision,disabled,onBusy,onApply,onSceneChange}:Props){
 const [analyses,setAnalyses]=useState<{id:string;appearance:string}[]>([]),[analysisId,setAnalysisId]=useState(new URL(location.href).searchParams.get('analysisId')||'')
 const [source,setSource]=useState<Source|null>(null),[plans,setPlans]=useState<History[]>([]),[plan,setPlan]=useState<Plan|null>(null)
 const [runs,setRuns]=useState<History[]>([]),[geometry,setGeometry]=useState<Geometry|null>(null),[candidate,setCandidate]=useState(''),[detail,setDetail]=useState<{geometry:{valid:boolean;connections:{points:unknown[]}[]};collision:{status:string};[key:string]:unknown}|null>(null)
 const [models,setModels]=useState<{id:string;label:string;provider:string}[]>([]),[providers,setProviders]=useState<Record<string,boolean>>({}),[model,setModel]=useState('')
 const [evidence,setEvidence]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[operations,setOperations]=useState<{id:string;state:string;error?:string;planId?:string;geometryId?:string}[]>([])
 const [phase,setPhase]=useState(''),[stageError,setStageError]=useState({planning:'',geometry:''})
 const gate=useRef(false),boot=useRef(false),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{setCandidate('');setDetail(null);onSceneChange('')},[manualRevision])
 async function action(work:()=>Promise<void>,stage=''){if(gate.current||disabled)return;gate.current=true;setBusy(true);onBusy(true);setError('');setPhase(stage);if(stage)setStageError(v=>({...v,[stage]:''}));try{await work()}catch(e){if(mounted.current){setError(String(e)+'；未自动重试。如等待超时，请刷新历史查看已保存结果。');if(stage)setStageError(v=>({...v,[stage]:String(e)}))}}finally{gate.current=false;if(mounted.current){setBusy(false);setPhase('');onBusy(false)}}}
 async function refresh(a=analysisId){
  const [p,o]=await Promise.all([request('plans'+(a?'?analysisId='+encodeURIComponent(a):'')),request('requests'+(a?'?analysisId='+encodeURIComponent(a):''))])
  setPlans(p.items);setOperations(o.items)
 }
 async function loadSource(a:string){setSource(null);if(!a)return;try{setSource(await request('source/'+a))}catch(e){setNotice('当前审核暂不可读取：'+String(e)+'。仍可加载历史计划的已确认快照。')}}
 async function showCandidate(g:Geometry,cid:string){
  setCandidate('');setDetail(null);onSceneChange('')
  const c=await request('geometry/'+g.id+'/candidates/'+cid)
  if(!c.currentGeometry?.valid||!validateAssembly(c.assembly.bricks).valid)throw new Error('候选当前几何校验失败')
  if(!await onApply(c.assembly.bricks))throw new Error('Viewer 未完整加载，未标为显示成功')
  setCandidate(cid);setDetail(c);onSceneChange(cid);urlPatch({spatialPlanId:g.planId,geometryId:g.id,candidateId:cid})
 }
 async function loadGeometry(gid:string,expectedPlan:string,cid?:string){
  setGeometry(null);setCandidate('');setDetail(null);onSceneChange('')
  const g:Geometry=await request('geometry/'+gid)
  if(g.planId!==expectedPlan)throw new Error('Geometry 与当前 Spatial Plan 不匹配')
  setGeometry(g);setStageError(v=>({...v,geometry:''}));urlPatch({spatialPlanId:expectedPlan,geometryId:gid,candidateId:''})
  if(g.state==='complete'&&g.candidates.length)await showCandidate(g,g.candidates.some(c=>c.id===cid)?cid!:g.candidates[0].id)
 }
 async function loadPlan(pid:string,gid?:string,cid?:string){
  setPlan(null);setGeometry(null);setCandidate('');setDetail(null);onSceneChange('');setRuns([])
  const p:Plan=await request('plans/'+pid);setPlan(p);setStageError({planning:'',geometry:''});setAnalysisId(p.analysisId)
  urlPatch({analysisId:p.analysisId,spatialPlanId:pid,geometryId:'',candidateId:''})
  const r=await request('geometry?planId='+pid);setRuns(r.items)
  await refresh(p.analysisId);await loadSource(p.analysisId)
  if(gid)await loadGeometry(gid,pid,cid)
 }
 useEffect(()=>{if(disabled||boot.current)return;boot.current=true;void action(async()=>{
  const params=new URL(location.href).searchParams
  const [s,h]=await Promise.all([request('status'),fetch('/api/brick-reverse/history').then(r=>{if(!r.ok)throw new Error('Analysis 历史不可用');return r.json()})])
  setModels(s.models);setProviders(s.providers);setModel(s.models[0]?.id||'');setAnalyses(h.items)
  const pid=params.get('spatialPlanId');if(pid)await loadPlan(pid,params.get('geometryId')||undefined,params.get('candidateId')||undefined);else {await refresh();await loadSource(params.get('analysisId')||'')}
 })},[disabled])
 async function generate(prepareOnly=false){if(!source?.ready||!model)return;await action(async()=>{
  const op=await request(prepareOnly?'prepare':'plan',{requestId:crypto.randomUUID(),analysisId,reviewVersion:source.reviewVersion,model,includeEvidence:evidence})
  await refresh();if(op.state!=='complete'||!op.planId)throw new Error(op.error||'请求仍未完成；请刷新历史，勿重复生成')
  await loadPlan(op.planId);setNotice(prepareOnly?'请求已准备并保存，未调用 LLM；缺少几何 Profile 的零件仍保留为未知。':'Spatial Plan 已保存。Geometry Execution 需要另行点击。')
 },'planning')}
 async function execute(){if(!plan?.usable)return;await action(async()=>{
  setCandidate('');setDetail(null);onSceneChange('')
  const op=await request('execute',{requestId:crypto.randomUUID(),planId:plan.id,analysisId:plan.analysisId})
  if(op.state!=='complete'||!op.geometryId)throw new Error(op.error||'执行未完成')
  const r=await request('geometry?planId='+plan.id);setRuns(r.items)
  await loadGeometry(op.geometryId,plan.id);await refresh()
 },'geometry')}
 const activeCandidate=geometry?.candidates.find(c=>c.id===candidate)
 const differences=activeCandidate?.bricks.flatMap(b=>{const first=geometry?.candidates[0]?.bricks.find(x=>x.id===b.id);return first&&JSON.stringify(first)!==JSON.stringify(b)?[{id:b.id,baseline:{x:first.x,z:first.z,layer:first.layer,rotation:first.rotation},selected:{x:b.x,z:b.z,layer:b.layer,rotation:b.rotation}}]:[]})||[]
 const planningStatus=spatialStatus('planning',plan,{running:phase==='planning',error:stageError.planning})
 const geometryStatus=spatialStatus('geometry',geometry,{running:phase==='geometry',error:stageError.geometry})
 const selected=models.find(m=>m.id===model)
 return <section className="brick-panel brick-spatial" aria-label="Spatial Assembly">
  <h2>Spatial Assembly</h2><p className="brick-help">已审核照片 → 空间计划 → 确定性组装。两个阶段独立保存；加载历史和执行几何均不调用模型。</p>
  <fieldset disabled={disabled||busy}>
   <label>已有 Analysis / Review<select aria-label="Spatial Analysis" value={analysisId} onChange={e=>{const a=e.target.value;setAnalysisId(a);setPlan(null);setGeometry(null);setCandidate('');setDetail(null);onSceneChange('');setSource(null);setNotice('');urlPatch({analysisId:a,spatialPlanId:'',geometryId:'',candidateId:''});void action(async()=>{await refresh(a);await loadSource(a)})}}><option value="">选择已有分析</option>{analyses.map(a=><option key={a.id} value={a.id}>{a.appearance?.slice(0,45)||a.id} · {a.id}</option>)}</select></label>
   {analysisId&&<a href={import.meta.env.BASE_URL+'brick-inventory.html?analysisId='+encodeURIComponent(analysisId)}>返回 Part Explorer 审核型号与颜色 ↗</a>}
   {source&&<details><summary>当前已保存审核 · {source.rows.filter(r=>!r.excluded&&r.confirmedPart).length} 个确认项</summary><ul>{source.rows.map(r=><li key={r.id}>{r.id} · {r.excluded?'已排除':r.confirmedPart?r.confirmedPart.part_num+' / RB Color '+r.confirmedPart.color_id+' × '+r.quantity:'未确认'}</li>)}</ul>{source.warnings.map(w=><p key={w}>{w}</p>)}{source.errors.map(e=><p key={e} className="brick-error">{e}</p>)}</details>}
   <h3>1 · Spatial Planning</h3>
   <div data-testid="planning-state" className={"spatial-state "+planningStatus.tone} role="status"><strong>{planningStatus.label}</strong><p>{planningStatus.reason}</p></div>
   <ModelSelector models={models} value={{id:model,provider:selected?.provider||''}} onChange={m=>setModel(m.id)}/>
   <label><input type="checkbox" checked={evidence} onChange={e=>setEvidence(e.target.checked)}/>使用已保存 Analysis / Relations 视觉证据</label>
   <button type="button" disabled={!source?.ready||!selected} onClick={()=>void generate(true)}>检查 Mapping 并准备请求（不调用 LLM）</button>
   <button type="button" className="brick-primary" disabled={!source?.ready||!selected||!providers[selected.provider]} onClick={()=>void generate()}>生成新的 Spatial Plan（调用模型）</button>
   <label>已保存 Spatial Plan<select aria-label="Spatial Plan history" value={plan?.id||''} onChange={e=>{if(e.target.value)void action(()=>loadPlan(e.target.value))}}><option value="">选择历史计划（不调用模型）</option>{plans.map(p=><option key={p.id} value={p.id}>{p.createdAt} · {p.model} · {p.usable?'可执行':p.status} · {p.id}</option>)}</select></label>
   <button onClick={()=>void action(async()=>{await refresh();await loadSource(analysisId);if(plan)setRuns((await request('geometry?planId='+plan.id)).items)})}>刷新历史与审核（不生成）</button>
   {plan&&<><p data-testid="spatial-plan-status">计划：{plan.status} · {plan.id} · {plan.usable?'可执行（非几何成功）':'不可执行'}</p>
    {plan.image&&<img className="spatial-reference" src={'data:'+plan.image.mimeType+';base64,'+plan.image.imageBase64} alt="Spatial Assembly 原始参考照片"/>}
    <details open><summary>本计划的确认零件快照 · {(plan.requestInput?.observations||[]).length} 块</summary><ul>{(plan.requestInput?.observations||[]).map(o=><li key={o.id}>{o.id} · {o.part} / {o.color} · LDU {o.geometry?JSON.stringify(o.geometry.bodySizeLdu):'未知：缺少经审核几何 Profile，禁止假定尺寸/接口'}</li>)}</ul><small>历史计划使用生成时的审核快照；重新审核不会覆盖旧计划。</small></details>
    {(plan.requestInput?.observations||[]).some(o=>!geometrySupport(o.part).supported)&&<p className="spatial-state review">当前共享库仍缺少 Geometry Profile：{plan.requestInput.observations.filter(o=>!geometrySupport(o.part).supported).map(o=>o.id).join('、')}。</p>}
    {(plan.requestInput?.observations||[]).some(o=>!o.geometry&&geometrySupport(o.part).supported)&&<p>部分历史快照的几何未知；执行时将单独记录新审核 Profile，不修改原始计划。</p>}
    <details><summary>查看 Spatial Plan 与不确定性（只读）</summary><pre>{JSON.stringify({plan:plan.plan,validation:plan.validation,conversion:plan.conversion,error:plan.error},null,2)}</pre></details>
    <details><summary>LLM 原始回答</summary><pre>{plan.rawOutput||'尚无模型输出'}</pre></details>
    <a href={api+'plans/'+plan.id+'/trace'} download>下载完整 Spatial Trace（含 Raw Request/Response）</a>
    <h3>2 · Geometry Execution</h3><div data-testid="geometry-state" className={"spatial-state "+geometryStatus.tone} role={geometryStatus.tone==='failed'?'alert':'status'}><strong>{geometryStatus.label}</strong><p>{geometryStatus.reason}</p></div><button className="brick-primary" disabled={!plan.usable} onClick={()=>void execute()}>执行 Geometry（不调用 LLM）</button>
    <label>已保存 Geometry Result<select aria-label="Geometry history" value={geometry?.id||''} onChange={e=>{if(e.target.value)void action(()=>loadGeometry(e.target.value,plan.id))}}><option value="">选择已保存几何结果</option>{runs.map(r=><option key={r.id} value={r.id}>{r.createdAt} · {r.state} / {r.status} · {r.count} 候选</option>)}</select></label>
   </>}
   {!candidate&&<p>当前场景尚未加载所选计划的候选；已有积木不代表本计划执行成功。</p>}
   {geometry&&<><p data-testid="spatial-geometry-status">Geometry：{geometry.state} / {geometry.status} · {geometry.candidates.length} 候选 / {geometry.groups.length} 布局</p>
    {!!geometry.candidates.length&&<label>Geometry Candidate<select aria-label="Spatial candidate" value={candidate} onChange={e=>{if(e.target.value)void action(()=>showCandidate(geometry,e.target.value))}}><option value="">选择候选</option>{geometry.candidates.map(c=><option key={c.id} value={c.id}>{c.id} / {c.layoutId} · {c.unverifiedCount?'有未验证约束':'已验证几何与可执行约束'}</option>)}</select></label>}
    {detail&&candidate&&<p data-testid="spatial-connection-status">Geometry {detail.geometry.valid?'Valid':'Invalid'} · {detail.geometry.connections.length} 对连接 · {detail.geometry.connections.reduce((n,c)=>n+c.points.length,0)} 个接合点 · 碰撞：{detail.collision.status}</p>}
    <p data-testid="spatial-viewer-status">{candidate?'已在共享 BrickViewer 显示 '+candidate+'；未检查 Build Order。':'此结果尚未显示；场景可能仍是之前的内容。'}</p>
    <p>{candidate&&(differences.length?`相对首个候选，${differences.length} 块的位置或朝向不同；展开查看。`:"与首个候选位置和朝向一致。")}</p>
    <details><summary>连接、碰撞、差异与失败原因</summary><pre>{JSON.stringify({differencesFromFirst: differences,completeSearch:geometry.completeSearch,diagnostics:geometry.diagnostics,rejectionSummary:geometry.rejectionSummary,error:geometry.error,candidate:detail},null,2)}</pre></details>
    {geometry.diagnosticAvailable&&<p><a target="_blank" rel="noreferrer" href={import.meta.env.BASE_URL+'experiments/geometry-execution/viewer.html?result='+encodeURIComponent(api+'geometry/'+geometry.id+'/viewer')}>查看零件原始布局诊断（非合法候选，不替换当前场景） ↗</a></p>}
    <a href={api+'geometry/'+geometry.id+'/report'} download>下载完整 Geometry Report</a>
   </>}
  </fieldset>
  {busy&&<p role="status">处理中，请勿重复提交。不会自动 Repair 或重新调用模型。</p>}
  {notice&&<p>{notice}</p>}{error&&<p role="alert" className="brick-error">{error}</p>}
  {!!operations.filter(o=>o.state!=='complete').length&&<details><summary>未完成 / 失败操作</summary><pre>{JSON.stringify(operations.filter(o=>o.state!=='complete'),null,2)}</pre></details>}
 </section>
}
