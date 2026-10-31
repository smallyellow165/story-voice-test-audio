import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Assembly3D } from './assembly.ts'
import type { Tutorial3D } from './tutorial.ts'
import type { BuildOrderResult } from './build-order.ts'
import { DEFAULT_BUILD_ORDER_OPTIONS } from './build-order.ts'
import { canonical } from '../build-plan.ts'

type Candidate={signature:string;source:string;result:BuildOrderResult}
export function BuildOrderGenerator({assembly,active,geometryValid,hasTutorial,onAdopt,onBeforeGenerate,onGenerated,advancedHost}:{assembly:Assembly3D|null;active:boolean;geometryValid:boolean;hasTutorial:boolean;onAdopt:(t:Tutorial3D)=>void;onBeforeGenerate:()=>boolean;onGenerated:(result:BuildOrderResult)=>void;advancedHost:HTMLElement|null}){
  const [candidate,setCandidate]=useState<Candidate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [evaluations,setEvaluations]=useState(String(DEFAULT_BUILD_ORDER_OPTIONS.maxEvaluations)),[beam,setBeam]=useState(String(DEFAULT_BUILD_ORDER_OPTIONS.beamWidth))
  const [transitions,setTransitions]=useState(String(DEFAULT_BUILD_ORDER_OPTIONS.maxTransitions)),[connections,setConnections]=useState(String(DEFAULT_BUILD_ORDER_OPTIONS.maxConnectionsPerStep))
  const [grounded,setGrounded]=useState(false),worker=useRef<Worker|null>(null),request=useRef(0)
  const signature=assembly?canonical(assembly):'',currentSignature=useRef(signature);currentSignature.current=signature
  function cancel(){request.current++;worker.current?.terminate();worker.current=null;setBusy(false)}
  useEffect(()=>{if(!active&&worker.current){cancel();setError('离开 3D Build，生成已取消；当前教程保留。')}},[active])
  useEffect(()=>{if(worker.current){cancel();setError('来源作品已变化，生成已取消；请重新生成。')}},[signature])
  useEffect(()=>()=>{worker.current?.terminate();request.current++},[])
  function generate(){
    if(!assembly||!geometryValid||!onBeforeGenerate())return
    cancel();const seq=++request.current,source=signature;setError('');setCandidate(null);setBusy(true)
    try{
      const task=new Worker(new URL('./build-order.worker.ts',import.meta.url),{type:'module'});worker.current=task
      task.onmessage=(e:MessageEvent<{request:number;result?:BuildOrderResult;error?:string}>)=>{
        if(e.data.request!==request.current||currentSignature.current!==source)return
        task.terminate();worker.current=null;setBusy(false)
        if(e.data.result){
          setCandidate({signature:source,source:`${assembly.id} @ revision ${assembly.revision}`,result:e.data.result})
          if(e.data.result.status==='complete'&&e.data.result.finalGeometryValid&&e.data.result.connectedConstruction)onGenerated(e.data.result)
        }
        else setError(e.data.error??'规划器未返回结果；当前 Draft 保留。')
      }
      task.onerror=e=>{if(seq===request.current){task.terminate();worker.current=null;setBusy(false);setError(`规划失败：${e.message}；当前 Draft 保留。`)}}
      task.postMessage({request:seq,assembly,options:{maxEvaluations:Number(evaluations),maxTransitions:Number(transitions),beamWidth:Number(beam),maxConnectionsPerStep:Number(connections),requireGroundedStart:grounded}})
    }catch(e){cancel();setError(`无法启动规划：${String(e)}`)}
  }
  const stale=!!candidate&&candidate.signature!==signature,result=candidate?.result
  const advanced=<>
    <details><summary>搜索预算与约束</summary>
      <label>几何检查预算<input aria-label="规划几何检查预算" type="number" min={0} max={10000} value={evaluations} onChange={e=>setEvaluations(e.target.value)}/></label>
      <label>候选展开预算<input aria-label="规划候选展开预算" type="number" min={0} max={100000} value={transitions} onChange={e=>setTransitions(e.target.value)}/></label>
      <label>束宽<input aria-label="规划束宽" type="number" min={1} max={32} value={beam} onChange={e=>setBeam(e.target.value)}/></label>
      <label>每步新增连接上限<input aria-label="每步新增连接上限" type="number" min={1} max={512} value={connections} onChange={e=>setConnections(e.target.value)}/></label>
      <label><input type="checkbox" checked={grounded} onChange={e=>setGrounded(e.target.checked)}/>必须从接触地面的零件开始</label>
      <p className="hint">V1 最多 64 片。预算按确定性工作次数计算，后台生成可取消；不承诺全局最优顺序。</p>
    </details>
    {result&&<div data-testid="build-order-result">
      <h4>最近一次生成候选 · 独立于当前教程</h4><p>{candidate.source}</p>
      <p>{result.status} · {result.tutorial?.steps.length??0} 步 · 最终 Geometry {result.finalGeometryValid===null?'未检查':result.finalGeometryValid?'Valid':'Invalid'} · 完整 Connected Construction {result.connectedConstruction?'通过':'未通过'}</p>
      <p data-testid="build-order-stats">几何检查 {result.stats.evaluations}/{result.stats.options.maxEvaluations} · 候选展开 {result.stats.transitions}/{result.stats.options.maxTransitions} · 缓存 {result.stats.cacheHits} · 裁剪 {result.stats.beamPruned} · 完整候选 {result.stats.completeCandidates} · 终止 {result.stats.termination} · 评分 {result.stats.bestScore??'—'}</p>
      {result.tutorial&&<button disabled={stale||busy} onClick={()=>{if(candidate.signature!==currentSignature.current){setError('来源已变化，请重新生成。');return}onAdopt(result.tutorial!)}}>{result.status==='complete'?hasTutorial?'采用候选并替换当前 Draft':'采用为 Tutorial Draft':'采用未完成候选 Draft'}</button>}
      <p className="hint">完整结果会自动进入未保存预览；不代表人工审核通过。手动编辑后，原规划评分仅供参考；原始生成结果保留在这里。</p>
      <details open={result.status!=='complete'}><summary>生成 Diagnostic · {result.diagnostics.length}</summary><ul>{result.diagnostics.map((d,i)=><li key={i} data-build-order-diagnostic={d.code}>{d.stepId?`步骤 ${d.stepId}：`:''}{d.message}</li>)}</ul></details>
      <details><summary>逐步评分与解释</summary>{result.estimates.map(e=><div key={e.stepId}><b>{e.stepId} · {e.pieceId}</b><p>Geometry {e.geometryValid?'Valid':'Invalid'} · 连通 {e.connected?'通过':'未通过'} · 新增连接 {e.newConnections} · 新闭环 {e.loopClosures} · 评分 {e.score}</p><p>{Object.entries(e.terms).map(([k,v])=>`${k}=${v.toFixed(3)}`).join('；')}</p></div>)}</details>
      <details><summary>完整生成结果 JSON</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
    </div>}
  </>
  return <section className="magnetic-build-order" aria-label="自动生成 3D Build Order">
    <div className="button-row"><button className="primary" disabled={!assembly?.pieces.length||!geometryValid||busy} onClick={generate}>{hasTutorial?'重新生成教程':'生成搭建教程'}</button>{busy&&<button onClick={()=>{cancel();setError('生成已取消；当前教程保留。')}}>取消生成</button>}</div>
    {busy&&<p role="status">正在生成搭建步骤；当前教程保留。</p>}{error&&<p role="alert">{error}</p>}
    {result&&<>
      <p role="status" data-testid="build-order-status" data-status={result.status}>{result.status==='complete'?'已生成':result.status==='budget-exhausted'?'生成未完成：搜索预算耗尽':'生成未完成'} · {result.tutorial?.steps.length??0} 步 · 待人工审核</p>
      {stale&&<p role="alert">生成结果来源已过期，不能用于当前作品。请重新生成。</p>}
      {result.status!=='complete'&&<p role="alert">未替换当前教程。{result.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('；')||'未找到满足全部约束的完整顺序，请查看高级诊断。'}</p>}
      <p className="hint">Buildability Estimate：{result.buildabilityEstimate}；Physical Stability：未验证。生成结果仍需人工审核。</p>
    </>}
    {advancedHost&&createPortal(advanced,advancedHost)}
  </section>
}
