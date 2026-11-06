import {useEffect,useState} from 'react'
import {validMoveSpacing} from './move-controls.ts'
import type {MoveConstraint,MoveControlsSettings} from './move-controls.ts'
import type {ModuleSpace} from './module-transform.ts'
export function MoveControlsPanel({settings,onChange,space,onSpace,group,position,busy}:{settings:MoveControlsSettings;onChange:(s:MoveControlsSettings)=>void;space:ModuleSpace;onSpace:(s:ModuleSpace)=>void;group:boolean;position?:readonly number[];busy:boolean}){
 const [spacing,setSpacing]=useState(String(settings.spacing))
 useEffect(()=>setSpacing(String(settings.spacing)),[settings.spacing])
 const valid=spacing.trim()&&validMoveSpacing(Number(spacing))
 return <section className="magnetic-move-controls" aria-label="Move 拖拽与网格">
  <fieldset disabled={busy}>
   <div className="module-fields">
    <label>坐标<select aria-label={group?'模块坐标系':'Move 坐标系'} value={space} onChange={e=>onSpace(e.target.value as ModuleSpace)}><option value="global">Global · 世界</option><option value="local">Local · 局部</option>{group&&<option value="face">Face · 参考片</option>}</select></label>
    <label>拖拽约束<select aria-label="Move 拖拽约束" value={settings.constraint} onChange={e=>onChange({...settings,constraint:e.target.value as MoveConstraint})}>{(['XYZ','X','Y','Z','XY','XZ','YZ'] as const).map(a=><option key={a} value={a}>{a==='XYZ'?'全部轴 / 平面':a}</option>)}</select></label>
    <label className="move-grid-toggle"><input type="checkbox" aria-label="Move Grid Snap" checked={settings.grid} onChange={e=>onChange({...settings,grid:e.target.checked})}/>Grid Snap</label>
    <label>网格间距<input type="number" aria-label="Move 网格间距" min="0" step="any" list="move-grid-spacing" value={spacing} onChange={e=>{setSpacing(e.target.value);const n=Number(e.target.value);if(e.target.value.trim()&&validMoveSpacing(n))onChange({...settings,spacing:n})}} onBlur={()=>{if(!valid)setSpacing(String(settings.spacing))}}/><datalist id="move-grid-spacing">{[.1,.25,.5,1].map(n=><option key={n} value={n}/>)}</datalist></label>
   </div>
  </fieldset>
  {!valid&&<small role="alert">网格间距须为大于 0 的有限数；仍使用 {settings.spacing}。</small>}
  <output aria-label="Move 世界位置" data-position={position?.join(',')}>{group?'Group 中心':'Tile 中心'} XYZ：{position?position.map(n=>Number(n.toFixed(6))).join(', '):'请选择对象'}</output>
  <p className="hint">拖动箭头 / 方块移动；松手确认，Esc 取消，Undo 撤销。空白处左拖旋转视角，右拖平移，滚轮缩放。{settings.grid&&<>{space==='global'?'世界原点网格；仅吸附所拖动的轴。':'网格以世界原点在当前坐标系的投影为参考，保持局部轴约束。'}{group?'吸附 Group 几何中心。':''}</>}</p>
 </section>
}
