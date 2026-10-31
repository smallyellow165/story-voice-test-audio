import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import { createTutorial3D, tutorialProject, tutorialMatchesAssembly, validateTutorial3D, serializeTutorial3D, parseTutorial3D } from './tutorial.ts'
import type { Tutorial3D } from './tutorial.ts'
import { validateAssembly3D } from './engine-adapter.ts'
import { loadTutorial3D, saveTutorial3D, openSavedTutorial3D } from './tutorial-storage.ts'
import * as actions from './vendor/editor/tutorial-state.ts'
import type { EditorHistory } from './vendor/editor/tutorial-state.ts'
import { StepTimeline } from './vendor/components/editor/StepTimeline.tsx'
import { TutorialOrchestrationPanel } from './vendor/components/editor/TutorialOrchestrationPanel.tsx'
import { TutorialPlayer } from './vendor/components/tutorial/TutorialPlayer.tsx'
import { BuildOrderGenerator } from './BuildOrderGenerator.tsx'
import type { TutorialCamera } from './vendor/components/tutorial/TutorialPlayer.tsx'
import './viewer.css'
import './tutorial.css'

import { generatedPreview, tutorialReadyToSave } from './tutorial-workflow.ts'
import type { BuildOrderResult } from './build-order.ts'
import { MagnetScene3D } from './vendor/components/MagnetScene3D.tsx'

