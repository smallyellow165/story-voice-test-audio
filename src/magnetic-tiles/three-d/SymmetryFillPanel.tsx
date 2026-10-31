import {useMemo,useState,useEffect} from 'react'
import type {Assembly3D} from './assembly.ts'
import {serializeAssembly3D} from './assembly.ts'
import {proposeSymmetryPlane,referenceSymmetryPlane,previewSymmetryFill} from './symmetry-fill.ts'
import type {SymmetryFillPreview} from './symmetry-fill.ts'

export function SymmetryFillPanel({assembly,sourceIds,preview,setPreview,confirmPreview,close}:{assembly:Assembly3D;sourceIds:string[];preview:SymmetryFillPreview|null;setPreview:(p:SymmetryFillPreview|null)=>void;confirmPreview:()=>void;close:()=>void}){
 const [mode,setMode]=useState('auto'),[reference,setReference]=useState(assembly.pieces[0]?.id??''),[axis,setAxis]=useState<'x'|'y'|'z'>('x'),[offset,setOffset]=useState('0'),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('')
 const signature=serializeAssembly3D(assembly)+JSON.stringify(sourceIds)+mode+reference+axis+offset
 const [confirmedSignature,setConfirmedSignature]=useState('')
 useEffect(()=>{setError('')},[signature])
 const candidate=useMemo(()=>{if(!sourceIds.length)return {plane:null,error:''};try{return {plane:mode==='auto'?proposeSymmetryPlane(assembly,sourceIds):referenceSymmetryPlane(assembly,reference,axis,Number(offset)),error:''}}catch(e){return {plane:null,error:String(e)}}},[signature])
 const ready=confirmed&&confirmedSignature===signature&&candidate.plane
 function prepare(){try{if(!ready)throw Error('请确认当前平面及来源选择');setPreview(previewSymmetryFill(assembly,{sourceIds,plane:candidate.plane!,confirmedPlane:true}));setError('')}catch(e){setError(String(e));setPreview(null)}}
 return <section className="magnetic-symmetry-panel" aria-label="Symmetry Fill">
  <div className="magnetic-3d-collision-heading"><h4>对称补全 · Symmetry Fill</h4><button disabled={!!preview} onClick={close}>关闭工具</button></div>
  <p className="hint">在下方 Tiles &amp; Connections 勾选来源。只镜像所选零件，不自动补底面；新增结构是对称假设，非照片观察。</p>
  <p data-testid="symmetry-source-count">来源 {sourceIds.length} 片{sourceIds.length?`：${sourceIds.join('、')}`:''}</p>
  <label>对称平面<select aria-label="对称平面方式" disabled={!!preview} value={mode} onChange={e=>setMode(e.target.value)}><option value="auto">共面来源 / 框架对称候选</option><option value="reference">明确指定参考 Tile 平面</option></select></label>
  {mode==='reference'&&<div className="magnetic-symmetry-reference"><label>参考 Tile<select aria-label="对称参考 Tile" disabled={!!preview} value={reference} onChange={e=>setReference(e.target.value)}>{assembly.pieces.map(p=><option key={p.id}>{p.id}</option>)}</select></label><label>局部法向<select aria-label="对称平面局部法向" disabled={!!preview} value={axis} onChange={e=>setAxis(e.target.value as typeof axis)}>{(['x','y','z'] as const).map(a=><option key={a}>{a}</option>)}</select></label><label>法向偏移<input aria-label="对称平面偏移" disabled={!!preview} type="number" value={offset} onChange={e=>setOffset(e.target.value)}/></label></div>}
  {candidate.plane?<><p className="hint" data-testid="symmetry-plane">世界平面 n·x = d · n ({candidate.plane.normal.map(v=>Number(v.toFixed(5))).join(', ')}) · d {Number(candidate.plane.offset.toFixed(5))}。基于完整几何框架，不表示已知真实背面。</p><label className="magnetic-symmetry-confirm"><input type="checkbox" aria-label="确认对称平面假设" disabled={!!preview} checked={!!ready} onChange={e=>{setConfirmed(e.target.checked);setConfirmedSignature(signature)}}/>确认此平面及所选来源用于补全假设</label></>:candidate.error?<p role="alert">{candidate.error}</p>:<p className="hint">请先在表格中选择需要补全的 Tile。</p>}
  {error&&<p role="alert">{error}</p>}
  {!preview?<button disabled={!ready} onClick={prepare}>预览补全</button>:<>
    <p data-testid="symmetry-preview-summary">预览：新增 {preview.addedIds.length} 片 · {preview.addedConnections.length} 条连接 · 总计 {preview.assembly.pieces.length} 片。原 Draft 尚未修改。</p>
    <p className={!preview.layers.idealGeometry.valid?'magnetic-3d-blocker':undefined}>Ideal Geometry {preview.layers.idealGeometry.valid?'Valid':'Invalid'} · <span className={!preview.layers.solidCollision.valid?'magnetic-3d-blocker':undefined}>Solid Collision {preview.layers.solidCollision.valid?'Valid':'Invalid'}</span></p>
    {!preview.layers.solidCollision.valid&&<p className="magnetic-3d-blocker">{preview.layers.solidCollision.issues.length} 项碰撞；加入仅生成待审核 Draft，不会继承人工批准，Build 仍需验证或重新审核。</p>}
    {!preview.canCommit&&<p role="alert">连接、端口或闭环未通过结构检查，不能加入。</p>}
    <div className="button-row"><button disabled={!preview.canCommit} onClick={confirmPreview}>确认加入</button><button onClick={()=>{setPreview(null);setError('')}}>取消预览</button></div>
    <details><summary>补全连接 / Diagnostic</summary><pre>{JSON.stringify({plane:preview.request.plane,sourceIds:preview.request.sourceIds,addedIds:preview.addedIds,connections:preview.addedConnections,scaffoldMap:preview.scaffoldMap,geometry:preview.geometry},null,2)}</pre></details>
  </>}
 </section>
}
