import {explainMating} from './mating-explanation.mjs'
import {validateFinalAssembly,connectors,connectionCandidates} from './assembly'
import {geometrySupport,STUD_LDU} from './catalog'
import {useContext,useEffect,useMemo,useState} from 'react'
import {InspectorContext,InspectorContent} from './SpatialInspector'
import {geometryIssuesForDisplay,expectedConnections} from './geometry-issues.mjs'
import type {SpatialPreview} from './SpatialAssemblyPanel'
export function GeometryIssues({geometryId,refinement,onPreview,selectedLayout}:{geometryId:string;refinement:any;selectedLayout?:any;onPreview(value:SpatialPreview|null):void}){
 const context=useContext(InspectorContext),[savedReport,setReport]=useState<any>(null),[error,setError]=useState(''),[selected,setSelected]=useState('')
 useEffect(()=>{let live=true;setReport(null);setError('');setSelected('');context.highlight([])
  fetch('/api/brick-spatial/geometry/'+geometryId+'/report').then(async r=>{if(!r.ok)throw Error('无法读取已保存诊断');return r.json()}).then(r=>{if(live)setReport(r)}).catch(e=>{if(live)setError(String(e))})
  return()=>{live=false}
 },[geometryId])
 useEffect(()=>{setSelected('');context.highlight([])},[selectedLayout?.id])
 const report=useMemo(()=>selectedLayout?{...savedReport,selectedLayout,diagnosticAssembly:{bricks:selectedLayout.assembly.bricks,geometry:selectedLayout.geometry}}:savedReport,[savedReport,selectedLayout])
 const matched=!selectedLayout&&refinement?.geometryId===geometryId?refinement:null
 const issues=useMemo(()=>geometryIssuesForDisplay(report,matched),[report,matched])
 const explanations=useMemo(()=>Object.fromEntries(issues.map(i=>{
  if(['Position Mismatch','Spatial Relation','Missing Connection'].includes(i.type))return [i.key,{classification:i.type,reason:i.details[0].reason||'当前候选未满足计划声明',scope:'当前选中布局的完整验证结果；不会自动改动位置或连接。'}]
  if(i.type==='Constraint Conflict')return [i.key,{classification:'Constraint Conflict',reason:i.details[0].reason,scope:'必要约束传播证明域为空；展示的首组姿态仅供定位，不是完整验证候选。'}]
  const c=expectedConnections(report?.sourcePlan,i.ids).find((c:any)=>c.intent==='mates')
  const bs=report?.diagnosticAssembly?.bricks||[]
  return [i.key,c?explainMating(bs.find((b:any)=>b.id===c.id),bs.find((b:any)=>b.id===c.other),c,{validateFinalAssembly,connectors,connectionCandidates,geometrySupport,STUD_LDU}):{classification:i.type==='Collision'?'Geometry Collision':'Unknown',reason:'已有记录的检测结论；未推断额外接口能力。'}]
 })),[report,issues])
 const issue=issues.find(i=>i.key===selected&&i.ids.join('|')===context.highlightIds.join('|'))
 function choose(i:any){
  const layout=report?.diagnosticAssembly
  if(!layout)return
  onPreview({bricks:layout.bricks,label:selectedLayout?`${selectedLayout.kind==='valid'?'Valid':'Diagnostic'} Layout / ${selectedLayout.id}`:'Diagnostic / '+geometryId,review:selectedLayout?.kind==='valid'?'Valid Layout':'诊断布局 · 非合法候选',layoutKind:selectedLayout?.kind==='valid'?'valid':'diagnostic',geometry:layout.geometry})
  setSelected(i.key);context.highlight(i.ids)
 }
 function clear(){setSelected('');context.highlight([])}
 const content=<section className="geometry-issues" aria-label="Geometry Issues">
  {report&&<div role="status" className={'spatial-state '+(report.status==='budget_exceeded'?'review':report.status==='no_solution'?'failed':'')}>
   <strong>{report.status==='budget_exceeded'?'未完成搜索 · 预算不足':report.status==='no_solution'?(report.proof?'必要约束已证明无解':'搜索完成 · 候选未通过完整验证'):report.candidates?.length?'已找到通过验证的候选':'尚无验证通过的候选'}</strong>
   <p>原始组合：{report.originalCombinationCount??report.combinationCount??'Unknown'} · 过滤后：{report.combinationCount??'Unknown'} · 预算：{report.policy?.maxCombinations??'Unknown'} · 完整布局尝试：{report.attempts?.length??0}</p>
   {(report.diagnostics||[]).map((d:any,i:number)=><p key={i}>{typeof d==='string'?d:d.reason||d.code}</p>)}
   {report.pruning&&<details><summary>候选过滤、约束传播与预算详情</summary><pre>{JSON.stringify(report.pruning,null,2)}</pre></details>}
  </div>}
  <h3>Geometry Issues · {issues.length}</h3>
  <p className="brick-help">来源：原始 Geometry {geometryId.slice(0,8)}{matched?' / Refinement '+matched.id.slice(0,8):''}。{selectedLayout?`当前 ${selectedLayout.id}；点击高亮该布局中的零件`:'点击问题切回原始诊断布局'}；不修改积木。</p>
  {error&&<p role="alert">{error}</p>}
  {!issues.length&&<p>当前记录未提供可定位到两个零件的问题；不代表 Geometry Valid。</p>}
  {issues.map(i=><button type="button" className={'geometry-issue '+(issue?.key===i.key?'selected':'')} aria-pressed={issue?.key===i.key} key={i.key} onClick={()=>choose(i)} disabled={!report?.diagnosticAssembly}>
   <strong>{i.ids.join(' ↔ ')}</strong><br/>当前复核：{explanations[i.key]?.classification||i.type}<br/>历史记录：{i.scope==='layout'?'当前候选的检测结果':'原搜索域内无法满足指定条件'}
   {i.details[0].reason&&<p>{i.details[0].reason}</p>}
   {i.details[0].minimumAxisGapLdu&&<span className="issue-gap">{Object.entries(i.details[0].minimumAxisGapLdu).filter(([,v])=>typeof v==='number'&&v>0).map(([a,v])=>`${a==='y'?'高度 Y':a==='z'?'深度 Z':'水平 X'} 差 ${v} LDU`).join('；')||'指定接口无法同时对齐'}</span>}
  </button>)}
  {context.highlightIds.length>0&&<button type="button" onClick={clear}>取消问题选择 · 恢复显示</button>}
  {issue&&<div className="geometry-issue-detail" data-testid="geometry-issue-detail">
   <p><span style={{color:'#007bb8'}}>蓝色：{issue.ids[0]}</span><br/><span style={{color:'#bd1765'}}>洋红：{issue.ids[1]}</span></p>
   <h4>Expected · 计划声明</h4>
   {expectedConnections(report.sourcePlan,issue.ids).map((c:any,i:number)=><div key={i}><code>{c.id}.{c.ownSurface}[{c.ownConnector??'Unknown'}] → {c.other}.{c.otherSurface}[{c.otherConnector??'Unknown'}]</code><p>{c.intent} · {c.visibility||'Unknown'}<br/>{c.evidence||'Unknown'}</p></div>)}
   {(report.sourcePlan?.relations||[]).filter((r:any)=>issue.ids.includes(r.from)&&issue.ids.includes(r.to)).map((r:any,i:number)=><p key={'relation-'+i}>{r.from} → {r.to} · {r.kind}<br/>{r.evidence}</p>)}
   {!expectedConnections(report.sourcePlan,issue.ids).length&&<p>Unknown · 未声明直接连接</p>}
   <h4>Actual · 已保存的检测结果与当前只读复核</h4>
   <div data-testid="mating-explanation"><strong>{explanations[issue.key]?.classification}</strong><p>{explanations[issue.key]?.reason}</p>
   <p>{explanations[issue.key]?.scope}</p>
   {!!explanations[issue.key]?.alternatives?.length&&<><p>当前姿态其他合法配对（非自动修改）：</p><ul>{explanations[issue.key].alternatives.map((p:any)=><li key={p.ownConnector+'/'+p.otherConnector}>{explanations[issue.key].ownId}[{p.ownConnector}] ↔ {explanations[issue.key].otherId}[{p.otherConnector}] · ({p.pointLdu.x}, {p.pointLdu.y}, {p.pointLdu.z}) LDU</li>)}</ul></>}
   {explanations[issue.key]?.specified&&<p>指定接口世界坐标：{['own','other'].map(k=>{const p=explanations[issue.key].specified[k];return k+': '+(p?`(${p.x}, ${p.y}, ${p.z}) LDU`:'Unknown / 未指定')}).join('；')}</p>}
   {explanations[issue.key]?.witness&&<p>独立两零件测试存在合法姿态；当前完整装配状态不变。</p>}
   <details><summary>只读接口复核详情</summary><pre>{JSON.stringify(explanations[issue.key],null,2)}</pre></details></div>
   <p>{issue.scope==='layout'?'该候选未满足这项检查；具体 Expected / Actual 见下方原始记录。':'当前允许的姿态搜索域无法满足此指定条件；不表示两种真实零件绝对无法连接。'}</p>
   {issue.details[0].minimumAxisGapLdu&&<p>独立坐标最小差：{Object.entries(issue.details[0].minimumAxisGapLdu).map(([a,v])=>`${a.toUpperCase()} = ${v??'Unknown'}`).join('，')} LDU。各轴最小值可能来自不同姿态，不能作为三维修正向量。</p>}
   <p className="brick-help">未进行自动修复。搜索域结论不是当前布局距离测量；二维照片不能证明三维碰撞。</p>
   <details><summary>原始 Issue 技术细节</summary><pre>{JSON.stringify(issue.details,null,2)}</pre></details>
  </div>}
 </section>
 return <><InspectorContent step="geometry">{content}</InspectorContent><InspectorContent step="refinement">{content}</InspectorContent></>
}
