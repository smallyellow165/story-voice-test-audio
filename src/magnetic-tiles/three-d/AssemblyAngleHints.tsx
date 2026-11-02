import {Fragment,useEffect,useState} from 'react'
import {intakeApi} from '../intake/api.ts'
import type {Assembly3D} from './assembly.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import {InfoHint} from '../../brick-vision/InfoHint.tsx'
import {classifyAssemblyConstraints} from './constraint-classification.ts'
import type {ValidationResult} from './vendor/engine/types.ts'
import type {AngleHintRow} from './assembly-angle-hints.ts'
import type {Selection} from './editor-project.ts'
import {angleHintSourceKey,bindAngleHintSource,assemblyAngleHintRows} from './assembly-angle-hints.ts'
import type {AngleHintSource,AnglePlanRecord,AngleExecutionRecord,AngleRefinementRecord,AngleComparison} from './assembly-angle-hints.ts'

const labels:Record<AngleComparison,string>={'in-range':'范围内','out-of-range':'范围外','suggested':'符合建议值','other-angle':'非建议值（未提供范围）','no-angle':'未提供角度','not-comparable':'无法直接比较','unconnected':'未连接','no-hint':'无对应建议'}
const degrees=(n:number)=>`${Number(n.toFixed(3))}°`
/** Only immutable source records are read here; no editor or validation writes. */
export function AssemblyAngleHints({assembly,origin,selection,select,busy,report}:{report:ValidationResult;assembly:Assembly3D;origin:PhotoOrigin3D|null;selection:Selection;select:(s:Selection)=>void;busy:boolean}){
 const key=angleHintSourceKey(assembly,origin)
 const [loaded,setLoaded]=useState<{key:string;source?:AngleHintSource;error?:string}>({key:''})
 const [variant,setVariant]=useState<{key:string;index:number}>({key:'',index:0})
 useEffect(()=>{
  let alive=true
  if(!key||!origin)return
  const o=origin.origin,read=<T,>(route:string)=>intakeApi<{record:T}>(route).then(r=>r.record)
  Promise.all([intakeApi<Record<string,unknown>>(`visible3d/origins/${encodeURIComponent(String(o.id))}`),read<AnglePlanRecord>(`visible3d/plans/${encodeURIComponent(String(o.planId))}`),read<AngleExecutionRecord>(`visible3d/executions/${encodeURIComponent(String(o.executionId))}`),o.refinement?read<AngleRefinementRecord>(`visible3d/refinements/${encodeURIComponent(String((o.refinement as {id:string}).id))}`):undefined])
   .then(([stored,plan,execution,refinement])=>{const source=bindAngleHintSource(origin,stored,plan,execution,refinement);if(alive){setLoaded({key,source});setVariant({key,index:source.executedVariant??0})}})
   .catch(e=>{if(alive)setLoaded({key,error:String(e)})})
  return()=>{alive=false}
 },[key])
 if(!key)return <p className="hint">空间规划角度建议：当前作品无关联 Spatial Plan。</p>
 const state=loaded.key===key?loaded:undefined,source=state?.source,index=variant.key===key?variant.index:0
 if(!source)return <p className="hint" role="status">空间规划角度建议：{state?.error??'读取当前来源…'}</p>
 const variants=[{label:'主方案',connections:source.plan.connections},...source.plan.alternatives],rows=assemblyAngleHintRows(assembly,source,index)
 return <div className="magnetic-3d-angle-hints" aria-label="Spatial Planning Angle Hints">
  <div className="magnetic-3d-angle-heading"><b>空间规划角度建议</b><InfoHint label="自动约束识别">分类结合建议角度、范围、证据、当前严格验证及连接闭环。共面保持只是优先级；可调折角不是物理铰链或已证明的自由度。闭环中的变量需协调，当前仅只读识别。</InfoHint>{variants.length>1&&<select aria-label="角度建议方案" value={index} onChange={e=>setVariant({key,index:Number(e.target.value)})}>{variants.map((v,i)=><option key={i} value={i}>{i===source.executedVariant?'执行来源 · ':''}{v.label}</option>)}</select>}</div>
  <p className="hint">Plan {source.planId.slice(0,8)} · {source.scope}{source.refined?' · Refinement 保留原始建议':''}{source.executedVariant===null?' · 执行方案未记录，默认查看主方案':''}</p>
  <p className="hint">当前角度为 Connection 的 Dihedral 约束值；建议和范围为原始推断，不代表几何验证或照片匹配。</p>
  <AngleHintTable key={`${key}:${index}`} assembly={assembly} rows={rows} selection={selection} select={select} busy={busy} report={report}/>
 </div>
}
const classificationLabels={'preserve-coplanar':'共面保持','adjustable-fold':'可调折角候选','undetermined':'待判断'}
function AngleHintTable({assembly,rows,selection,select,busy,report}:{assembly:Assembly3D;rows:AngleHintRow[];selection:Selection;select:(s:Selection)=>void;busy:boolean;report:ValidationResult}){
 const [expanded,setExpanded]=useState<string|null>(null),classification=classifyAssemblyConstraints(assembly,rows,report)
 if(!rows.length)return <p className="hint">当前方案无连接或角度建议。</p>
 return <div className="magnetic-3d-angle-scroll" role="region" aria-label="角度与自动约束识别表格" tabIndex={0}><table className="magnetic-3d-angle-table"><colgroup><col style={{width:'23%'}}/><col style={{width:'9%'}}/><col style={{width:'28%'}}/><col style={{width:'25%'}}/><col style={{width:'15%'}}/></colgroup><thead><tr><th>连接</th><th>当前</th><th>Plan 建议及范围</th><th>自动约束识别</th><th>对照</th></tr></thead><tbody>{rows.map(r=>{
 const identified=classification.get(r.key)!,kind=classificationLabels[identified.kind],hint=r.hint,range=hint?.angleRange,planText=`${hint?.angles.length?hint.angles.map(degrees).join(' / '):'无建议值'} ${range?`[${degrees(range.min)}, ${degrees(range.max)}]`:'（未提供范围）'}`,open=expanded===r.key,detailId=`angle-detail-${r.key}`
 return <Fragment key={r.key}><tr data-angle-pair={[r.pieceA,r.pieceB].sort().join('/')} data-constraint-kind={identified.kind} data-selected={r.connectionIndex!==undefined&&selection.kind==='connection'&&selection.index===r.connectionIndex}>
  <td title={`${r.pieceA} ↔ ${r.pieceB}`}>{r.connectionIndex===undefined?<span>{r.pieceA}↔{r.pieceB}</span>:<button disabled={busy} aria-label={`查看角度连接 #${r.connectionIndex}`} onClick={()=>select({kind:'connection',index:r.connectionIndex!})}>#{r.connectionIndex} {r.pieceA}↔{r.pieceB}</button>}</td>
  <td title={r.angleInPlanDirection!==undefined?`Plan 方向 ${degrees(r.angleInPlanDirection)}`:undefined}>{r.current?degrees(r.current.dihedralDeg):'—'}</td>
  <td title={planText}>{planText}</td>
  <td title={`${kind}；${identified.reasons.join('；')}`}><span>{identified.kind==='adjustable-fold'?'可调折角':kind}{identified.topology.coordination==='coordinated'?'·联动':identified.kind==='adjustable-fold'&&identified.topology.inCycle?'·闭环':''}</span></td>
  <td><div className="magnetic-3d-angle-comparison"><span title={r.reason}>{labels[r.comparison]}</span><button aria-label={`角度证据 ${r.pieceA} ${r.pieceB}`} aria-expanded={open} aria-controls={detailId} onClick={()=>setExpanded(open?null:r.key)}>{open?'▾':'▸'}</button></div></td>
 </tr>{open&&<tr data-angle-detail={r.key}><td colSpan={5} id={detailId}>
  <div><b>{kind}</b>：{identified.reasons.join('；')}</div>
  {!!identified.topology.coplanarGroups.length&&<div>共面子结构：{identified.topology.coplanarGroups.map(ids=>ids.join('、')).join(' ↔ ')}</div>}
  {!!identified.topology.coupledConnections.length&&<div>需协调的可调连接：{identified.topology.coupledConnections.map(i=>`#${i}`).join('、')}</div>}
  {r.reason&&<div>{r.reason}</div>}{r.missingPieces?.length?<div>零件未加入：{r.missingPieces.join('、')}</div>:null}
  {r.angleInPlanDirection!==undefined&&r.angleInPlanDirection!==r.current?.dihedralDeg&&<div>按 Plan A/B 方向对照：{degrees(r.angleInPlanDirection)}</div>}
  {hint&&<><div>Plan {hint.pieceA}:{hint.portA??'未定'} ↔ {hint.pieceB}:{hint.portB??'未定'} · Flip {String(hint.flip??'未定')} · {hint.intent}</div><div>{hint.evidence||'无推断证据'}</div><div>不确定性：{hint.uncertainty||'未提供'}</div><div>证据引用：{hint.evidenceRefs.join('、')||'未提供'}</div></>}
 </td></tr>}</Fragment>
 })}</tbody></table></div>
}
