import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import { createTutorial3D, tutorialProject, tutorialMatchesAssembly, validateTutorial3D, serializeTutorial3D, parseTutorial3D } from './tutorial.ts'
import type { Tutorial3D } from './tutorial.ts'
import { validateAssembly3D } from './engine-adapter.ts'
import { loadTutorial3D, saveTutorial3D } from './tutorial-storage.ts'
import * as actions from './vendor/editor/tutorial-state.ts'
import type { EditorHistory } from './vendor/editor/tutorial-state.ts'
import { StepTimeline } from './vendor/components/editor/StepTimeline.tsx'
import { TutorialOrchestrationPanel } from './vendor/components/editor/TutorialOrchestrationPanel.tsx'
import { TutorialPlayer } from './vendor/components/tutorial/TutorialPlayer.tsx'
import { BuildOrderGenerator } from './BuildOrderGenerator.tsx'
import type { TutorialCamera } from './vendor/components/tutorial/TutorialPlayer.tsx'
import './viewer.css'
import './tutorial.css'

export default function ThreeDBuildWorkspace(){
  const {stage,viewMode,assembly3D}=useStudio(),active=stage==='build'&&viewMode==='3d'
  const [boot]=useState(()=>{try{return {...loadTutorial3D(localStorage),error:''}}catch(e){return {tutorial:null,raw:null,error:`原教程存档无法读取，禁止覆盖：${String(e)}`}}})
  const [history,setHistory]=useState<EditorHistory|null>(()=>boot.tutorial?actions.createInitialHistory(boot.tutorial):null)
  const historyRef=useRef(history);historyRef.current=history
  const [selected,setSelected]=useState<number|null>(boot.tutorial?.steps[0]?.id??null)
  const [seekRequest,setSeekRequest]=useState<{index:number;sequence:number}|null>(null)
  const [error,setError]=useState(boot.error),[notice,setNotice]=useState(''),[raw,setRaw]=useState('')
  const [clean,setClean]=useState(boot.tutorial?serializeTutorial3D(boot.tutorial):'')
  const expected=useRef(boot.raw),fileRequest=useRef(0),camera=useRef<TutorialCamera|null>(null)
  const [cameraReady,setCameraReady]=useState(false)
  const [loadEpoch,setLoadEpoch]=useState(0)
  const tutorial=history?.current??null,dirty=!!tutorial&&serializeTutorial3D(tutorial)!==clean
  const validation=useMemo(()=>tutorial?validateTutorial3D(tutorial):null,[tutorial])
  const project=useMemo(()=>tutorial?tutorialProject(tutorial):null,[tutorial])
  const sourceValidation=useMemo(()=>assembly3D?validateAssembly3D(assembly3D):null,[assembly3D])
  const matching=tutorial&&tutorialMatchesAssembly(tutorial,assembly3D)
  const index=tutorial?Math.max(0,tutorial.steps.findIndex(s=>s.id===selected)):0,step=tutorial?.steps[index]
  const reportCamera=useCallback((c:TutorialCamera)=>{camera.current=c;setCameraReady(true)},[])
  function allowReplace(){return !dirty||confirm('Tutorial Draft 有未保存修改。确认替换？可先取消并保存或导出。')}
  function accept(t:Tutorial3D,saved=false){
    const next=actions.createInitialHistory(t);historyRef.current=next;setHistory(next);setSelected(t.steps[0]?.id??null);setSeekRequest(null)
    camera.current=null;setCameraReady(false);setError('');setNotice('');setClean(saved?serializeTutorial3D(t):'')
    setLoadEpoch(n=>n+1)
  }
  function create(){try{if(assembly3D&&allowReplace()){fileRequest.current++;accept(createTutorial3D(assembly3D));setClean('')}}catch(e){setError(String(e))}}
  function apply(fn:(h:EditorHistory)=>EditorHistory){
    const current=historyRef.current;if(!current)return
    try{const next=fn(current);historyRef.current=next;setHistory(next);setError('');setNotice('')}catch(e){setError(String(e))}
  }
  useEffect(()=>{if(tutorial&&!tutorial.steps.some(s=>s.id===selected))setSelected(tutorial.steps[0]?.id??null)},[tutorial,selected])
  function choose(id:number){if(!tutorial)return;const i=tutorial.steps.findIndex(s=>s.id===id);setSelected(id);setSeekRequest(old=>({index:i,sequence:(old?.sequence??0)+1}))}
  function save(){try{
    if(boot.error)throw Error(boot.error);if(!tutorial)return
    expected.current=saveTutorial3D(localStorage,tutorial,expected.current);setClean(serializeTutorial3D(tutorial));setNotice('Tutorial Draft 已保存；来源 Assembly3D 与 2D 存档未修改。');setError('')
  }catch(e){setError(String(e))}}
  function reload(){if(!allowReplace())return;try{const loaded=loadTutorial3D(localStorage);if(!loaded.tutorial)throw Error('尚无已保存教程');fileRequest.current++;expected.current=loaded.raw;accept(loaded.tutorial,true)}catch(e){setError(String(e))}}
  function load(json:string){try{if(!allowReplace())return;const t=parseTutorial3D(json);accept(t)}catch(e){setError(`导入失败，当前教程保留：${String(e)}`)}}
  return <>
    <StudioSlot column="workspace" stages={['build']} view="3d">
      <section className="magnetic-3d-build" aria-label="3D Build Tutorial">
        <h3>3D Build Tutorial · {tutorial?.title??'尚无教程'}</h3>
        {tutorial&&<p className="hint" data-testid="tutorial-source">教程来源 {tutorial.source.assemblyId} @ revision {tutorial.source.assemblyRevision} · {tutorial.assembly.pieces.length} 片 / {tutorial.assembly.connections.length} 条连接 · {dirty?'Draft 未保存':'Draft 无未保存修改'}</p>}
        {tutorial&&!matching&&<p role="alert" className="magnetic-tutorial-warning">教程来源与当前 Assembly 不同。正在播放教程内嵌快照；不会替换、重绑或修改当前作品。需要当前作品的教程时请显式创建新 Draft。</p>}
        {active&&tutorial&&<TutorialPlayer key={`${tutorial.id}-${loadEpoch}`} tutorial={tutorial} initialStep={index} seekRequest={seekRequest}
          onStepChange={i=>setSelected(tutorial.steps[i]?.id??null)} onCameraChange={reportCamera}/>}
        {!tutorial&&<p>先在 Assembly → 3D 选择作品，再在右栏创建 Tutorial Draft。</p>}
        {tutorial&&<details className="magnetic-tutorial-io"><summary>导入 / 导出 Tutorial3D</summary>
          <label>Tutorial3D JSON<textarea aria-label="Tutorial3D JSON" value={raw} onChange={e=>setRaw(e.target.value)} maxLength={2_000_000}/></label>
          <div className="button-row"><button onClick={()=>{fileRequest.current++;load(raw)}}>导入 Tutorial JSON</button>
            <label>打开教程文件<input aria-label="打开 Tutorial3D 文件" type="file" accept=".json,application/json" onChange={async e=>{
              const file=e.target.files?.[0];e.target.value='';if(!file)return;const request=++fileRequest.current
              try{if(file.size>2_000_000)throw Error('文件超过 2 MB');const json=await file.text();if(request===fileRequest.current)load(json)}catch(e){if(request===fileRequest.current)setError(String(e))}
            }}/></label>
            <button onClick={()=>{const url=URL.createObjectURL(new Blob([serializeTutorial3D(tutorial)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${tutorial.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>导出 Tutorial3D</button></div>
        </details>}
        {!tutorial&&<label>导入已有教程<input aria-label="导入已有 Tutorial3D 文件" type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';const request=++fileRequest.current;if(file){try{if(file.size>2_000_000)throw Error('文件超过 2 MB');const json=await file.text();if(request===fileRequest.current)load(json)}catch(e){if(request===fileRequest.current)setError(String(e))}}}}/></label>}
      </section>
    </StudioSlot>
    <StudioSlot column="inspector" stages={['build']} view="3d">
      <section className="magnetic-tutorial-inspector" aria-label="3D Tutorial Inspector">
        <h3>Tutorial Draft</h3><p className="hint">当前 Assembly：{assembly3D?`${assembly3D.id} @ ${assembly3D.revision}`:'等待加载'}</p>
        <BuildOrderGenerator assembly={assembly3D} active={active} geometryValid={sourceValidation?.valid??false} hasTutorial={!!tutorial}
          onAdopt={t=>{if(tutorial&&!confirm('采用此生成候选并替换当前 Tutorial Draft？已有草稿可先保存或导出。此操作不会自动保存。'))return;fileRequest.current++;accept(t)}}/>
        <button disabled={!assembly3D||!assembly3D.pieces.length} onClick={create}>{sourceValidation?.valid?'从当前 3D Assembly 创建教程':'创建未验证 Tutorial Draft'}</button>
        {sourceValidation&&!sourceValidation.valid&&<p role="alert">当前 Assembly Geometry Invalid；只能保留未验证 Draft。{sourceValidation.issues.map(i=>i.message).join('；')}</p>}
        <div className="button-row"><button onClick={reload}>重新加载已保存教程</button>{tutorial&&<button disabled={!!boot.error} onClick={save}>保存 Tutorial Draft</button>}</div>
        {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
        {tutorial&&project&&validation&&<>
          <p role="status" data-testid="tutorial-validation">最终 Assembly Geometry {validation.finalValid?'Valid':'Invalid'} · {validation.verified?'几何与顺序检查通过 · Draft':'教程尚未通过检查 · Draft'}</p>
          <p data-testid="tutorial-step-validation">当前步骤 Geometry {validation.steps[index]?.geometryValid?'Valid':'Invalid'} · Connected Construction {validation.steps[index]?.connected?'通过':'未通过'} · {validation.steps[index]?.components??0} 个组件</p>
          <p className="hint">地面接触提示不等于支撑验证；现实可搭建性、磁力与稳定站立均未验证。</p>
          <details open={validation.issues.length>0}><summary>教程 Diagnostic · {validation.issues.length}</summary><ul>{validation.issues.map((i,n)=><li key={n} data-tutorial-diagnostic={i.code}>{i.stepId?`步骤 ${i.stepId}：`:''}{i.message}</li>)}</ul></details>
          <div className="button-row"><button disabled={!history!.past.length} onClick={()=>apply(actions.undo)}>教程 Undo</button><button disabled={!history!.future.length} onClick={()=>apply(actions.redo)}>教程 Redo</button></div>
          <label>教程标题<input aria-label="3D 教程标题" value={tutorial.title} onChange={e=>apply(h=>actions.commit(h,p=>({...p,title:e.target.value})))}/></label>
          <StepTimeline project={project} currentStepId={step?.id??null} validation={validation}
            onSelectStep={choose} onAddStep={()=>apply(h=>{const result=actions.addStepAction(h);setSelected(result.stepId);return result.history})}
            onDeleteStep={id=>apply(h=>actions.deleteStepAction(h,id))} onMoveStep={(from,to)=>apply(h=>actions.moveStepAction(h,from,to))}/>
          {step&&<><label>步骤标题<input aria-label="3D 步骤标题" value={step.title} onChange={e=>apply(h=>actions.updateStepAction(h,step.id,{title:e.target.value}))}/></label>
            <label>简短说明<textarea aria-label="3D 步骤说明" value={step.description} onChange={e=>apply(h=>actions.updateStepAction(h,step.id,{description:e.target.value}))}/></label></>}
          <div className="magnetic-tutorial-panel"><TutorialOrchestrationPanel project={project} currentStepId={step?.id??null} currentView={cameraReady?camera.current??undefined:undefined}
            onSetStepCamera={(id,c)=>apply(h=>actions.setStepCameraAction(h,id,c))}
            onCaptureCurrentViewAsStepCamera={(id,ms)=>{if(camera.current)apply(h=>actions.captureCurrentViewAsStepCameraAction(h,id,camera.current!,ms))}}
            onPatchPieceEntrance={(id,pid,patch)=>apply(h=>actions.patchPieceEntranceAction(h,id,pid,patch))}
            onBatchSetEntranceType={(id,pids,type)=>apply(h=>actions.batchSetEntranceTypeAction(h,id,pids,type))}
            onClearPieceEntrance={(id,pid)=>apply(h=>actions.setPieceEntranceAction(h,id,pid,null))}
            onSetStepHint={(id,hint)=>apply(h=>actions.setStepHintAction(h,id,hint))}
            onSetStepFocusPoints={(id,points)=>apply(h=>actions.setStepFocusPointsAction(h,id,points))}
            onSetStepHighlightMs={(id,ms)=>apply(h=>actions.updateStepAction(h,id,{highlightMs:ms}))}
            onSetStepSnapFeedback={()=>{}}
            onSetPieceAnnotation={(id,pid,text)=>apply(h=>actions.setPieceAnnotationAction(h,id,pid,text))}
            onRemovePieceFromStep={(id,pid)=>apply(h=>actions.removePieceFromStepAction(h,id,pid))}
            onAddPieceToStep={(id,pid)=>apply(h=>actions.addPieceToStepAction(h,id,pid))}/></div>
        </>}
      </section>
    </StudioSlot>
  </>
}
