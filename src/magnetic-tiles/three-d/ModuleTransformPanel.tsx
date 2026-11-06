import {useEffect,useMemo,useState} from 'react'
import type {Assembly3D} from './assembly.ts'
import {moduleStep,alignModuleFace,previewModuleTransform,moduleBoundsAlignment,previewModuleBoundsAlign} from './module-transform.ts'
import type {ModulePreview,ModuleSpace,BoundsAxis,BoundsMode} from './module-transform.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import {GroupSpatialInspection,spatialNumber} from './GroupSpatialInspection.tsx'
import {faceWorldNormal,orientationAxis} from './module-snap-diagnostics.ts'
import type {SnapOrientationTarget} from './module-snap-diagnostics.ts'
export type AssemblyOperation='move'|'rotate'|'orient'|'snap'
export type ModuleTool={moving:string;fixed:string;space:ModuleSpace;face:string;mode:'translate'|'rotate'}
export function ModuleTransformPanel({assembly,inspectionAssembly=assembly,showSpatialInspection=true,selectedGroupId,tool,setTool,busy,preview,onPreview,onApply,operation,onOrientationTarget}:{assembly:Assembly3D;inspectionAssembly?:Assembly3D;showSpatialInspection?:boolean;selectedGroupId?:string;tool:ModuleTool;setTool:(v:ModuleTool)=>void;busy:boolean;preview:ModulePreview|null;onPreview:(p:ModulePreview|null)=>void;onApply:(p:ModulePreview)=>boolean;operation:AssemblyOperation;onOrientationTarget:(target:SnapOrientationTarget)=>void}){
 const [error,setError]=useState(''),[axis,setAxis]=useState<'x'|'y'|'z'>('x'),[distance,setDistance]=useState('1'),[angle,setAngle]=useState('90')
 const [referenceId,setReferenceId]=useState(''),[alignAxis,setAlignAxis]=useState<BoundsAxis>('y'),[alignMode,setAlignMode]=useState<BoundsMode>('min')
 const modules=assembly.modules??[],moving=modules.find(m=>m.id===tool.moving)
 const reference=modules.find(m=>m.id===referenceId&&m.id!==tool.moving)
 const alignment=useMemo(()=>reference&&selectedGroupId===tool.moving?moduleBoundsAlignment(assembly,tool.moving,reference.id,alignAxis,alignMode):null,[assembly,tool.moving,reference?.id,selectedGroupId,alignAxis,alignMode])
 const face=moving?.pieces.find(p=>p.id===tool.face)?.id??moving?.pieces[0]?.id??''
 function run(fn:()=>void){try{setError('');fn()}catch(e){setError(String(e))}}
 function orient(direction:'up'|'front'){run(()=>{
  // Reasserting an already aligned explicit goal is selection state only.
  const aligned=faceWorldNormal(assembly,face).angleTo(orientationAxis(direction))<1e-10
  if(aligned||onApply(previewModuleTransform(assembly,alignModuleFace(assembly,tool.moving,face,direction))))onOrientationTarget({groupId:tool.moving,pieceId:face,direction})
 })}
 function step(kind:'translate'|'rotate',value:number){run(()=>onApply(previewModuleTransform(assembly,moduleStep(assembly,tool.moving,kind,axis,value,tool.space,face))))}
 useEffect(()=>setError(''),[operation,tool.moving])
 const before=useMemo(()=>validateAssembly3D(assembly),[assembly])
 const hard=preview?.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection')??[],collisions=(a:ModulePreview['geometry'])=>a.issues.filter(i=>i.code==='intersection'&&i.severity==='error')
 return <section className="module-transform-panel" aria-label="Module Transform / Snap">
   {showSpatialInspection&&selectedGroupId&&<GroupSpatialInspection key={selectedGroupId} assembly={inspectionAssembly} groupId={selectedGroupId} preview={inspectionAssembly!==assembly}/>}
   <fieldset disabled={busy||!!preview||!moving} className="module-operation-fields">
   {(operation==='move'||operation==='rotate')&&<><div className="module-fields">
   {operation==='rotate'&&<label>坐标<select aria-label="模块坐标系" value={tool.space} onChange={e=>setTool({...tool,space:e.target.value as ModuleSpace})}><option value="global">Global</option><option value="local">Local</option><option value="face">Face</option></select></label>}
   <label>{operation==='move'?'数值轴':'轴'}<select aria-label="模块轴" value={axis} onChange={e=>setAxis(e.target.value as typeof axis)}>{['x','y','z'].map(a=><option key={a}>{a}</option>)}</select></label>
   {operation==='move'?<><label>位移<input aria-label="模块位移" type="number" value={distance} onChange={e=>setDistance(e.target.value)}/></label><button disabled={!distance.trim()} onClick={()=>step('translate',Number(distance))}>移动 Group</button></>:<><label>角度 °<input aria-label="模块旋转角度" type="number" value={angle} onChange={e=>setAngle(e.target.value)}/></label><button disabled={!angle.trim()} onClick={()=>step('rotate',Number(angle))}>旋转 Group</button></>}
   </div>{operation==='rotate'&&<div className="button-row">{[-90,-15,15,90].map(deg=><button key={deg} onClick={()=>step('rotate',deg)}>{deg>0?'+':''}{deg}°</button>)}</div>}
   <small>数值为增量；中心为 Group 几何中心。Global 世界轴；Local Group 轴；Face 参考片轴。</small></>}
   {operation==='move'&&<details className="bounds-align-tools"><summary>Bounds Align · 世界轴对齐</summary>
    <p>移动当前 Group；参考 Group 保持不动。仅平移，不建立 Connection。</p>
    <label>Reference Group<select aria-label="Bounds Align Reference Group" value={reference?.id??''} onChange={e=>setReferenceId(e.target.value)}><option value="">选择参考 Group</option>{modules.filter(m=>m.id!==tool.moving).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <div className="module-fields"><label>World Axis<select aria-label="Bounds Align Axis" value={alignAxis} onChange={e=>setAlignAxis(e.target.value as BoundsAxis)}>{(['x','y','z'] as const).map(a=><option key={a} value={a}>{a.toUpperCase()}{a==='y'?' · 竖直':''}</option>)}</select></label>
    <label>Align<select aria-label="Bounds Align Mode" value={alignMode} onChange={e=>setAlignMode(e.target.value as BoundsMode)}>{(['min','center','max'] as const).map(m=><option key={m} value={m}>{m==='min'?'Min · 最小边界':m==='center'?'Center · 中心':'Max · 最大边界'}</option>)}</select></label></div>
    <p>Calculated Delta：<output aria-label="Bounds Align Calculated Delta" data-delta={alignment?.delta}>{alignment?spatialNumber(alignment.delta):'—'}</output>{alignment?.delta===0?' · 已对齐，无需移动':''}</p>
    <button disabled={!alignment||alignment.delta===0} onClick={()=>run(()=>onPreview(previewModuleBoundsAlign(assembly,tool.moving,reference!.id,alignAxis,alignMode)))}>预览对齐</button>
   </details>}
   {operation!=='snap'&&(operation==='orient'||tool.space==='face')&&<label>参考面 Tile<select aria-label="模块参考 Tile" value={face} onChange={e=>setTool({...tool,face:e.target.value})}>{moving?.pieces.map(p=><option key={p.id} value={p.id}>{p.sourceId}</option>)}</select></label>}
   {operation==='orient'&&<><p>在 Viewer 点击成员 Tile 或选择参考面，整体定向当前 Group；Snap 记住本次会话的方向参考。</p><div className="button-row">{(['up','front'] as const).map(d=><button key={d} disabled={!face} onClick={()=>orient(d)}>{d==='up'?'所选面朝上':'所选面朝前'}</button>)}</div></>}
   </fieldset>
   {preview&&<div data-testid={preview.boundsAlignment?'module-align-preview':'module-snap-preview'}><b>{preview.boundsAlignment?'Bounds Align ':''}预览 · Draft 尚未修改 · Geometry {preview.geometry.valid?'Valid':'Invalid'}</b><p>{preview.boundsAlignment&&`${moving?.name} → ${modules.find(m=>m.id===preview.boundsAlignment!.referenceId)?.name} · World ${preview.boundsAlignment.axis.toUpperCase()} ${preview.boundsAlignment.mode} · Δ ${spatialNumber(preview.boundsAlignment.delta)}`}{preview.connection&&`${preview.connection.pieceB}:${preview.connection.portB} → ${preview.connection.pieceA}:${preview.connection.portA} · ${preview.connection.dihedralDeg}° · Flip ${preview.connection.flip}`}<br/>碰撞 {collisions(before).length} → {collisions(preview.geometry).length} · 最大深度 {Math.max(0,...collisions(preview.geometry).map(i=>i.penetrationDepth??0)).toPrecision(4)} · 连接错误 {hard.length}</p><details><summary>Validator Diagnostics</summary><ul>{preview.geometry.issues.map((i,n)=><li key={n} className={i.severity==='error'?'magnetic-3d-blocker':undefined}>{i.code} · {i.message}</li>)}</ul></details><button disabled={busy||!!hard.length} onClick={()=>run(()=>onApply(preview))}>{preview.boundsAlignment?'应用对齐':`确认模块吸附${preview.geometry.valid?'':'（Geometry Invalid）'}`}</button><button disabled={busy} onClick={()=>onPreview(null)}>{preview.boundsAlignment?'取消对齐预览':'取消模块预览'}</button></div>}
  {error&&<p role="alert">{operation==='snap'?'当前参数未生成可用预览：':''}{error}</p>}
 </section>
}

export {CreateCombinedPanel} from './scene-registration/CreateCombinedPanel.tsx'
