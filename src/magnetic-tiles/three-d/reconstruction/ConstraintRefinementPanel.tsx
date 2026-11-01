import {useState} from 'react'
import type {ConstraintRefinement,RefinementReference} from './constraint-refinement.ts'
import type {VisibleExecution3D} from './execute.ts'

export type RefinementRecord={id:string;hash:string;planId:string;planHash:string;reviewId:string;reviewHash:string;sourceId:string;sourceHash:string;createdAt:string;refinement:ConstraintRefinement;candidateHashes:Record<string,string>}
type Result=VisibleExecution3D&{id:string;createdAt:string;refinement?:RefinementReference}
export function ConstraintRefinementPanel({records,selection,executions,busy,blocked,onGenerate,onSelect}:{records:RefinementRecord[];selection:RefinementReference|null;executions:Result[];busy:boolean;blocked:boolean;onGenerate:()=>Promise<string>;onSelect:(r:RefinementReference|null)=>void}){
    const [inspected,setInspected]=useState('')
    const record=records.find(r=>r.id===inspected)??records.find(r=>r.id===selection?.id)??records[0]
    const r=record?.refinement
    return <details className="visible3d-refinement" aria-label="Constraint Refinement"><summary>Constraint Refinement · {selection?selection.candidateId:'原始 Plan'}</summary>
        <div className="visible3d-refinement-actions"><button disabled={busy||blocked} onClick={()=>void onGenerate().then(setInspected)}>生成修正候选</button><button disabled={busy||!selection} onClick={()=>onSelect(null)}>使用原始 Plan</button></div>
        <p className="hint">仅修正未经确认的 Port 占用冲突；保留原 Plan。端口一致不代表 Geometry Valid 或照片匹配。完整几何检查需明确执行。</p>
        {records.length>1&&<label>修正版本<select aria-label="Constraint Refinement 版本" value={record?.id??''} onChange={e=>setInspected(e.target.value)}>{records.map(r=><option key={r.id} value={r.id}>{r.createdAt} · {r.id.slice(0,8)}</option>)}</select></label>}
        {r&&<>
            <p>{r.conflicts.reduce((n,c)=>n+c.conflicts.length,0)} 处端口冲突 · {r.candidates.length} 个方案 · {r.search.considered}/{r.options.maxNodes} 检查{!r.search.complete?' · 搜索未完成，仅列出已检查方案':''}</p>
            {r.blockers.map((b,i)=><p role="alert" key={i}>{b}</p>)}
            {!r.candidates.length&&<p>{r.conflicts.every(v=>!v.conflicts.length)?'没有可执行的 Port 占用冲突；可继续使用原始 Plan。':'没有可采用的修正方案，请人工核对。'}</p>}
            {!!r.candidates.length&&<div className="visible3d-refinement-list"><table className="visible3d-refinement-table"><thead><tr><th>方案 / 差异</th><th>几何执行</th><th>操作</th></tr></thead><tbody>{r.candidates.map(c=>{
                const x=executions.filter(x=>x.refinement?.id===record.id&&x.refinement.hash===record.hash&&x.refinement.candidateId===c.id&&x.refinement.candidateHash===record.candidateHashes[c.id]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
                const count=x?.candidates.filter(c=>c.geometry.valid).length??0,max=x?.candidates.reduce((n,c)=>Math.max(n,c.coverage.reconstructed.length),0)??0
                const active=selection?.id===record.id&&selection.hash===record.hash&&selection.candidateId===c.id
                return <tr key={c.id} aria-selected={active}><td><b>{c.id}</b><small>解释 {c.variantIndex+1} · 留 {c.retained.length} / 舍 {c.removed.length} · Port 一致</small><details><summary>连接差异</summary><p>涉及：{c.observations.join(', ')}</p><p>原解释：{c.label}</p><p>证据引用数 {c.evidenceScore}，不是照片匹配评分。</p><b>舍弃的未确认假设</b>{c.removed.map((d,i)=><p key={i}>{d.constraint.pieceA}/{d.constraint.portA??'?'} ↔ {d.constraint.pieceB}/{d.constraint.portB??'?'}<br/>{d.reason}<br/><small>{d.constraint.evidence} · {d.constraint.uncertainty}</small></p>)}<b>保留连接</b>{c.retained.map((d,i)=><p key={i}>{d.pieceA}/{d.portA??'?'} ↔ {d.pieceB}/{d.portB??'?'} · {d.intent} · {d.angles.join(',')||'Unknown'}° · flip {String(d.flip)}</p>)}</details></td><td>{x?<><span>{x.status}</span><small>{count} 合法 · {max}/{c.plan.parts.length} 覆盖</small></>:<span>尚未执行</span>}</td><td><button disabled={busy||blocked||active} onClick={()=>onSelect({id:record.id,hash:record.hash,candidateId:c.id,candidateHash:record.candidateHashes[c.id]})}>{active?'已采用':'采用此方案'}</button></td></tr>
            })}</tbody></table></div>}
            <details><summary>约束、来源与完整差异</summary><pre>{JSON.stringify(record,null,2)}</pre></details>
        </>}
    </details>
}
