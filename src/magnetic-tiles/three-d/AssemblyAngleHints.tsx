import {useEffect,useState} from 'react'
import {intakeApi} from '../intake/api.ts'
import type {Assembly3D} from './assembly.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import type {Selection} from './editor-project.ts'
import {angleHintSourceKey,bindAngleHintSource,assemblyAngleHintRows} from './assembly-angle-hints.ts'
import type {AngleHintSource,AnglePlanRecord,AngleExecutionRecord,AngleRefinementRecord,AngleComparison} from './assembly-angle-hints.ts'

const labels:Record<AngleComparison,string>={'in-range':'范围内','out-of-range':'范围外','suggested':'符合建议值','other-angle':'非建议值（未提供范围）','no-angle':'未提供角度','not-comparable':'无法直接比较','unconnected':'未连接','no-hint':'无对应建议'}
const degrees=(n:number)=>`${Number(n.toFixed(3))}°`
/** Only immutable source records are read here; no editor or validation writes. */
export function AssemblyAngleHints({assembly,origin,selection,select,busy}:{assembly:Assembly3D;origin:PhotoOrigin3D|null;selection:Selection;select:(s:Selection)=>void;busy:boolean}){
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
  <div className="magnetic-3d-angle-heading"><b>空间规划角度建议</b>{variants.length>1&&<select aria-label="角度建议方案" value={index} onChange={e=>setVariant({key,index:Number(e.target.value)})}>{variants.map((v,i)=><option key={i} value={i}>{i===source.executedVariant?'执行来源 · ':''}{v.label}</option>)}</select>}</div>
  <p className="hint">Plan {source.planId.slice(0,8)} · {source.scope}{source.refined?' · Refinement 保留原始建议':''}{source.executedVariant===null?' · 执行方案未记录，默认查看主方案':''}</p>
  <p className="hint">当前角度为 Connection 的 Dihedral 约束值；建议和范围为原始推断，不代表几何验证或照片匹配。</p>
  {!rows.length?<p className="hint">当前方案无连接或角度建议。</p>:<table><colgroup><col style={{width:'28%'}}/><col style={{width:'19%'}}/><col style={{width:'27%'}}/><col/></colgroup><thead><tr><th>连接 / 关系</th><th>当前</th><th>Plan 建议</th><th>对照</th></tr></thead><tbody>{rows.map(r=><tr key={r.key} data-angle-pair={[r.pieceA,r.pieceB].sort().join('/')} data-selected={r.connectionIndex!==undefined&&selection.kind==='connection'&&selection.index===r.connectionIndex}>
   <td>{r.connectionIndex===undefined?<span>{r.pieceA} ↔ {r.pieceB}</span>:<button disabled={busy} aria-label={`查看角度连接 #${r.connectionIndex}`} onClick={()=>select({kind:'connection',index:r.connectionIndex!})}>{r.pieceA} ↔ {r.pieceB}<small>#{r.connectionIndex}</small></button>}</td>
   <td>{r.current?degrees(r.current.dihedralDeg):'—'}{r.angleInPlanDirection!==undefined&&r.angleInPlanDirection!==r.current?.dihedralDeg&&<small>Plan 方向 {degrees(r.angleInPlanDirection)}</small>}</td>
   <td>{r.hint?.angles.length?r.hint.angles.map(degrees).join(' / '):'无建议值'}<small>{r.hint?.angleRange?`${degrees(r.hint.angleRange.min)} … ${degrees(r.hint.angleRange.max)}`:'未提供范围'}</small></td>
   <td>{labels[r.comparison]}{r.missingPieces?.length?<small>零件未加入：{r.missingPieces.join('、')}</small>:null}{r.reason&&<small>{r.reason}</small>}{r.hint&&<details><summary>证据</summary><div>Plan {r.hint.pieceA}:{r.hint.portA??'未定'} ↔ {r.hint.pieceB}:{r.hint.portB??'未定'} · Flip {String(r.hint.flip??'未定')} · {r.hint.intent}</div><div>{r.hint.evidence||'无推断证据'}</div><div>不确定性：{r.hint.uncertainty||'未提供'}</div><div>证据引用：{r.hint.evidenceRefs.join('、')||'未提供'}</div></details>}</td>
  </tr>)}</tbody></table>}
 </div>
}
