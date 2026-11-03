import {useEffect,useRef,useState} from 'react'
import type {RefObject} from 'react'
import {useThree,useFrame} from '@react-three/fiber'
import {Line} from '@react-three/drei'
import {Raycaster,Vector2,Vector3} from 'three'
import type {Group} from 'three'
import type {AnnotationPiece} from './AssemblyAnnotations.tsx'
import type {SnapViewport} from './module-snap-selection.ts'
import {pickSnapPort,pickSnapTile,snapPortSegment} from './module-snap-selection.ts'

/** Presentation/picking only, using the editor's existing solids, camera and canonical shapes. */
export function SnapViewportPicker({state,pieces,solids,tooltip}:{state:SnapViewport;pieces:AnnotationPiece[];solids:RefObject<Group|null>;tooltip:RefObject<HTMLOutputElement|null>}){
 const {camera,gl}=useThree(),ray=useRef(new Raycaster()),latest=useRef({state,pieces});latest.current={state,pieces}
 const [hover,setHover]=useState<{tileId:string;portId?:string}|null>(null),down=useRef<{x:number;y:number}|null>(null)
 const [cameraVersion,setCameraVersion]=useState(0),quaternion=useRef(camera.quaternion.clone())
 useFrame(()=>{if(!quaternion.current.equals(camera.quaternion)){quaternion.current.copy(camera.quaternion);setCameraVersion(v=>v+1);setHover(null);if(tooltip.current)tooltip.current.hidden=true}})
 useEffect(()=>{
  if(!state.picker)return
  const canvas=gl.domElement,oldCursor=canvas.style.cursor;canvas.style.cursor='crosshair'
  function clear(){setHover(null);if(tooltip.current)tooltip.current.hidden=true}
  function hit(e:MouseEvent|PointerEvent){
   const {state,pieces}=latest.current,picker=state.picker;if(!picker||!solids.current)return null
   const side=picker.startsWith('fixed')?state.fixed:state.moving,box=canvas.getBoundingClientRect(),point=new Vector2(e.clientX-box.x,e.clientY-box.y)
   ray.current.setFromCamera(new Vector2(point.x/box.width*2-1,1-point.y/box.height*2),camera)
   if(picker.endsWith('tile')){const tileId=pickSnapTile(ray.current,solids.current,side.members);return tileId?{tileId}:null}
   const piece=pieces.find(p=>p.id===side.tileId);if(!piece)return null
   const result=pickSnapPort(piece,camera,{width:box.width,height:box.height},point,solids.current,ray.current)
   const label=tooltip.current
   if(label){label.hidden=!result.portId&&!result.ambiguous;label.textContent=result.portId??'边重叠：请调整视角或用下拉框';label.dataset.portId=result.portId??'';label.style.left=Math.max(4,Math.min(box.width-150,point.x+12))+'px';label.style.top=Math.max(4,Math.min(box.height-30,point.y+12))+'px'}
   return result.portId?{tileId:piece.id,portId:result.portId}:null
  }
  function move(e:PointerEvent){if(down.current){clear();return}e.stopImmediatePropagation();const next=hit(e);setHover(old=>old?.tileId===next?.tileId&&old?.portId===next?.portId?old:next)}
  function click(e:MouseEvent){e.stopImmediatePropagation();const start=down.current;down.current=null;if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)return;const picked=hit(e);if(picked)latest.current.state.onPick(picked.tileId,picked.portId)}
  function start(e:PointerEvent){down.current={x:e.clientX,y:e.clientY};clear()}
  function end(e:PointerEvent){if(e.button!==0)down.current=null}
  function leave(){down.current=null;clear()}
  canvas.addEventListener('pointermove',move,true);canvas.addEventListener('click',click,true);canvas.addEventListener('pointerdown',start,true);canvas.addEventListener('pointerup',end,true);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('pointercancel',leave)
  return()=>{canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('click',click,true);canvas.removeEventListener('pointerdown',start,true);canvas.removeEventListener('pointerup',end,true);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('pointercancel',leave);canvas.style.cursor=oldCursor;down.current=null;clear()}
 },[state.picker,gl,camera,solids,tooltip])
 void cameraVersion // Reproject surface feedback when the camera changes, without changing any edit state.
 const target=state.picker?.startsWith('fixed')?state.fixed:state.moving
 const piece=pieces.find(p=>p.id===target.tileId)
 const lines: {key:string;p0:Vector3;p1:Vector3;color:string;width:number;selected:boolean}[]=[]
 for(const [name,side,color]of [['fixed',state.fixed,'#0e7490'],['moving',state.moving,'#d97706']] as const){const p=pieces.find(p=>p.id===side.tileId),s=p&&snapPortSegment(p,side.portId,camera);if(s)lines.push({key:name,...s,color,width:5,selected:true})}
 if(state.picker?.endsWith('port')&&piece)for(const p of piece.shape.ports){const segment=snapPortSegment(piece,p.portId,camera)!;lines.push({key:'candidate-'+p.portId,...segment,color:hover?.portId===p.portId?'#10b981':'#78908a',width:hover?.portId===p.portId?7:2,selected:false})}
 const hovered=hover?.tileId&&pieces.find(p=>p.id===hover.tileId)
 return <group name="module-snap-feedback">
  {lines.map(s=><Line key={s.key} name={'snap-port-'+s.key} points={[s.p0,s.p1]} color={s.color} lineWidth={s.width} depthTest={!s.selected} renderOrder={s.selected?10:0} raycast={()=>{}}/>)}
  {hovered&&!hover?.portId&&<Line name="snap-tile-hover" points={[...hovered.shape.vertices,hovered.shape.vertices[0]].map(v=>{const n=new Vector3(0,0,1).applyQuaternion(hovered.transform.quaternion),sign=n.dot(camera.getWorldDirection(new Vector3()))<0?1:-1;return new Vector3(v.x,v.y,sign*(hovered.shape.thickness/2+.001)).applyQuaternion(hovered.transform.quaternion).add(hovered.transform.position)})} color="#10b981" lineWidth={5} raycast={()=>{}}/>}
 </group>
}
