import {useMemo} from 'react'
import {Vector3} from 'three'
import type {Assembly3D} from './assembly.ts'
import {moduleBounds} from './module-transform.ts'

/** Four decimals for normal Profile units; retain small non-zero displacements. */
export function spatialNumber(value:number){
 if(Math.abs(value)<=1e-10)return '0'
 if(Math.abs(value)<.0001||Math.abs(value)>=1e7)return value.toExponential(3)
 return String(Number(value.toFixed(4)))
}

export function GroupSpatialInspection({assembly,groupId,preview=false}:{assembly:Assembly3D;groupId:string;preview?:boolean}){
 const box=useMemo(()=>moduleBounds(assembly,groupId),[assembly,groupId])
 const center=box.getCenter(new Vector3()),size=box.getSize(new Vector3())
 return <details open className="group-spatial-inspection">
  <summary>Spatial Inspection · 世界坐标</summary>
  <small>+Y 竖直向上 · 单位同 Move · Center 为实体包围盒中心{preview?' · 预览位置，尚未应用':''}</small>
  <table aria-label="Group World Bounds" data-group-id={groupId} data-preview={preview}>
   <thead><tr><th>Axis</th><th>Min</th><th>Center</th><th>Max</th><th>Size</th></tr></thead>
   <tbody>{(['x','y','z'] as const).map(axis=><tr key={axis} data-bounds-axis={axis}>
    <th scope="row">{axis.toUpperCase()}{axis==='y'?' ↑':''}</th>
    {([['min',box.min[axis]],['center',center[axis]],['max',box.max[axis]],['size',size[axis]]] as const).map(([key,value])=><td key={key} data-bound={key} data-value={value} title={String(value)}>{spatialNumber(value)}</td>)}
   </tr>)}</tbody>
  </table>
 </details>
}