export default function ThreeDBuildWorkspace(){
  const {stage,viewMode,assembly3D}=useStudio(),active=stage==='build'&&viewMode==='3d'
  const [boot]=useState(()=>{try{return {...loadTutorial3D(localStorage),error:''}}catch(e){return {tutorial:null,saved:[],raw:null,error:`原教程存档无法读取，禁止覆盖：${String(e)}`}}})
  const [history,setHistory]=useState<EditorHistory|null>(()=>boot.tutorial?actions.createInitialHistory(boot.tutorial):null)
  const historyRef=useRef(history);historyRef.current=history
  const [savedTutorials,setSavedTutorials]=useState(boot.saved),[savedId,setSavedId]=useState(boot.tutorial?.id??'')
  const [selected,setSelected]=useState<number|null>(boot.tutorial?.steps[0]?.id??null)
  const [seekRequest,setSeekRequest]=useState<{index:number;sequence:number}|null>(null)
  const [error,setError]=useState(boot.error),[notice,setNotice]=useState(''),[raw,setRaw]=useState('')
  const [clean,setClean]=useState(boot.tutorial?serializeTutorial3D(boot.tutorial):'')
  const expected=useRef(boot.raw),fileRequest=useRef(0),camera=useRef<TutorialCamera|null>(null)
  const documentEpoch=useRef(0),generationEpoch=useRef(0),sourceRef=useRef(assembly3D);sourceRef.current=assembly3D
  const [generated,setGenerated]=useState(false)
  const [cameraReady,setCameraReady]=useState(false),[loadEpoch,setLoadEpoch]=useState(0)
  const [controlsHost,setControlsHost]=useState<HTMLDivElement|null>(null),[detailsHost,setDetailsHost]=useState<HTMLDivElement|null>(null),[generatorHost,setGeneratorHost]=useState<HTMLDivElement|null>(null)
  const tutorial=history?.current??null,dirty=!!tutorial&&serializeTutorial3D(tutorial)!==clean
  const saved=!generated&&!!tutorial&&savedTutorials.some(t=>t.id===tutorial.id&&serializeTutorial3D(t)===serializeTutorial3D(tutorial))
  const validation=useMemo(()=>tutorial?validateTutorial3D(tutorial):null,[tutorial])
  const project=useMemo(()=>tutorial?tutorialProject(tutorial):null,[tutorial])
  const sourceValidation=useMemo(()=>assembly3D?validateAssembly3D(assembly3D):null,[assembly3D])
  const matching=tutorial&&tutorialMatchesAssembly(tutorial,assembly3D)
  const ready=!!tutorial&&!!validation&&tutorialReadyToSave(tutorial,validation,assembly3D)
  const index=tutorial?Math.max(0,tutorial.steps.findIndex(s=>s.id===selected)):0,step=tutorial?.steps[index]
  const reportCamera=useCallback((c:TutorialCamera)=>{camera.current=c;setCameraReady(true)},[])
  const replaceGuard=useRef(false);replaceGuard.current=!!tutorial&&!saved&&(dirty||tutorial.steps.length>0)
  function allowReplace(){return !replaceGuard.current||confirm('当前教程有未保存修改或预览。确认替换？可先取消并保存或导出。')}
  function accept(t:Tutorial3D){
    documentEpoch.current++;setGenerated(false)
    const next=actions.createInitialHistory(t);historyRef.current=next;setHistory(next);setSelected(t.steps[0]?.id??null);setSeekRequest(null)
    camera.current=null;setCameraReady(false);setError('');setNotice('');setClean(serializeTutorial3D(t));setLoadEpoch(n=>n+1)
  }
  // Prepare only an empty in-memory document. An existing or unreadable save is
  // never replaced by navigation, source changes or this effect.
  useEffect(()=>{if(active&&!historyRef.current&&!boot.error&&assembly3D?.pieces.length&&sourceValidation?.valid){accept(createTutorial3D(assembly3D));setNotice('已准备当前作品；点击「生成搭建教程」查看步骤。尚未保存。')}},[active,assembly3D,sourceValidation,boot.error])
  function create(){try{if(assembly3D&&allowReplace()){fileRequest.current++;accept(createTutorial3D(assembly3D))}}catch(e){setError(String(e))}}
  function apply(fn:(h:EditorHistory)=>EditorHistory){
    const current=historyRef.current;if(!current)return
    try{const next=fn(current);documentEpoch.current++;historyRef.current=next;setHistory(next);setError('');setNotice('')}catch(e){setError(String(e))}
  }
  function beforeGenerate(){
    if(boot.error){setError(boot.error);return false}
    if((tutorial?.steps.length||dirty)&&!confirm('重新生成将替换当前教程预览及未保存修改。已保存教程仍保留在历史中。继续？'))return false
    generationEpoch.current=documentEpoch.current;return true
  }
  function previewGenerated(result:BuildOrderResult){
    const t=generatedPreview(result,sourceRef.current)
    if(!t){setError('生成结果未通过完整教程检查，当前教程保留。');return}
    if(generationEpoch.current!==documentEpoch.current){setNotice('生成期间教程已有修改，未覆盖。可在高级编辑与诊断中明确选择生成候选。');return}
    fileRequest.current++;accept(t);setGenerated(true);setNotice('已生成未保存预览；请逐步检查后保存。搭建风险仍需人工审核。')
  }
  useEffect(()=>{if(tutorial&&!tutorial.steps.some(s=>s.id===selected))setSelected(tutorial.steps[0]?.id??null)},[tutorial,selected])
  function choose(id:number){if(!tutorial)return;const i=tutorial.steps.findIndex(s=>s.id===id);setSelected(id);setSeekRequest(old=>({index:i,sequence:(old?.sequence??0)+1}))}
  function save(asDraft=false){try{
    if(boot.error)throw Error(boot.error);if(!tutorial)return
    if(!asDraft&&!ready)throw Error('教程未满足当前作品的完整几何与顺序检查；可在高级区域保存未完成草稿。')
    expected.current=saveTutorial3D(localStorage,tutorial,expected.current);setSavedTutorials(loadTutorial3D(localStorage).saved);setSavedId(tutorial.id)
    setClean(serializeTutorial3D(tutorial));setGenerated(false);setNotice(asDraft?'已保存未完成草稿，不代表几何、顺序或人工审核通过。':'教程已保存；仍需人工检查实际搭建风险，Physical Stability 未验证。');setError('')
  }catch(e){setError(String(e))}}
  function reload(){if(!allowReplace())return;try{const loaded=loadTutorial3D(localStorage);if(!loaded.tutorial)throw Error('尚无已保存教程');fileRequest.current++;expected.current=loaded.raw;setSavedTutorials(loaded.saved);setSavedId(loaded.tutorial.id);accept(loaded.tutorial)}catch(e){setError(String(e))}}
  function openSaved(){if(!allowReplace())return;try{const loaded=openSavedTutorial3D(localStorage,savedId,expected.current);fileRequest.current++;expected.current=loaded.raw;setSavedTutorials(loaded.saved);accept(loaded.tutorial);setNotice('已打开保存教程；来源作品和当前 Assembly 均保持原样。')}catch(e){setError(String(e))}}
  function load(json:string){try{if(!allowReplace())return;const t=parseTutorial3D(json);accept(t)}catch(e){setError(`导入失败，当前教程保留：${String(e)}`)}}
  return <>
    <StudioSlot column="workspace" stages={['build']} view="3d">
      <section className="magnetic-3d-build" aria-label="3D Build Tutorial">
        <h3>3D 搭建教程 · {tutorial?.title??'作品预览'}</h3>
        <p className="hint">{saved?'已保存教程':'未保存预览 · 待人工审核'}</p>
        {tutorial&&!matching&&<p role="alert" className="magnetic-tutorial-warning">教程来源与当前 Assembly 不同。正在查看教程内嵌快照；不会替换或重绑当前作品。生成当前作品教程需明确操作。</p>}
        {active&&tutorial&&(tutorial.steps.length?<TutorialPlayer key={`${tutorial.id}-${loadEpoch}`} tutorial={tutorial} initialStep={index} seekRequest={seekRequest}
          onStepChange={i=>setSelected(tutorial.steps[i]?.id??null)} onCameraChange={reportCamera} controlsHost={controlsHost} detailsHost={detailsHost}/>:<><p>当前作品预览 · 尚无搭建步骤，请点击右侧「生成搭建教程」。</p><MagnetScene3D assembly={tutorial.assembly} selected={null} onSelect={()=>{}}/></>)}
        {!tutorial&&<p>请先在 Assembly → 3D 选择作品；也可从右侧打开已保存教程。</p>}
      </section>
    </StudioSlot>
    <StudioSlot column="inspector" stages={['build']} view="3d">
      <section className="magnetic-tutorial-inspector" aria-label="3D Tutorial Inspector">
        <h3>搭建教程</h3>
        <p className="context-notice" title={assembly3D?.id}>当前作品：{assembly3D?`${assembly3D.id} · r${assembly3D.revision}`:'等待加载'}</p>
        {tutorial&&<p className="hint" data-testid="tutorial-source">教程来源 {tutorial.source.assemblyId} @ revision {tutorial.source.assemblyRevision} · {tutorial.assembly.pieces.length} 片 / {tutorial.assembly.connections.length} 条连接</p>}
        {sourceValidation&&!sourceValidation.valid&&<p role="alert">当前 Assembly Geometry Invalid；不能生成正常教程。{sourceValidation.issues.map(i=>i.message).join('；')}</p>}
        {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
        <BuildOrderGenerator assembly={assembly3D} active={active} geometryValid={sourceValidation?.valid??false} hasTutorial={!!tutorial?.steps.length}
          onBeforeGenerate={beforeGenerate} onGenerated={previewGenerated} advancedHost={generatorHost}
          onAdopt={t=>{if(!confirm('使用此生成候选替换当前教程预览？此操作不保存；未完成结果只能作为未验证草稿。'))return;fileRequest.current++;accept(t)}}/>
        <div ref={setControlsHost}/>
        {tutorial&&validation&&<section className="magnetic-tutorial-summary" aria-label="3D 教程检查状态">
          <p role="status" data-testid="tutorial-validation">最终 Assembly Geometry {validation.finalValid?'Valid':'Invalid'} · {validation.verified?'几何与顺序检查通过':'教程尚有待检查项'}</p>
          {!!tutorial.steps.length&&<p data-testid="tutorial-step-validation">当前步骤 Geometry {validation.steps[index]?.geometryValid?'Valid':'Invalid'} · Connected Construction {validation.steps[index]?.connected?'通过':'未通过'} · {validation.steps[index]?.components??0} 个组件</p>}
          <p>Buildability Estimate：{ready?'review-required':'incomplete'} · Physical Stability：未验证</p>
          <p className="hint">地面接触不等于支撑验证；磁力、稳定站立、安装路径与操作空间均未验证。</p>
          {tutorial.steps.length>0&&validation.issues.some(i=>i.severity==='error')&&<p role="alert">教程未通过完整检查，不能保存为正常教程。{validation.issues.filter(i=>i.severity==='error').map(i=>i.message).join('；')}</p>}
          {tutorial.steps.length>0&&!validation.steps[index]?.grounded&&<p className="magnetic-tutorial-warning">当前步骤没有接触地面；需要人工扶持或检查支撑，稳定性未验证。</p>}
          {!!step&&step.addedConnections.length>1&&<p className="magnetic-tutorial-warning">本步需新增 {step.addedConnections.length} 条连接；请人工确认多边安装、闭环操作空间与托持。详细风险见高级诊断。</p>}
          {!!tutorial.steps.length&&validation.steps.some(s=>!s.connected)&&<p role="alert">部分步骤不满足 Connected Construction；请检查步骤顺序。</p>}
        </section>}
        <div className="build-save-row"><button className="primary" disabled={!ready||saved||!!boot.error} onClick={()=>save()}>保存教程</button><span data-testid="tutorial-save-status">{saved?'已保存 · 与保存版本一致':tutorial?'未保存预览':'未打开教程'}</span></div>
        <div className="build-saved"><label>历史教程<select aria-label="3D 历史教程" value={savedId} onChange={e=>setSavedId(e.target.value)}><option value="">选择已保存教程</option>{savedTutorials.map(t=><option key={t.id} value={t.id}>{t.title} · {t.source.assemblyId} / r{t.source.assemblyRevision} · {t.steps.length} 步</option>)}</select></label><button disabled={!savedId||!!boot.error} onClick={openSaved}>打开教程</button></div>
        <details className="magnetic-tutorial-advanced"><summary>高级编辑与诊断</summary>
          <div ref={setGeneratorHost}/>
          <div className="button-row"><button disabled={!assembly3D||!assembly3D.pieces.length} onClick={create}>{sourceValidation?.valid?'从当前 3D Assembly 创建教程':'创建未验证 Tutorial Draft'}</button><button onClick={reload}>重新加载已保存教程</button>{tutorial&&<button disabled={!!boot.error} onClick={()=>save(true)}>保存未完成草稿</button>}</div>
          {tutorial&&project&&validation&&<>
            <details><summary>教程 Diagnostic · {validation.issues.length}</summary><ul>{validation.issues.map((i,n)=><li key={n} data-tutorial-diagnostic={i.code}>{i.stepId?`步骤 ${i.stepId}：`:''}{i.message}</li>)}</ul></details>
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
          <div ref={setDetailsHost}/>
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

        </details>
      </section>
    </StudioSlot>
  </>
}
