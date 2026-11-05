import {Vector3} from 'three'
import type {Assembly3D} from './assembly.ts'
import type {ViewerPiece} from './viewer-model.ts'
import {rotationDegrees} from './viewer-model.ts'
import {moduleBounds} from './module-transform.ts'
import {GroupSpatialInspection} from './GroupSpatialInspection.tsx'
import {PieceColorPalette} from './vendor/components/editor/PropertyPanel.tsx'

type Format=(n:number)=>string
export function TileSelectionDetails({piece,assembly,format,busy,onConnection,onColor}:{piece:ViewerPiece;assembly:Assembly3D;format:Format;busy:boolean;onConnection:(i:number)=>void;onColor?:((color:string)=>void)}){
 const {shape,profile}=piece,x=shape.vertices.map(v=>v.x),y=shape.vertices.map(v=>v.y)
 const size=[Math.max(...x)-Math.min(...x),Math.max(...y)-Math.min(...y),shape.thickness]
 const connections=assembly.connections.map((c,i)=>({c,i})).filter(({c})=>c.pieceA===piece.id||c.pieceB===piece.id)
 return <div className="magnetic-3d-piece-info" data-selected-3d-piece={piece.id}>
  <dl className="assembly-property-grid">
   <div><dt>Profile</dt><dd>{shape.id} · {profile.profile.name}</dd></div>
   <div><dt title="Profile 局部 XYZ 尺寸，已计入 Scale；不随世界朝向改变">Size</dt><dd data-testid="selection-size" title={size.join(' × ')}>{size.map(format).join(' × ')}</dd></div>
   <div><dt>Color</dt><dd>{onColor?<input aria-label="当前 3D 零件颜色" type="color" disabled={busy} value={piece.piece.color??'#55b8ac'} onChange={e=>onColor(e.target.value)}/>:<span className="magnetic-3d-swatch" style={{background:piece.color}}/>}{piece.color}{!piece.piece.color&&'（默认）'}</dd></div>
   <div><dt>Thickness</dt><dd>{format(shape.thickness)}（世界单位）</dd></div>
   <div><dt>Position XYZ</dt><dd data-3d-position={JSON.stringify(piece.piece.pose.position)}>{piece.piece.pose.position.map(format).join(', ')}</dd></div>
   <div><dt>Rotation XYZ（度）</dt><dd>{rotationDegrees(piece.piece.pose.quaternion).map(format).join(', ')}</dd></div>
  </dl>
  <details><summary>保存的 Pose / Profile 规格</summary><dl className="assembly-property-grid">
   <div><dt>Quaternion XYZW</dt><dd data-3d-quaternion={JSON.stringify(piece.piece.pose.quaternion)}>{piece.piece.pose.quaternion.map(format).join(', ')}</dd></div>
   <div><dt>Profile Scale</dt><dd>{profile.scale??1}</dd></div>
   <div className="assembly-property-wide"><dt>边长</dt><dd>{shape.edges.map(e=>format(e.length)).join(' / ')}</dd></div>
  </dl></details>
  <details><summary>Connections · {connections.length}</summary><div className="magnetic-3d-related-connections">{connections.map(({c,i})=><button key={i} disabled={busy} onClick={()=>onConnection(i)}>连接 #{i} · {c.pieceA} ↔ {c.pieceB}</button>)}{!connections.length&&<span>无连接</span>}</div></details>
  {onColor&&<details><summary>颜色预设</summary><PieceColorPalette color={piece.color} onChange={onColor}/></details>}
 </div>
}

export function GroupSelectionDetails({assembly,groupId,format,preview=false}:{assembly:Assembly3D;groupId:string;format:Format;preview?:boolean}){
 const group=assembly.modules!.find(m=>m.id===groupId)!,box=moduleBounds(assembly,groupId),ids=new Set(group.pieces.map(p=>p.id))
 const internal=assembly.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB)).length,external=assembly.connections.filter(c=>ids.has(c.pieceA)!==ids.has(c.pieceB)).length
 return <div className="assembly-group-properties"><dl className="assembly-property-grid">
  <div><dt>Tiles</dt><dd>{group.pieces.length}</dd></div>
  <div><dt>Size · 世界 XYZ</dt><dd data-testid="selection-size">{box.getSize(new Vector3()).toArray().map(format).join(' × ')}</dd></div>
  <div><dt>Center XYZ</dt><dd>{box.getCenter(new Vector3()).toArray().map(format).join(', ')}</dd></div>
  <div><dt>Frame Rotation XYZ（度）</dt><dd>{rotationDegrees(group.frame.quaternion).map(format).join(', ')}</dd></div>
  <div className="assembly-property-wide"><dt>Connections</dt><dd>{internal} 内部 · {external} 外部{preview?' · 预览，尚未应用':''}</dd></div>
 </dl>
 <GroupSpatialInspection assembly={assembly} groupId={groupId} preview={preview} defaultOpen={false}/>
 <details><summary>Group Frame / Members</summary><dl className="assembly-property-grid"><div><dt>Frame Position XYZ</dt><dd>{group.frame.position.map(format).join(', ')}</dd></div><div><dt>Quaternion XYZW</dt><dd>{group.frame.quaternion.map(format).join(', ')}</dd></div></dl><p>{group.pieces.map(p=>p.sourceId).join('、')}</p></details>
 </div>
}
