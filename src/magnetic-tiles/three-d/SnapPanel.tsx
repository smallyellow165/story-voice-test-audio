import {useEffect,useMemo,useState} from 'react'
import type {Assembly3D} from './assembly.ts'
import {createViewerModel} from './viewer-model.ts'
import {parentModule} from './combined-editing.ts'
import {snapObject} from './snap-session.ts'
import type {SnapObject,SnapObjects,SnapRequest,SnapSessionPreview} from './snap-session.ts'
import type {SnapPicker} from './module-snap-selection.ts'
import {SnapSelector} from './SnapSelector.tsx'
import {TileSnapPreview} from './TileSnapPreview.tsx'
import {ModuleSnapDiagnostics} from './ModuleSnapDiagnostics.tsx'
import type {SnapOrientationTarget} from './module-snap-diagnostics.ts'
import {validateAssembly3D} from './engine-adapter.ts'

export function SnapPanel({assembly,request,onObjects,onSettings,onMode,pickGrain,picker,togglePicker,preview,onPreview,onConfirm,onCancel,onConstraint,interaction,onInteraction,busy,orientationTarget}:{
 assembly:Assembly3D;request:SnapRequest;onObjects:(o:SnapObjects)=>void
 onSettings:(s:{dihedralDeg:number;flip:boolean})=>void;onMode:(m:SnapRequest['mode'])=>void
 pickGrain:SnapObject['kind'];picker:SnapPicker|null;togglePicker:(p:SnapPicker)=>void
 preview:SnapSessionPreview|null;onPreview:()=>void;onConfirm:()=>void;onCancel:()=>void;onConstraint:()=>void
 interaction:'drag'|'click';onInteraction:(v:'drag'|'click')=>void;busy:boolean;orientationTarget?:SnapOrientationTarget
}){
 const models=useMemo(()=>createViewerModel(assembly),[assembly]),before=useMemo(()=>validateAssembly3D(assembly),[assembly])
 const [angle,setAngle]=useState(String(request.dihedralDeg))
 useEffect(()=>setAngle(Number.isFinite(request.dihedralDeg)?String(request.dihedralDeg):''),[request.dihedralDeg])
 const groupMoving=request.moving.kind==='group',movingGroup=assembly.modules?.find(m=>m.id===request.moving.groupId)
 const movingIds=groupMoving?movingGroup?.pieces.map(p=>p.id)??[]:[request.moving.tileId]
 const fixedGroup=parentModule(assembly,request.fixed.tileId)
 const ports=(id:string)=>models.find(p=>p.id===id)?.shape.ports??[]
 const illegalMoving=!groupMoving&&!!parentModule(assembly,request.moving.tileId)
 const fieldsDisabled=busy
 function update(side:'moving'|'fixed',end:SnapObject){onObjects({moving:request.moving,fixed:request.fixed,[side]:end})}
 function endpoint(side:'moving'|'fixed'){
  const end=request[side],moving=side==='moving',group=assembly.modules?.find(m=>m.id===end.groupId)
  const choices=end.kind==='group'?assembly.pieces.filter(p=>group?.pieces.some(m=>m.id===p.id)):assembly.pieces
  const tileLabel=moving?(groupMoving?'模块参考 Tile':'3D 移动零件 B'):(groupMoving?'模块 Snap 固定 Tile':'3D 目标零件 A')
  const portLabel=moving?(groupMoving?'模块 Snap 移动 Port':'3D 自身端口 B'):(groupMoving?'模块 Snap 固定 Port':'3D 目标端口 A')
  return <>
   <div className={'snap-side-heading '+(moving?'snap-moving':'snap-fixed')}>
    <b>{moving?'Moving':'Fixed'}</b>
    <select className="snap-object-kind" aria-label={`Snap ${moving?'Moving':'Fixed'} 类型`} value={end.kind} disabled={fieldsDisabled} onChange={e=>update(side,{...end,kind:e.target.value as SnapObject['kind']})}><option value="tile">Tile</option>{!!assembly.modules?.length&&<option value="group">Group</option>}</select>
    {end.kind==='group'&&<select className="snap-object-group" aria-label={moving?'Snap Moving Group':'固定 Group'} value={end.groupId} disabled={fieldsDisabled} onChange={e=>{const g=assembly.modules!.find(m=>m.id===e.target.value);if(!g){update(side,{...end,groupId:'',tileId:'',portId:''});return}update(side,snapObject(assembly,'group',g.pieces.find(p=>p.id===end.tileId)?.id??g.pieces[0].id,end.portId,g.id))}}><option value="">选择 Group</option>{assembly.modules?.filter(g=>moving||!groupMoving||g.id!==request.moving.groupId).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
   </div>
   <div className="snap-fields-row">
    <label>{moving?'Moving Tile':'Fixed Tile'}<div className="snap-select-field"><select aria-label={tileLabel} value={end.tileId} disabled={fieldsDisabled} onChange={e=>update(side,snapObject(assembly,end.kind,e.target.value,end.portId,end.groupId))}><option value="">选择 Tile</option>{choices.filter(p=>moving||!movingIds.includes(p.id)).map(p=><option key={p.id} value={p.id}>{end.kind==='group'?group?.pieces.find(m=>m.id===p.id)?.sourceId??p.id:parentModule(assembly,p.id)?`${parentModule(assembly,p.id)!.name} / ${parentModule(assembly,p.id)!.pieces.find(m=>m.id===p.id)!.sourceId}`:p.id}</option>)}</select><SnapSelector kind={moving?'moving-tile':'fixed-tile'} active={picker} toggle={togglePicker} disabled={fieldsDisabled||!!preview}/></div></label>
    <label>{moving?'Moving Port':'Fixed Port'}<div className="snap-select-field"><select aria-label={portLabel} value={end.portId} disabled={fieldsDisabled} onChange={e=>update(side,{...end,portId:e.target.value})}><option value="">选择 Port</option>{ports(end.tileId).map(p=><option key={p.portId} value={p.portId}>{p.portId}</option>)}</select><SnapSelector kind={moving?'moving-port':'fixed-port'} active={picker} toggle={togglePicker} disabled={fieldsDisabled||!!preview||!end.tileId}/></div></label>
   </div>
  </>
 }
 return <section className="module-transform-panel" aria-label="Module Transform / Snap">
  <div className="module-snap-parameters" aria-label={groupMoving?'Module Snap 参数':'Tile Snap 参数'}>
   <div className="magnetic-3d-snap-controls"><label>验证模式<select aria-label="Tile Snap 验证模式" value={request.mode} disabled={busy} onChange={e=>onMode(e.target.value as SnapRequest['mode'])}><option value="strict">Strict</option><option value="less-strict">Less Strict</option></select></label>{!groupMoving&&<label>吸附方式<select aria-label="3D 吸附方式" value={interaction} disabled={busy} onChange={e=>onInteraction(e.target.value as 'drag'|'click')}><option value="drag">拖动吸附</option><option value="click">点击吸附</option></select></label>}</div>
   {endpoint('moving')}{endpoint('fixed')}
   <div className="snap-options"><label>Dihedral °<input aria-label={groupMoving?'模块 Snap 二面角':'新连接二面角'} type="number" min="-180" max="180" value={angle} disabled={busy} onChange={e=>{setAngle(e.target.value);onSettings({dihedralDeg:e.target.value.trim()?Number(e.target.value):NaN,flip:request.flip})}}/></label><label><input aria-label={groupMoving?'模块 Snap Flip':'新连接 flip'} type="checkbox" checked={request.flip} disabled={busy} onChange={e=>onSettings({dihedralDeg:request.dihedralDeg,flip:e.target.checked})}/>Flip</label><button disabled={busy||!!preview||!!picker||illegalMoving||!request.moving.portId||!request.fixed.portId||!Number.isFinite(request.dihedralDeg)} onClick={onPreview}>{groupMoving?'预览模块吸附':'预览吸附'}</button></div>
   <p className="hint" data-testid="snap-moving-scope">{groupMoving?`整体移动 ${movingGroup?.name??'未选 Group'} · ${movingGroup?.pieces.length??0} Tiles`:`只移动 Tile ${request.moving.tileId||'未选择'}`}；Fixed 不动。</p>
   {illegalMoving&&<p className="magnetic-3d-blocker" role="alert">固定 Parent 成员不能单片移动；请选择 Moving Group 或独立 Free Tile。</p>}
   {picker&&<small className="snap-picker-hint">Viewer：{picker.replace('-',' ')} · 当前选择粒度 {pickGrain==='group'?'Group':'Tile'} · Esc 取消</small>}
   {!groupMoving&&<button disabled={busy||!!preview||!!picker||illegalMoving||!request.moving.portId||!request.fixed.portId||!Number.isFinite(request.dihedralDeg)} onClick={onConstraint}>仅建立约束（不移动）</button>}
  </div>
  {preview&&<TileSnapPreview preview={preview} onConfirm={onConfirm} onCancel={onCancel} testId={groupMoving?'module-snap-preview':undefined} description={groupMoving?`整体移动 ${movingGroup?.name}；Fixed 及其他对象保持不动。`:undefined} confirmLabel={groupMoving?`确认模块吸附${preview.geometry.valid?'':'（Geometry Invalid）'}`:undefined} cancelLabel={groupMoving?'取消模块预览':undefined}>
   {groupMoving&&<p>碰撞 {preview.geometry.issues.filter(i=>i.code==='intersection').length} · 连接错误 {preview.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection').length}</p>}
   {groupMoving&&fixedGroup&&<ModuleSnapDiagnostics assembly={assembly} preview={preview} movingId={request.moving.groupId} fixedId={fixedGroup.id} target={orientationTarget} beforeReport={before}/>}
  </TileSnapPreview>}
 </section>
}
