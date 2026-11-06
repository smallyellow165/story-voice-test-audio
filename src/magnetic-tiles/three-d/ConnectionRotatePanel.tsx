import {useEffect,useState} from 'react'
import type {Assembly3D} from './assembly.ts'
import type {EdgeSnapMode} from './editor-snap.ts'
import {previewConnectionRotation} from './connection-rotate.ts'
import type {ConnectionRotationPreview} from './connection-rotate.ts'
import {TileCollisionWarning} from './TileSnapPreview.tsx'

export function ConnectionRotatePanel({assembly,pieceId,axisIndex,setAxisIndex,mode,setMode,preview,setPreview,onConfirm,busy}:{
 assembly:Assembly3D;pieceId:string;axisIndex:number|null;setAxisIndex:(i:number|null)=>void
 mode:EdgeSnapMode;setMode:(m:EdgeSnapMode)=>void;preview:ConnectionRotationPreview|null
 setPreview:(p:ConnectionRotationPreview|null)=>void;onConfirm:(p:ConnectionRotationPreview)=>void;busy:boolean
}){
 const [angle,setAngle]=useState('0'),[step,setStep]=useState('1'),[error,setError]=useState('')
 const choices=assembly.connections.map((c,index)=>({c,index})).filter(({c})=>[c.pieceA,c.pieceB].includes(pieceId))
 const c=axisIndex===null?undefined:assembly.connections[axisIndex]
 function updatePreview(){
  if(axisIndex===null){setPreview(null);setError('');return}
  if(!angle.trim()||!Number.isFinite(Number(angle))){setPreview(null);setError('请输入有限的旋转角度');return}
  if(Number(angle)===0){setPreview(null);setError('');return}
  try{setPreview(previewConnectionRotation(assembly,pieceId,axisIndex,Number(angle),mode));setError('')}catch(e){setPreview(null);setError(String(e))}
 }
 useEffect(updatePreview,[assembly,pieceId,axisIndex,angle,mode])
 const fresh=preview?.pieceId===pieceId&&preview.connectionIndex===axisIndex&&preview.mode===mode&&preview.deltaDeg===Number(angle)?preview:null
 const blockers=fresh?.geometry.issues.filter(i=>i.severity==='error'&&(mode==='strict'||i.code!=='intersection'))??[]
 const adjust=(sign:number)=>{if(Number.isFinite(Number(step))&&Number(step)>0)setAngle(String((Number(angle)||0)+sign*Number(step)))}
 return <section className="connection-rotate-panel" aria-label="Rotate 旋转轴">
  <label>旋转轴<select aria-label="Tile Rotate 旋转轴" value={axisIndex??'center'} disabled={busy} onChange={e=>{setPreview(null);setAngle('0');setError('');setAxisIndex(e.target.value==='center'?null:Number(e.target.value))}}>
   <option value="center">Tile 自身轴（原有旋转）</option>
   {choices.map(({c,index})=><option key={index} value={index}>Connection #{index} · {c.pieceA===pieceId?c.pieceB:c.pieceA} · {c.pieceA===pieceId?c.portA:c.portB} ↔ {c.pieceA===pieceId?c.portB:c.portA}</option>)}
  </select></label>
  {axisIndex!==null&&c&&<>
   <div className="magnetic-3d-snap-controls">
    <label>验证模式<select aria-label="Tile Rotate 验证模式" value={mode} disabled={busy} onChange={e=>{setPreview(null);setMode(e.target.value as EdgeSnapMode)}}><option value="strict">Strict</option><option value="less-strict">Less Strict</option></select></label>
    <label>旋转角度 Δ°<input aria-label="连接边旋转角度" type="number" step="any" value={angle} disabled={busy} onChange={e=>setAngle(e.target.value)}/></label>
   </div>
   <div className="connection-rotate-step"><label>微调步长 °<input aria-label="连接边旋转步长" type="number" min="0" step="any" value={step} disabled={busy} onChange={e=>setStep(e.target.value)}/></label>
    <button disabled={busy||!Number.isFinite(Number(step))||Number(step)<=0} onClick={()=>adjust(-1)}>− 步长</button><button disabled={busy||!Number.isFinite(Number(step))||Number(step)<=0} onClick={()=>adjust(1)}>＋ 步长</button>
   </div>
   <p className="hint">Δ 基于已确认姿态，绕固定端 Port 的 p0 → p1 方向旋转；只移动当前 Tile，其他连接仍参与验证。</p>
   <p>Dihedral：{c.dihedralDeg.toFixed(4)}°{fresh&&<> → {fresh.assembly.connections[axisIndex].dihedralDeg.toFixed(4)}° · {fresh.geometry.valid?'Geometry Valid':'Geometry Invalid'} · 预览尚未修改 Draft</>}</p>
   {fresh&&mode==='less-strict'&&<TileCollisionWarning geometry={fresh.geometry} label="Rotate 碰撞 Warning"/>}
   {blockers.length>0&&<div role="alert" className="magnetic-3d-blocker"><p>旋转阻断：</p><ul>{blockers.map((i,n)=><li key={n}>{i.message}</li>)}</ul></div>}
   {error&&<p role="alert" className="magnetic-3d-blocker">{error}</p>}
   <div className="button-row"><button disabled={busy||!angle.trim()||!Number.isFinite(Number(angle))||Number(angle)===0} onClick={updatePreview}>预览旋转</button><button disabled={busy||!fresh?.canConfirm} onClick={()=>fresh&&onConfirm(fresh)}>确认旋转</button><button disabled={busy||!preview&&!error&&Number(angle)===0} onClick={()=>{setPreview(null);setAngle('0');setError('')}}>取消旋转</button></div>
  </>}
 </section>
}
