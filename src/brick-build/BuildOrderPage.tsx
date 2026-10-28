import {InfoHint} from '../brick-vision/InfoHint'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {TraceLinks} from '../llm-traces/TraceLinks'
import {ThreeColumnLayout} from '../three-column-layout'
import {BrickViewer} from '../brick-test/viewer'
import {createBuildPlan,inspectBuildPlan,stepScene,withSteps} from './plan.mjs'
import type {BuildPlan,BuildSource,BuildStep} from './plan.mjs'
import example from '../../examples/build-order/penguin-v1.json'
import '../brick-test/brick-test.css'
import './build-order.css'

type SelectionItem={id:string;createdAt:string;analysisId:string;candidateId:string;count:number}
type PlanItem={id:string;title:string;status:string;updatedAt:string;complete:boolean}
type PlannerConfig={provider:string;model:string;settings:{reasoning?:{effort?:string}};configured:boolean;promptVersion:string}
type GenerationResult={ok?:boolean;traceId:string;status:string;error?:string|null;provider:string;model:string;settings:PlannerConfig['settings'];plan?:BuildPlan|null;validation?:unknown;diagnostic?:unknown;usage?:unknown}
async function request<T>(route:string,body?:unknown):Promise<T>{
 const response=await fetch('/api/brick-build/'+route,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const value=await response.json();if(!response.ok)throw Error(value.error||'Build Order 请求失败');return value
}
const defaultMotion={offsetLdu:{x:0,y:120,z:0},startYawDegrees:0}
function updateUrl(selectionId:string,planId=''){
 const url=new URL(location.href);url.searchParams.set('workflow','build');url.searchParams.set('selectionId',selectionId)
 if(planId)url.searchParams.set('buildPlanId',planId);else url.searchParams.delete('buildPlanId')
 history.replaceState(null,'',url)
}

export function BuildOrderPage(){
 const [selections,setSelections]=useState<SelectionItem[]>([]),[saved,setSaved]=useState<PlanItem[]>([])
 const [source,setSource]=useState<BuildSource|null>(null),[plan,setPlan]=useState<BuildPlan|null>(null)
 const [savedVersion,setSavedVersion]=useState<string|null>(null),[dirty,setDirty]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [planner,setPlanner]=useState<PlannerConfig|null>(null),[plannerError,setPlannerError]=useState('')
 const [generating,setGenerating]=useState(false),[generation,setGeneration]=useState<GenerationResult|null>(null)
 const generationLock=useRef(false)
 useEffect(()=>{let active=true;request<PlannerConfig>('planner-config').then(v=>{if(active)setPlanner(v)}).catch(e=>{if(active)setPlannerError(String(e))});return()=>{active=false}},[])
 const [selectedStepId,setSelectedStepId]=useState<string|null>(null),[replay,setReplay]=useState(0),[phase,setPhase]=useState('idle')
 const [viewError,setViewError]=useState(''),[ready,setReady]=useState(false)
 const [moving,setMoving]=useState(''),[target,setTarget]=useState(''),[description,setDescription]=useState('')
 const leftHost=useRef<HTMLDivElement>(null),rightHost=useRef<HTMLDivElement>(null)
 const left=useRef<BrickViewer|null>(null),right=useRef<BrickViewer|null>(null),autoPlay=useRef(false)
 const report=useMemo(()=>inspectBuildPlan(plan,source?.assembly.bricks.map(b=>b.id),source?.connections),[plan,source])
 const [inspector,setInspector]=useState<'step'|'motion'|'geometry'>('step')
 const [adding,setAdding]=useState(false),[showComponent,setShowComponent]=useState(true)
 const [treeNode,setTreeNode]=useState<string|null>(null),[mobilePanel,setMobilePanel]=useState<'left'|'center'|'right'>('center')
 const stepIndex=Math.max(0,plan?.steps.findIndex(s=>s.stepId===selectedStepId)??0)
 const selectedStep=plan?.steps[stepIndex]
 function setIndex(at:number){setSelectedStepId(plan?.steps[at]?.stepId||null);setAdding(false)}
 const movingIds=selectedStep?report.members[selectedStep.movingNodeId]||[]:[]
 const targetIds=selectedStep?report.members[selectedStep.targetNodeId]||[]:[]
 const matingEvidence=source?.connections.filter(c=>(movingIds.includes(c.lowerId)&&targetIds.includes(c.upperId))||(targetIds.includes(c.lowerId)&&movingIds.includes(c.upperId)))||[]
 useEffect(()=>{setAdding(false);setTreeNode(null)},[plan?.build_plan_id])
 const scene=useMemo(()=>plan&&source&&report.valid&&report.complete&&plan.steps.length?stepScene(plan,source.assembly.bricks,stepIndex):null,[plan,source,report,stepIndex])
 const labels=(node:string)=>report.members[node]?.join(' + ')||node
 const chooseAllowed=()=>!dirty||window.confirm('当前 Build Plan 有未保存修改，放弃这些修改并继续？')
 async function refreshPlans(selectionId:string){const value=await request<{items:PlanItem[];warnings:string[]}>('plans?selectionId='+encodeURIComponent(selectionId));setSaved(value.items);if(value.warnings.length)setNotice(value.warnings.join('；'))}
 async function openSource(selectionId:string){
  const value=await request<BuildSource>('sources/'+selectionId)
  setSource(value);setPlan(null);setDirty(false);setSavedVersion(null);setSelectedStepId(null);setMoving('');setTarget('');setDescription('');setSaved([]);updateUrl(value.id)
  await refreshPlans(value.id)
 }
 async function openPlan(planId:string){
  const value=await request<{plan:BuildPlan;source:BuildSource}>('plans/'+planId)
  setSource(value.source);setPlan(value.plan);setSavedVersion(value.plan.updated_at);setDirty(false);setSelectedStepId(value.plan.steps[0]?.stepId||null);setMoving('');setTarget('');setDescription('');updateUrl(value.source.id,value.plan.build_plan_id)
  await refreshPlans(value.source.id)
 }
 async function action(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work()}catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{let active=true;void request<{items:SelectionItem[];warnings:string[]}>('selections').then(async value=>{
  if(!active)return;setSelections(value.items);if(value.warnings.length)setNotice(value.warnings.join('；'))
  const params=new URL(location.href).searchParams,planId=params.get('buildPlanId'),selectionId=params.get('selectionId')
  if(planId)await action(()=>openPlan(planId));else if(selectionId)await action(()=>openSource(selectionId))
 }).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[])
 useEffect(()=>{if(!dirty&&!generating)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty,generating])
 useEffect(()=>{
  if(!leftHost.current||!rightHost.current)return
  const fatal=(message:string)=>setViewError(message)
  const a=new BrickViewer(leftHost.current,import.meta.env.BASE_URL+'brick-ldraw/',fatal),b=new BrickViewer(rightHost.current,import.meta.env.BASE_URL+'brick-ldraw/',fatal)
  left.current=a;right.current=b;setReady(true)
  return()=>{a.dispose();b.dispose();left.current=null;right.current=null}
 },[])
 useEffect(()=>{
  const a=left.current,b=right.current;if(!ready||!a||!b)return
  let active=true;const shouldPlay=autoPlay.current;autoPlay.current=false
  a.reset();b.reset();setViewError('');setPhase('loading')
  void (async()=>{
   if(scene){
    const [loadedLeft,loadedRight]=await Promise.all([a.replace(scene.moving),b.prepareBuildStep(scene.target,scene.moving,scene.step.motion||defaultMotion,()=>{if(active)setPhase('complete')})])
    if(!active)return
    if(!loadedLeft||!loadedRight)throw Error('Viewer 加载已取消，请重新选择步骤')
    setPhase(shouldPlay?'playing':'ready');if(shouldPlay)b.playBuildStep()
   }else{
    await b.replace(source?.assembly.bricks||[]);if(active)setPhase('idle')
   }
  })().catch(e=>{if(active){setViewError(String(e));setPhase('error')}})
  return()=>{active=false;a.reset();b.reset()}
 },[ready,scene,source,replay])
 function commit(next:BuildPlan){
  const validation=inspectBuildPlan(next,source?.assembly.bricks.map(b=>b.id),source?.connections)
  if(!validation.valid){setError(validation.errors.join('；'));return false}
  setPlan(next);setDirty(true);setError('');setNotice('表单已修改，尚未保存。');return true
 }
 function changeSteps(steps:BuildStep[]){return plan?commit(withSteps(plan,steps)):false}
 function editStep(at:number,patch:Partial<BuildStep>){if(plan)changeSteps(plan.steps.map((s,i)=>i===at?{...s,...patch}:s))}
 function moveStep(at:number,delta:number){if(!plan)return;const next=[...plan.steps];[next[at],next[at+delta]]=[next[at+delta],next[at]];if(changeSteps(next))setSelectedStepId(next[at+delta].stepId)}
 function addStep(){if(!plan)return;const n=crypto.randomUUID();if(changeSteps([...plan.steps,{stepId:'step:'+n,movingNodeId:moving,targetNodeId:target,resultNodeId:'assembly:'+n,description}])){setMoving('');setTarget('');setDescription('');setSelectedStepId('step:'+n);setAdding(false)}}
 function newPlan(){if(!source||!chooseAllowed())return;setPlan(createBuildPlan(source,crypto.randomUUID(),new Date().toISOString()));setSavedVersion(null);setDirty(true);setSelectedStepId(null);setError('');setMoving('');setTarget('');setDescription('');updateUrl(source.id)}
 async function save(){if(!plan)return;const value=await request<{plan:BuildPlan}>('save',{plan,expectedUpdatedAt:savedVersion});setPlan(value.plan);setSavedVersion(value.plan.updated_at);setDirty(false);updateUrl(value.plan.source_selection_id,value.plan.build_plan_id);await refreshPlans(value.plan.source_selection_id);setNotice('Build Plan 已保存；原始布局和几何记录未修改。')}

 async function generateBuildOrder(){
  if(!source||busy||generationLock.current||!planner?.configured)return
  if(dirty&&!window.confirm('生成成功后会替换当前未保存草稿；失败会保留。继续调用模型？'))return
  generationLock.current=true;setBusy(true);setGenerating(true);setError('');setNotice('')
  const requestId=crypto.randomUUID()
  setGeneration({traceId:requestId,status:'requesting',provider:planner.provider,model:planner.model,settings:planner.settings})
  try{
   const result=await request<GenerationResult>('generate',{selectionId:source.id,candidateHash:source.candidateHash,requestId})
   setGeneration(result)
   if(!result.ok||!result.plan)throw Error(result.error||'生成未通过校验；当前草稿保留')
   const next=result.plan
   if(next.source_selection_id!==source.id||next.source_geometry_result_id!==source.geometryId||next.source_candidate_id!==source.candidateId||next.source_candidate_hash!==source.candidateHash||next.status!=='draft')throw Error('生成结果来源或状态不一致；当前草稿保留')
   const validated=inspectBuildPlan(next,source.assembly.bricks.map(b=>b.id),source.connections)
   if(!validated.valid||!validated.complete)throw Error('生成结果校验失败：'+validated.errors.join('；'))
   setPlan(next);setSavedVersion(null);setDirty(true);setSelectedStepId(next.steps[0]?.stepId||null)
   setMoving('');setTarget('');setDescription('');setAdding(false);setInspector('step')
   updateUrl(source.id)
   setNotice('LLM 已完成 · 结构与连接证据校验通过 · Draft 未保存、未人工审核。')
  }catch(e){setError(String(e));setGeneration(previous=>previous?.status==='requesting'?{...previous,status:'request_failed',error:'请求失败或返回丢失；请先查看 Trace，不会自动重试。'}:previous?.status==='draft_ready'?{...previous,status:'client_validation_failed',error:String(e)}:previous)}
  finally{generationLock.current=false;setBusy(false);setGenerating(false)}
 }

 function renderTree(nodeId:string):ReactNode{
  const node=plan?.assemblyNodes.find(n=>n.id===nodeId);if(!node)return null
  return <li key={nodeId}><button className="build-tree-node" aria-pressed={treeNode===nodeId} onClick={()=>setTreeNode(nodeId)}>{node.kind==='part'?'Part · '+node.instanceId:(nodeId===plan?.rootNodeId?'Root · ':'Subassembly · ')+node.id}</button>{node.kind==='assembly'&&<ul>{node.children.map(renderTree)}</ul>}</li>
 }
 return <main className="build-order-page brick-page" data-mobile-panel={mobilePanel}>
  <nav className="build-mobile-tabs" aria-label="工作台面板">{(['left','center','right'] as const).map((p,i)=><button key={p} aria-pressed={mobilePanel===p} onClick={()=>setMobilePanel(p)}>{['Build Plan / Steps','3D Player','Inspector'][i]}</button>)}</nav>
  <ThreeColumnLayout className="brick-workbench build-workbench" defaultSizes={['25%','48%','27%']}
   left={<section className="build-navigator">
  <a href={import.meta.env.BASE_URL+'brick-gallery.html'}>积木作品库 ↗</a>
  <header className="build-nav-header"><h1>Build Order · 3D 分步装配</h1><details className="build-info"><summary aria-label="Build Order 说明">ⓘ</summary><div className="build-info-popover"><p className="build-warning">Geometry Valid 仅指已保存的最终布局。Build Steps Draft / Reviewed 不代表安装路径、承重或中间稳定性已验证。Motion Preview 是示意动画；请家长实搭审核。</p><small>点击 ⓘ 可收起说明。</small></div></details></header>
  {error&&<p className="brick-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <fieldset disabled={busy} className="build-source">
   <div className="build-layout-row">
   <label>Saved Layout<select aria-label="Build source selection" value={source?.id||''} onChange={e=>{const id=e.target.value;if(id&&chooseAllowed())void action(()=>openSource(id))}}><option value="">选择 Use This Layout 保存的记录</option>{selections.map(s=><option key={s.id} value={s.id} title={s.id}>{s.createdAt} · {s.count} 块 · {s.candidateId} · {s.id.slice(0,8)}</option>)}</select></label>
   <button disabled={!source} onClick={newPlan} title="从此布局新建 Build Plan">New</button></div>
   <label>Build Plan<select aria-label="Build plan history" value={savedVersion?plan?.build_plan_id||'':''} onChange={e=>{const id=e.target.value;if(id&&chooseAllowed())void action(()=>openPlan(id))}}><option value="">选择已保存步骤</option>{saved.map(p=><option key={p.id} value={p.id} title={p.id}>{p.updatedAt} · {p.title} · {p.id.slice(0,8)} · {p.complete?p.status:'incomplete'}</option>)}</select></label>
   <div className="build-generate-controls"><button disabled={!source||!planner?.configured||generating} onClick={()=>void generateBuildOrder()}>{generating?'Generating…':'Generate Build Order（调用模型）'}</button><small>{planner?planner.provider+' / '+planner.model+' · reasoning '+(planner.settings.reasoning?.effort||'default'):'正在读取模型配置…'}</small>{plannerError&&<small role="alert">{plannerError}</small>}{planner&&!planner.configured&&<small role="alert">OpenAI 配置不可用，不能生成；不会切换模型。</small>}</div>
  </fieldset>

   {plan&&<fieldset disabled={busy} className="build-nav-plan">
    <div className="build-plan-status"><span><strong>{!report.complete?'Incomplete':plan.status==='reviewed'?'Reviewed':'Draft'}</strong> · {dirty?'未保存':'已保存'} · {plan.instanceIds.length} 块 / {plan.steps.length} 步</span><button disabled={!report.valid} onClick={()=>void action(save)}>Save</button></div>
   <div className="brick-actions">{savedVersion&&!dirty&&report.valid&&report.complete&&source?<a href={import.meta.env.BASE_URL+'brick-gallery.html?mode=add&'+new URLSearchParams({selectionId:source.id,buildPlanId:plan.build_plan_id})}>Add to Gallery · 加入作品库 ↗</a>:<span>加入作品库前，请先保存完整的 Build Plan。</span>}</div>
   {!report.complete&&<p className="build-warning">当前有 {report.available.length} 个独立组件；继续合并到一个包含全部实例的 Root 后才可播放。草稿可以保存。</p>}


    <div className="brick-actions build-list-heading"><h2>Step List <InfoHint label="Step List">编辑只更新当前草稿；重排、删除仍需满足步骤依赖与连接检查，请用 Save 保存。</InfoHint></h2><button onClick={()=>{setAdding(true);setInspector('step');setMobilePanel('right')}}>Add Step</button></div>
    <ol className="build-step-list">{plan.steps.map((s,i)=><li key={s.stepId}><button className={i===stepIndex?'build-current':''} aria-current={i===stepIndex?'step':undefined} onClick={()=>setIndex(i)}><strong>Step {i+1}</strong><span>Moving: {labels(s.movingNodeId)}</span><span>Target: {labels(s.targetNodeId)}</span><small>{s.description||'尚未填写步骤说明'}</small></button></li>)}</ol>
    <details className="build-tree-panel"><summary>Assembly Tree</summary><div className="build-tree-scroll"><ul className="build-tree">{report.valid&&report.available.map(renderTree)}</ul>{treeNode&&report.members[treeNode]&&<p role="status">{treeNode} 包含：{report.members[treeNode].join('、')}</p>}</div></details>
   </fieldset>}
   </section>}
   center={<section className="build-player">
    <header className="build-player-heading"><h2>{scene?'Current Assembly · 本步骤目标组件':source?'Final Layout Preview · 最终布局参考':'3D Assembly Player'}</h2><p>{scene?labels(scene.step.targetNodeId)+' ← '+labels(scene.step.movingNodeId):source?'尚未开始步骤播放。请创建或选择完整 Build Plan。':'请在左栏选择已保存的 Valid Layout 和 Build Plan。'}</p></header>
    <div className="build-stage-area">
     <div ref={rightHost} className="build-canvas build-main-canvas"/>
     <button className="build-main-fit" onClick={()=>right.current?.fit()}>适合视图</button>
     <section className="build-component" data-collapsed={!showComponent}>
      <button className="build-component-toggle" aria-expanded={showComponent} onClick={()=>setShowComponent(v=>!v)}>New Component · {scene?.moving.length||0} 块 {showComponent?'▾':'▸'}</button>
      <div className="build-component-body"><div ref={leftHost} className="build-canvas build-small-canvas"/><p>{scene?scene.moving.map(b=>b.id).join(' + '):'选择可播放步骤后显示待安装组件'}</p><button onClick={()=>left.current?.fit()}>适合组件视图</button></div>
     </section>
    </div>
    <footer className="build-player-footer">
  <div className="brick-actions build-controls"><button disabled={!scene||stepIndex===0||phase==='loading'} onClick={()=>setIndex(stepIndex-1)}>Previous</button><button disabled={!scene||phase==='loading'||phase==='error'||phase==='playing'} onClick={()=>{autoPlay.current=true;setReplay(n=>n+1)}}>Replay · 播放安装</button><button disabled={!scene||!plan||stepIndex>=plan.steps.length-1||phase==='loading'} onClick={()=>setIndex(stepIndex+1)}>Next</button><strong>{scene?'步骤 '+(stepIndex+1)+' / '+plan!.steps.length:'未开始'}</strong><span role="status">{phase==='complete'?(stepIndex===plan!.steps.length-1?'动画完成：已显示最终 Layout；步骤仍需实搭审核':'本步骤示意动画完成'):phase==='playing'?'Motion Preview · 播放中':phase==='loading'?'正在加载真实 DAT…':scene?'准备安装（尚未播放）':''}</span></div>
  {scene&&<p>{scene.step.description||'未填写步骤说明'}</p>}

     <p className="brick-help">左键旋转 · 滚轮缩放 · 右键平移。绿色：待安装组件；Ghost：最终位置；箭头：示意方向。动画未经插入路径避碰或中间稳定性验证。</p>
     {viewError&&<p role="alert" className="brick-error">{viewError}</p>}
    </footer>
   </section>}
   right={<section className="build-inspector">
    <h2>Inspector / Step Editor</h2>
    <div className="build-inspector-tabs" role="tablist" aria-label="步骤详情">{(['step','motion','geometry'] as const).map((tab,i)=><button role="tab" id={'build-tab-'+tab} aria-controls={'build-panel-'+tab} aria-selected={inspector===tab} key={tab} onClick={()=>setInspector(tab)}>{['Step','Motion','Geometry'][i]}</button>)}</div>
    {generation&&<details open><summary>最近 Auto Build Order · {generation.status}</summary><p>{generation.provider} / {generation.model} · reasoning {generation.settings.reasoning?.effort||'default'}</p><p role="status">{generating?'正在生成；本次只调用一次模型。':generation.status==='draft_ready'?'LLM 完成、Validator 通过；生成结果为未审核 Draft，保存仍需手动操作。':generation.error||'请查看调用及校验诊断。'}</p><TraceLinks source="build" id={generation.traceId}/><details><summary>Validator / Token Usage</summary><pre>{JSON.stringify({diagnostic:generation.diagnostic,validation:generation.validation,usage:generation.usage??'尚未返回'},null,2)}</pre></details></details>}
    {source&&<details><summary>Source · {source.assembly.bricks.length} parts · Geometry Valid</summary><a href={import.meta.env.BASE_URL+'brick-test.html?workflow=spatial'+(source?'&analysisId='+source.analysisId+'&spatialPlanId='+source.planId+'&geometryId='+source.geometryId+'&candidateId='+source.candidateId:'')} target="_blank" rel="noreferrer">打开 Spatial Assembly ↗</a><p>Selection {source.id} / Geometry {source.geometryId} / {source.candidateId}；{source.connections.length} 对连接。未认证的视觉关系仍保留在源记录。</p><ul>{source.assembly.bricks.map(b=><li key={b.id}>{b.id} · 型号 {source.identities.find(i=>i.id===b.id)?.partNumber||b.part} · 几何 {b.part} · LDraw 颜色 {b.color} · X/Z {b.x}/{b.z} Stud · Layer {b.layer} · yaw {b.rotation}°</li>)}</ul><small>通过基础几何复用的印花可能未渲染；型号以已审核来源为准。</small></details>}
    {error&&<p role="alert" className="brick-error">{error}</p>}
    {!plan?<p>请先选择或新建 Build Plan。</p>:<fieldset disabled={busy}>
     <div role="tabpanel" id="build-panel-step" aria-labelledby="build-tab-step" hidden={inspector!=='step'}>
      <details className="build-plan-settings"><summary>Plan Settings</summary>   <label>标题<input value={plan.title} maxLength={200} onChange={e=>commit({...plan,title:e.target.value,status:'draft'})}/></label>
   <label><input type="checkbox" checked={plan.status==='reviewed'} disabled={!report.complete} onChange={e=>commit({...plan,status:e.target.checked?'reviewed':'draft'})}/> 我已人工审核步骤顺序（不代表路径或稳定性认证）</label>
<small>Plan ID: {plan.build_plan_id}</small></details>
      <details><summary>Advanced / Test</summary>   {source?.id===example.source_selection_id&&<button onClick={()=>{if(window.confirm('用测试性示例替换当前步骤？仅修改表单，不自动保存。')){const next=withSteps({...plan,title:example.title},example.steps);if(commit(next)){setSelectedStepId(next.steps[0]?.stepId||null);setAdding(false)}}}}>载入可编辑的企鹅测试步骤（未实搭验证）</button>}<p className="brick-help">测试步骤仅按按钮载入当前草稿，不自动保存。</p></details>
      {adding?<><button onClick={()=>setAdding(false)}>返回当前步骤</button>
   <section className="build-add"><h3>Add Step · 合并两个可用组件</h3><div className="build-fields"><label>Moving Component<select value={moving} onChange={e=>setMoving(e.target.value)}><option value="">选择待安装组件</option>{report.available.map(id=><option key={id} value={id} disabled={id===target}>{labels(id)}</option>)}</select></label><label>Target Component<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择目标组件</option>{report.available.map(id=><option key={id} value={id} disabled={id===moving}>{labels(id)}</option>)}</select></label></div><label>说明（可选）<textarea value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)}/></label><button disabled={!report.available.includes(moving)||!report.available.includes(target)||moving===target} onClick={addStep}>Add Step</button><p>合并必须有源 Geometry Result 的真实接合证据，但不证明安装路径或稳定性。结果组件会成为下一步可选对象。重排或删除若破坏依赖会被拒绝；需要时先删除依赖它的后续步骤。</p></section>

      </>:selectedStep?(()=>{const s=selectedStep,i=stepIndex;return <>
       <h3>Step {i+1} / {plan.steps.length}</h3><details><summary>步骤身份</summary><small>Step ID: {s.stepId}</small><br/><small>Result: {s.resultNodeId}</small></details>
    <div className="build-fields"><label>Moving Component<select value={s.movingNodeId} onChange={e=>editStep(i,{movingNodeId:e.target.value})}>{report.availableBefore[i]?.map(id=><option key={id} value={id} disabled={id===s.targetNodeId}>{labels(id)}</option>)}</select></label><label>Target Component<select value={s.targetNodeId} onChange={e=>editStep(i,{targetNodeId:e.target.value})}>{report.availableBefore[i]?.map(id=><option key={id} value={id} disabled={id===s.movingNodeId}>{labels(id)}</option>)}</select></label></div>
    <label>步骤说明<textarea maxLength={2000} value={s.description} onChange={e=>editStep(i,{description:e.target.value})}/></label>

       <div className="brick-actions"><button disabled={i===0} onClick={()=>moveStep(i,-1)}>Move Up</button><button disabled={i===plan.steps.length-1} onClick={()=>moveStep(i,1)}>Move Down</button><button onClick={()=>changeSteps(plan.steps.filter((_,j)=>j!==i))}>Delete Step</button><button onClick={()=>setAdding(true)}>Add Step</button></div>

      </>})():<><p>暂无步骤。</p><button onClick={()=>setAdding(true)}>Add Step</button></>}
     </div>
     <div role="tabpanel" id="build-panel-motion" aria-labelledby="build-tab-motion" hidden={inspector!=='motion'}>
      {selectedStep?(()=>{const s=selectedStep,i=stepIndex;return <><h3>Step {i+1} · Motion Hint <InfoHint label="Motion Hint">仅调整动画起点偏移和旋转，不改变最终布局。</InfoHint></h3>
    <section><div className="build-fields">{(['x','y','z'] as const).map(axis=><label key={axis}>起点 Δ{axis.toUpperCase()} LDU<input type="number" min={-1000} max={1000} value={(s.motion||defaultMotion).offsetLdu[axis]} onChange={e=>{const m=s.motion||defaultMotion;editStep(i,{motion:{...m,offsetLdu:{...m.offsetLdu,[axis]:Number(e.target.value)}}})}}/></label>)}<label>起点相对 yaw °<input type="number" min={-360} max={360} value={(s.motion||defaultMotion).startYawDegrees} onChange={e=>editStep(i,{motion:{...(s.motion||defaultMotion),startYawDegrees:Number(e.target.value)}})}/></label></div></section>

       <button disabled={!scene||phase==='loading'||phase==='error'||phase==='playing'} onClick={()=>{autoPlay.current=true;setReplay(n=>n+1)}}>Replay 当前步骤</button><p className="build-warning">仅安装示意，未验证真实插入路径、碰撞扫掠或中间稳定性。</p></>})():<p>请选择步骤。</p>}
     </div>
     <div role="tabpanel" id="build-panel-geometry" aria-labelledby="build-tab-geometry" hidden={inspector!=='geometry'}>
      <p className="brick-validation is-valid">Final Layout: Geometry Valid（保存的源结果）</p>
      {selectedStep?<><h3>Step {stepIndex+1} · 装配依据 <InfoHint label="装配依据">读取源 Geometry Result 的真实接合记录，不推测缺失的 Connector 索引。</InfoHint></h3><p>Moving：{movingIds.join(' + ')}</p><p>Target：{targetIds.join(' + ')}</p><p>{report.valid&&matingEvidence.length?'已有连接依赖检查通过':'连接依赖检查未通过'} · 跨组件接合 {matingEvidence.length} 对</p>
       {matingEvidence.map((c,i)=><details key={i}><summary>{c.lowerId} → {c.upperId} · {c.points.length} 个接合点</summary><pre>{JSON.stringify(c,null,2)}</pre></details>)}
       </>:<p>请选择步骤查看接合依据。</p>}
      <p className="build-warning">安装路径：未验证。中间稳定性与承重：未验证。Reviewed 仅代表人工审核步骤顺序。</p>
      {source&&<details><summary>源布局保留的未认证约束</summary><pre>{JSON.stringify(source.unverifiedConstraints,null,2)}</pre></details>}
     </div>
    </fieldset>}
   </section>}
  />
 </main>
}
