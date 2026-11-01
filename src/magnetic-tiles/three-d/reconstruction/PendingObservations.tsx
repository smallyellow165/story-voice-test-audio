import {useState} from 'react'
import type {Assembly3D,Pose3D} from '../assembly.ts'
import {pendingForAssembly} from './pending-observations.ts'
import type {PendingObservation} from './pending-observations.ts'
export function PendingObservations({assembly,values,disabled,onPlace}:{assembly:Assembly3D;values:PendingObservation[];disabled:boolean;onPlace:(p:PendingObservation,pose:Pose3D)=>void}){
    const [id,setId]=useState(''),[xyz,setXyz]=useState(['','',''])
    const pending=pendingForAssembly(assembly,values),selected=pending.find(p=>p.id===id)
    if(!values.length)return null
    return <details className="visible3d-origin" aria-label="未放置来源实例"><summary>未放置来源实例 · {pending.length}</summary>
        <p className="hint">已重建部分保留采用时 Pose。下列实例仍有来源证据，尚未分配位置；不会自动放入场景。初始旋转为 0°；填写位置后可继续使用原 Gizmo、旋转和吸附工具。</p>
        <table className="visible3d-refinement-table"><thead><tr><th>Observation</th><th>Profile</th><th>操作</th></tr></thead><tbody>{pending.map(p=><tr key={p.id}><td>{p.id}</td><td>{p.profileId?`${p.profileId}@${p.profileVersion}`:'Unknown'}</td><td><button disabled={disabled||!p.profileSnapshot||!p.confirmed} onClick={()=>{setId(p.id);setXyz(['','',''])}}>准备补充</button></td></tr>)}</tbody></table>
        {selected&&<><p>{selected.id} · 手动放置；不自动建立连接</p><div className="visible3d-budget">{xyz.map((v,i)=><label key={i}>位置 {'XYZ'[i]}<input aria-label={`未放置实例位置 ${'XYZ'[i]}`} type="number" step=".1" value={v} onChange={e=>setXyz(values=>values.map((x,j)=>j===i?e.target.value:x))}/></label>)}</div><button disabled={disabled||xyz.some(x=>!x.trim()||!Number.isFinite(Number(x)))} onClick={()=>onPlace(selected,{position:xyz.map(Number) as [number,number,number],quaternion:[0,0,0,1]})}>按输入位置加入 {selected.id}</button><button onClick={()=>setId('')}>取消补充</button></>}
    </details>
}
