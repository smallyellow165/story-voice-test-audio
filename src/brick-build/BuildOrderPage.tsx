import {useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {BrickViewer} from '../brick-test/viewer'
import {createBuildPlan,inspectBuildPlan,stepScene,withSteps} from './plan.mjs'
import type {BuildPlan,BuildSource,BuildStep} from './plan.mjs'
import example from '../../examples/build-order/penguin-v1.json'
import '../brick-test/brick-test.css'
import './build-order.css'

type SelectionItem={id:string;createdAt:string;analysisId:string;candidateId:string;count:number}
type PlanItem={id:string;title:string;status:string;updatedAt:string;complete:boolean}
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
 const [index,setIndex]=useState(0),[replay,setReplay]=useState(0),[phase,setPhase]=useState('idle')
 const [viewError,setViewError]=useState(''),[ready,setReady]=useState(false)
 const [moving,setMoving]=useState(''),[target,setTarget]=useState(''),[description,setDescription]=useState('')
 const leftHost=useRef<HTMLDivElement>(null),rightHost=useRef<HTMLDivElement>(null)
 const left=useRef<BrickViewer|null>(null),right=useRef<BrickViewer|null>(null),autoPlay=useRef(false)
 const report=useMemo(()=>inspectBuildPlan(plan,source?.assembly.bricks.map(b=>b.id),source?.connections),[plan,source])
 const stepIndex=Math.max(0,Math.min(index,(plan?.steps.length||1)-1))
 const scene=useMemo(()=>plan&&source&&report.valid&&report.complete&&plan.steps.length?stepScene(plan,source.assembly.bricks,stepIndex):null,[plan,source,report,stepIndex])
 const labels=(node:string)=>report.members[node]?.join(' + ')||node
 const chooseAllowed=()=>!dirty||window.confirm('当前 Build Plan 有未保存修改，放弃这些修改并继续？')
 async function refreshPlans(selectionId:string){const value=await request<{items:PlanItem[];warnings:string[]}>('plans?selectionId='+encodeURIComponent(selectionId));setSaved(value.items);if(value.warnings.length)setNotice(value.warnings.join('；'))}
 async function openSource(selectionId:string){
  const value=await request<BuildSource>('sources/'+selectionId)
  setSource(value);setPlan(null);setDirty(false);setSavedVersion(null);setIndex(0);setMoving('');setTarget('');setDescription('');setSaved([]);updateUrl(value.id)
  await refreshPlans(value.id)
 }
 async function openPlan(planId:string){
  const value=await request<{plan:BuildPlan;source:BuildSource}>('plans/'+planId)
  setSource(value.source);setPlan(value.plan);setSavedVersion(value.plan.updated_at);setDirty(false);setIndex(0);setMoving('');setTarget('');setDescription('');updateUrl(value.source.id,value.plan.build_plan_id)
  await refreshPlans(value.source.id)
 }
 async function action(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work()}catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{let active=true;void request<{items:SelectionItem[];warnings:string[]}>('selections').then(async value=>{
  if(!active)return;setSelections(value.items);if(value.warnings.length)setNotice(value.warnings.join('；'))
  const params=new URL(location.href).searchParams,planId=params.get('buildPlanId'),selectionId=params.get('selectionId')
  if(planId)await action(()=>openPlan(planId));else if(selectionId)await action(()=>openSource(selectionId))
 }).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[])
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
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
 function moveStep(at:number,delta:number){if(!plan)return;const next=[...plan.steps];[next[at],next[at+delta]]=[next[at+delta],next[at]];if(changeSteps(next))setIndex(at+delta)}
 function addStep(){if(!plan)return;const n=crypto.randomUUID();if(changeSteps([...plan.steps,{stepId:'step:'+n,movingNodeId:moving,targetNodeId:target,resultNodeId:'assembly:'+n,description}])){setMoving('');setTarget('');setDescription('')}}
 function newPlan(){if(!source||!chooseAllowed())return;setPlan(createBuildPlan(source,crypto.randomUUID(),new Date().toISOString()));setSavedVersion(null);setDirty(true);setIndex(0);setError('');setMoving('');setTarget('');setDescription('');updateUrl(source.id)}
 async function save(){if(!plan)return;const value=await request<{plan:BuildPlan}>('save',{plan,expectedUpdatedAt:savedVersion});setPlan(value.plan);setSavedVersion(value.plan.updated_at);setDirty(false);updateUrl(value.plan.source_selection_id,value.plan.build_plan_id);await refreshPlans(value.plan.source_selection_id);setNotice('Build Plan 已保存；原始布局和几何记录未修改。')}
 function renderTree(nodeId:string):ReactNode{
  const node=plan?.assemblyNodes.find(n=>n.id===nodeId);if(!node)return null
  return <li key={nodeId}>{node.kind==='part'?node.instanceId:<>{node.id}<ul>{node.children.map(renderTree)}</ul></>}</li>
 }
 return <main className="build-order-page brick-page">
  <header className="brick-header"><div><span className="brick-eyebrow">DUPLO AI DESIGN LAB / BUILD ORDER V1</span><h1>Build Order · 3D 分步装配</h1></div><a href={import.meta.env.BASE_URL+'brick-test.html?workflow=spatial'+(source?'&analysisId='+source.analysisId+'&spatialPlanId='+source.planId+'&geometryId='+source.geometryId+'&candidateId='+source.candidateId:'')} target="_blank" rel="noreferrer">打开 Spatial Assembly ↗</a></header>
  <p className="build-warning">Geometry Valid 仅指已保存的最终布局。Build Steps Draft / Reviewed 不代表安装路径、承重或中间稳定性已验证。Motion Preview 是示意动画；请家长实搭审核。</p>
  {error&&<p className="brick-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <fieldset disabled={busy} className="build-source">
   <label>已保存的 Valid Layout<select aria-label="Build source selection" value={source?.id||''} onChange={e=>{const id=e.target.value;if(id&&chooseAllowed())void action(()=>openSource(id))}}><option value="">选择 Use This Layout 保存的记录</option>{selections.map(s=><option key={s.id} value={s.id}>{s.createdAt} · {s.count} 块 · {s.candidateId} · {s.id}</option>)}</select></label>
   <button disabled={!source} onClick={newPlan}>从此布局新建 Build Plan</button>
   <label>已保存 Build Plan<select aria-label="Build plan history" value={savedVersion?plan?.build_plan_id||'':''} onChange={e=>{const id=e.target.value;if(id&&chooseAllowed())void action(()=>openPlan(id))}}><option value="">选择已保存步骤</option>{saved.map(p=><option key={p.id} value={p.id}>{p.updatedAt} · {p.title} · {p.complete?p.status:'incomplete'}</option>)}</select></label>
  </fieldset>
  {source&&<details><summary>来源与全部 {source.assembly.bricks.length} 个实例 · 最终 Geometry Valid</summary><p>Selection {source.id} / Geometry {source.geometryId} / {source.candidateId}；{source.connections.length} 对连接。未认证的视觉关系仍保留在源记录。</p><ul>{source.assembly.bricks.map(b=><li key={b.id}>{b.id} · 型号 {source.identities.find(i=>i.id===b.id)?.partNumber||b.part} · 几何 {b.part} · LDraw 颜色 {b.color} · X/Z {b.x}/{b.z} Stud · Layer {b.layer} · yaw {b.rotation}°</li>)}</ul><small>通过基础几何复用的印花可能未渲染；型号以已审核来源为准。</small></details>}
  <div className="build-player">
   <section><h2>New Component · {scene?.moving.length||0} 块</h2><p>{scene?scene.moving.map(b=>b.id).join(' + '):'完整装配树准备好后，显示当前待安装组件。'}</p><div ref={leftHost} className="build-canvas"/><button onClick={()=>left.current?.fit()}>适合视图</button></section>
   <section><h2>{scene?'Current Assembly · 本步骤目标组件':'选定最终布局 · 尚非步骤播放'}</h2><p>{scene?labels(scene.step.targetNodeId)+' ← '+labels(scene.step.movingNodeId):'请创建并完成 Build Plan；不完整草稿不能播放。'}</p><div ref={rightHost} className="build-canvas"/><button onClick={()=>right.current?.fit()}>适合视图</button></section>
  </div>
  <p className="brick-help">两个区域均支持左键旋转、滚轮缩放、右键平移。绿色为待安装组件，半透明 Ghost 为最终位置，箭头为示意移动方向。</p>
  {viewError&&<p role="alert" className="brick-error">{viewError}</p>}
  <div className="brick-actions build-controls"><button disabled={!scene||stepIndex===0||phase==='loading'} onClick={()=>setIndex(stepIndex-1)}>Previous</button><button disabled={!scene||phase==='loading'||phase==='error'||phase==='playing'} onClick={()=>{autoPlay.current=true;setReplay(n=>n+1)}}>Replay · 播放安装</button><button disabled={!scene||!plan||stepIndex>=plan.steps.length-1||phase==='loading'} onClick={()=>setIndex(stepIndex+1)}>Next</button><strong>{scene?'步骤 '+(stepIndex+1)+' / '+plan!.steps.length:'未开始'}</strong><span role="status">{phase==='complete'?(stepIndex===plan!.steps.length-1?'动画完成：已显示最终 Layout；步骤仍需实搭审核':'本步骤示意动画完成'):phase==='playing'?'Motion Preview · 播放中':phase==='loading'?'正在加载真实 DAT…':scene?'准备安装（尚未播放）':''}</span></div>
  {scene&&<p>{scene.step.description||'未填写步骤说明'}</p>}
  {plan&&<fieldset disabled={busy} className="build-editor">
   <div className="brick-actions"><h2>人工步骤编辑</h2><strong>{!report.complete?'Incomplete':plan.status==='reviewed'?'Reviewed · 人工步骤审核':'Build Steps Draft'} · {dirty?'未保存':'已保存'}</strong><button disabled={!report.valid} onClick={()=>void action(save)}>Save Build Plan</button></div>
   <label>标题<input value={plan.title} maxLength={200} onChange={e=>commit({...plan,title:e.target.value,status:'draft'})}/></label>
   <label><input type="checkbox" checked={plan.status==='reviewed'} disabled={!report.complete} onChange={e=>commit({...plan,status:e.target.checked?'reviewed':'draft'})}/> 我已人工审核步骤顺序（不代表路径或稳定性认证）</label>
   {!report.complete&&<p className="build-warning">当前有 {report.available.length} 个独立组件；继续合并到一个包含全部实例的 Root 后才可播放。草稿可以保存。</p>}
   {source?.id===example.source_selection_id&&<button onClick={()=>{if(window.confirm('用测试性示例替换当前步骤？仅修改表单，不自动保存。')){const next=withSteps({...plan,title:example.title},example.steps);if(commit(next))setIndex(0)}}}>载入可编辑的企鹅测试步骤（未实搭验证）</button>}
   <ol className="build-step-list">{plan.steps.map((s,i)=><li key={s.stepId} className={i===stepIndex?'build-current':''}>
    <div className="brick-actions"><strong>Step {i+1}</strong><button disabled={!report.complete} onClick={()=>setIndex(i)}>预览</button><button disabled={i===0} onClick={()=>moveStep(i,-1)}>Move Up</button><button disabled={i===plan.steps.length-1} onClick={()=>moveStep(i,1)}>Move Down</button><button onClick={()=>changeSteps(plan.steps.filter((_,j)=>j!==i))}>删除步骤</button></div>
    <div className="build-fields"><label>Moving Component<select value={s.movingNodeId} onChange={e=>editStep(i,{movingNodeId:e.target.value})}>{report.availableBefore[i]?.map(id=><option key={id} value={id} disabled={id===s.targetNodeId}>{labels(id)}</option>)}</select></label><label>Target Component<select value={s.targetNodeId} onChange={e=>editStep(i,{targetNodeId:e.target.value})}>{report.availableBefore[i]?.map(id=><option key={id} value={id} disabled={id===s.movingNodeId}>{labels(id)}</option>)}</select></label></div>
    <small>Result: {s.resultNodeId}</small><label>步骤说明<textarea maxLength={2000} value={s.description} onChange={e=>editStep(i,{description:e.target.value})}/></label>
    <details><summary>Motion Hint · 临时起点偏移与旋转（不改变最终布局）</summary><div className="build-fields">{(['x','y','z'] as const).map(axis=><label key={axis}>起点 Δ{axis.toUpperCase()} LDU<input type="number" min={-1000} max={1000} value={(s.motion||defaultMotion).offsetLdu[axis]} onChange={e=>{const m=s.motion||defaultMotion;editStep(i,{motion:{...m,offsetLdu:{...m.offsetLdu,[axis]:Number(e.target.value)}}})}}/></label>)}<label>起点相对 yaw °<input type="number" min={-360} max={360} value={(s.motion||defaultMotion).startYawDegrees} onChange={e=>editStep(i,{motion:{...(s.motion||defaultMotion),startYawDegrees:Number(e.target.value)}})}/></label></div></details>
   </li>)}</ol>
   <section className="build-add"><h3>Add Step · 合并两个可用组件</h3><div className="build-fields"><label>Moving Component<select value={moving} onChange={e=>setMoving(e.target.value)}><option value="">选择待安装组件</option>{report.available.map(id=><option key={id} value={id} disabled={id===target}>{labels(id)}</option>)}</select></label><label>Target Component<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择目标组件</option>{report.available.map(id=><option key={id} value={id} disabled={id===moving}>{labels(id)}</option>)}</select></label></div><label>说明（可选）<textarea value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)}/></label><button disabled={!report.available.includes(moving)||!report.available.includes(target)||moving===target} onClick={addStep}>Add Step</button><p>合并必须有源 Geometry Result 的真实接合证据，但不证明安装路径或稳定性。结果组件会成为下一步可选对象。重排或删除若破坏依赖会被拒绝；需要时先删除依赖它的后续步骤。</p></section>
   <details><summary>Assembly Tree / 当前独立组件</summary><ul>{report.valid&&report.available.map(renderTree)}</ul></details>
  </fieldset>}
 </main>
}
