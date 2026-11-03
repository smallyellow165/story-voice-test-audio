import type {ModuleSnapSelection,SnapPicker} from './module-snap-selection.ts'
import {useEffect,useMemo,useState} from 'react'
import type {Assembly3D} from './assembly.ts'
import type {SavedAssemblySummary} from './assembly-library.ts'
import {createViewerModel} from './viewer-model.ts'
import {moduleStep,alignModuleFace,previewModuleSnap,previewModuleTransform,moduleBoundsAlignment,previewModuleBoundsAlign} from './module-transform.ts'
import type {ModulePreview,ModuleSpace,BoundsAxis,BoundsMode} from './module-transform.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import type {Connection} from './vendor/engine/types.ts'
import {GroupSpatialInspection,spatialNumber} from './GroupSpatialInspection.tsx'
export type AssemblyOperation='move'|'rotate'|'orient'|'snap'
export type ModuleTool={moving:string;fixed:string;space:ModuleSpace;face:string;mode:'translate'|'rotate'}
export function ModuleTransformPanel({assembly,inspectionAssembly=assembly,selectedGroupId,snapSelection,setSnapSelection,picker,togglePicker,tool,setTool,busy,preview,onPreview,onApply,operation}:{assembly:Assembly3D;inspectionAssembly?:Assembly3D;selectedGroupId?:string;snapSelection:ModuleSnapSelection;setSnapSelection:(s:ModuleSnapSelection)=>void;picker:SnapPicker|null;togglePicker:(p:SnapPicker)=>void;tool:ModuleTool;setTool:(v:ModuleTool)=>void;busy:boolean;preview:ModulePreview|null;onPreview:(p:ModulePreview|null)=>void;onApply:(p:ModulePreview)=>void;operation:AssemblyOperation}){
 const [error,setError]=useState(''),[axis,setAxis]=useState<'x'|'y'|'z'>('x'),[distance,setDistance]=useState('1'),[angle,setAngle]=useState('90'),[dihedral,setDihedral]=useState('0'),[flip,setFlip]=useState(true)
 const [referenceId,setReferenceId]=useState(''),[alignAxis,setAlignAxis]=useState<BoundsAxis>('y'),[alignMode,setAlignMode]=useState<BoundsMode>('min')
 const modules=assembly.modules??[],moving=modules.find(m=>m.id===tool.moving),fixed=modules.find(m=>m.id===tool.fixed),models=useMemo(()=>createViewerModel(assembly),[assembly])
 useEffect(()=>{if(!assembly.modules)return;const f=assembly.modules[0],m=assembly.modules[1],c=[...assembly.connections].reverse().find(c=>f.pieces.some(p=>p.id===c.pieceA)&&m.pieces.some(p=>p.id===c.pieceB));if(c){setDihedral(String(c.dihedralDeg));setFlip(c.flip??false)}},[assembly.id])
 const reference=modules.find(m=>m.id===referenceId&&m.id!==tool.moving)
 const alignment=useMemo(()=>reference&&selectedGroupId===tool.moving?moduleBoundsAlignment(assembly,tool.moving,reference.id,alignAxis,alignMode):null,[assembly,tool.moving,reference?.id,selectedGroupId,alignAxis,alignMode])
 const face=moving?.pieces.find(p=>p.id===tool.face)?.id??moving?.pieces[0]?.id??'',target=fixed?.pieces.find(p=>p.id===snapSelection.fixedTile)?.id??fixed?.pieces[0]?.id??''
 function run(fn:()=>void){try{setError('');fn()}catch(e){setError(String(e))}}
 function step(kind:'translate'|'rotate',value:number){run(()=>onApply(previewModuleTransform(assembly,moduleStep(assembly,tool.moving,kind,axis,value,tool.space,face))))}
 useEffect(()=>setError(''),[operation,tool.moving])
 const before=useMemo(()=>validateAssembly3D(assembly),[assembly])
 const ports=(id:string)=>models.find(p=>p.id===id)?.shape.ports??[]
 const effectivePortA=ports(target).find(p=>p.portId===snapSelection.fixedPort),effectivePortB=ports(face).find(p=>p.portId===snapSelection.movingPort)
 const hard=preview?.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection')??[],collisions=(a:ModulePreview['geometry'])=>a.issues.filter(i=>i.code==='intersection'&&i.severity==='error')
 return <section className="module-transform-panel" aria-label="Module Transform / Snap">
   {selectedGroupId&&<GroupSpatialInspection key={selectedGroupId} assembly={inspectionAssembly} groupId={selectedGroupId} preview={inspectionAssembly!==assembly}/>}
   <fieldset disabled={busy||!!preview||!moving} className="module-operation-fields">
   {(operation==='move'||operation==='rotate')&&<><div className="module-fields">
   <label>坐标<select aria-label="模块坐标系" value={tool.space} onChange={e=>setTool({...tool,space:e.target.value as ModuleSpace})}><option value="global">Global</option><option value="local">Local</option><option value="face">Face</option></select></label>
   <label>轴<select aria-label="模块轴" value={axis} onChange={e=>setAxis(e.target.value as typeof axis)}>{['x','y','z'].map(a=><option key={a}>{a}</option>)}</select></label>
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
   {operation==='orient'&&<><p>在 Viewer 点击成员 Tile 或选择参考面，整体定向当前 Group。</p><div className="button-row">{(['up','front'] as const).map(d=><button key={d} disabled={!face} onClick={()=>run(()=>onApply(previewModuleTransform(assembly,alignModuleFace(assembly,tool.moving,face,d))))}>{d==='up'?'所选面朝上':'所选面朝前'}</button>)}</div></>}
   {operation==='snap'&&<div className="module-snap-parameters" aria-label="Module Snap 参数">
    <div className="snap-side-heading snap-moving"><b>Moving</b><small>整组移动</small></div>
    <div className="snap-fields-row">
     <label>Moving Tile<div className="snap-select-field"><select aria-label="模块参考 Tile" title={moving?.pieces.find(p=>p.id===face)?.sourceId} value={face} onChange={e=>{const id=e.target.value;setTool({...tool,face:id});setSnapSelection({...snapSelection,movingPort:ports(id).some(p=>p.portId===snapSelection.movingPort)?snapSelection.movingPort:''})}}>{moving?.pieces.map(p=><option key={p.id} value={p.id}>{p.sourceId}</option>)}</select><SnapSelector kind="moving-tile" active={picker} toggle={togglePicker} disabled={!face}/></div></label>
     <label>Moving Port<div className="snap-select-field"><select aria-label="模块 Snap 移动 Port" value={effectivePortB?.portId??''} onChange={e=>setSnapSelection({...snapSelection,movingPort:e.target.value})}><option value="">选择 Port</option>{ports(face).map(p=><option key={p.portId} value={p.portId}>{p.portId}</option>)}</select><SnapSelector kind="moving-port" active={picker} toggle={togglePicker} disabled={!face}/></div></label>
    </div>
    <div className="snap-side-heading snap-fixed"><b>Fixed</b><label>Group<select aria-label="固定 Group" title={fixed?.name} value={tool.fixed} onChange={e=>setTool({...tool,fixed:e.target.value})}>{modules.filter(m=>m.id!==tool.moving).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><small>不动</small></div>
    <div className="snap-fields-row">
     <label>Fixed Tile<div className="snap-select-field"><select aria-label="模块 Snap 固定 Tile" title={fixed?.pieces.find(p=>p.id===target)?.sourceId} value={target} onChange={e=>{const id=e.target.value;setSnapSelection({...snapSelection,fixedTile:id,fixedPort:ports(id).some(p=>p.portId===snapSelection.fixedPort)?snapSelection.fixedPort:''})}}>{fixed?.pieces.map(p=><option key={p.id} value={p.id}>{p.sourceId}</option>)}</select><SnapSelector kind="fixed-tile" active={picker} toggle={togglePicker} disabled={!target}/></div></label>
     <label>Fixed Port<div className="snap-select-field"><select aria-label="模块 Snap 固定 Port" value={effectivePortA?.portId??''} onChange={e=>setSnapSelection({...snapSelection,fixedPort:e.target.value})}><option value="">选择 Port</option>{ports(target).map(p=><option key={p.portId} value={p.portId}>{p.portId}</option>)}</select><SnapSelector kind="fixed-port" active={picker} toggle={togglePicker} disabled={!target}/></div></label>
    </div>
    <div className="snap-options"><label>Dihedral °<input aria-label="模块 Snap 二面角" type="number" min="-180" max="180" value={dihedral} onChange={e=>setDihedral(e.target.value)}/></label><label><input type="checkbox" aria-label="模块 Snap Flip" checked={flip} onChange={e=>setFlip(e.target.checked)}/>Flip</label><button disabled={!face||!target||!effectivePortA||!effectivePortB||tool.moving===tool.fixed||!dihedral.trim()} onClick={()=>run(()=>onPreview(previewModuleSnap(assembly,tool.moving,tool.fixed,{pieceA:target,portA:effectivePortA!.portId,pieceB:face,portB:effectivePortB!.portId,dihedralDeg:Number(dihedral),flip} as Connection)))}>预览模块吸附</button></div>
    {picker&&<small className="snap-picker-hint">Viewer：{picker.replace('-',' ')} · Esc 取消</small>}
   </div>}
   </fieldset>
   {preview&&<div data-testid={preview.boundsAlignment?'module-align-preview':'module-snap-preview'}><b>{preview.boundsAlignment?'Bounds Align ':''}预览 · Draft 尚未修改 · Geometry {preview.geometry.valid?'Valid':'Invalid'}</b><p>{preview.boundsAlignment&&`${moving?.name} → ${modules.find(m=>m.id===preview.boundsAlignment!.referenceId)?.name} · World ${preview.boundsAlignment.axis.toUpperCase()} ${preview.boundsAlignment.mode} · Δ ${spatialNumber(preview.boundsAlignment.delta)}`}{preview.connection&&`${preview.connection.pieceB}:${preview.connection.portB} → ${preview.connection.pieceA}:${preview.connection.portA} · ${preview.connection.dihedralDeg}° · Flip ${preview.connection.flip}`}<br/>碰撞 {collisions(before).length} → {collisions(preview.geometry).length} · 最大深度 {Math.max(0,...collisions(preview.geometry).map(i=>i.penetrationDepth??0)).toPrecision(4)} · 连接错误 {hard.length}</p><details><summary>Validator Diagnostics</summary><ul>{preview.geometry.issues.map((i,n)=><li key={n} className={i.severity==='error'?'magnetic-3d-blocker':undefined}>{i.code} · {i.message}</li>)}</ul></details><button disabled={busy||!!hard.length} onClick={()=>run(()=>onApply(preview))}>{preview.boundsAlignment?'应用对齐':`确认模块吸附${preview.geometry.valid?'':'（Geometry Invalid）'}`}</button><button disabled={busy} onClick={()=>onPreview(null)}>{preview.boundsAlignment?'取消对齐预览':'取消模块预览'}</button></div>}
  {error&&<p role="alert">{error}</p>}
 </section>
}

/** Creation belongs to the Assembly list, independent of existing Group editing. */
export function CreateCombinedPanel({saved,visible,currentId,busy,onCreate}:{saved:SavedAssemblySummary[];visible:Record<string,boolean>;currentId:string;busy:boolean;onCreate:(name:string,ids:string[])=>Promise<void>}){
 const [error,setError]=useState(''),[name,setName]=useState('Combined Assembly'),[parents,setParents]=useState(()=>saved.filter(a=>a.id===currentId||visible[a.id]).slice(0,2).map(a=>a.id))
 return <section className="module-transform-panel" aria-label="创建 Combined Assembly"><p>选择来源作品，创建独立 Combined Assembly。编辑其中的 Group 不会修改来源作品。</p><div className="module-fields"><label>组合名称<input aria-label="组合名称" value={name} onChange={e=>setName(e.target.value)}/></label>{[0,1].map((n)=><label key={n}>来源作品 {n+1}<select aria-label={n?'组合移动作品':'组合固定作品'} value={parents[n]??''} onChange={e=>setParents(ids=>[n===0?e.target.value:ids[0],n===1?e.target.value:ids[1]])}><option value="">选择保存作品</option>{saved.map(a=><option key={a.id} value={a.id}>{a.name} · {a.tiles} Tiles</option>)}</select></label>)}</div><button disabled={busy||!name.trim()||parents.length!==2||!parents[0]||!parents[1]||parents[0]===parents[1]} onClick={()=>{setError('');void onCreate(name,parents).catch(e=>setError(String(e)))}}>创建 Combined Assembly</button>{error&&<p role="alert">{error}</p>}</section>
}

function SnapSelector({kind,active,toggle,disabled}:{kind:SnapPicker;active:SnapPicker|null;toggle:(kind:SnapPicker)=>void;disabled:boolean}){
 const name=kind.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ')
 return <button type="button" className="snap-selector" aria-label={'从 Viewer 选择 '+name} title={'在 Viewer 拾取 '+name+'；再次点击或 Esc 取消'} aria-pressed={active===kind} disabled={disabled} onClick={()=>toggle(kind)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><path d="m9 8 1 10 3-3 3 5 2-1-3-5 4-1Z"/></svg></button>
}
