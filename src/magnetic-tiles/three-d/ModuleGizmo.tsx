import {useEffect,useMemo,useRef} from 'react'
import {TransformControls} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {Object3D} from 'three'
import {moveGizmoOptions,cancelMoveCameraGesture} from './move-controls.ts'
import type {MoveControlsSettings} from './move-controls.ts'
import type {Pose3D} from './assembly.ts'
export type ModuleGizmoProps={pose:Pose3D;mode:'translate'|'rotate';onChange:(target:Pose3D,commit:boolean)=>void;onCancel:()=>void;moveSettings?:MoveControlsSettings}
/** Existing Drei TransformControls, one transaction per module drag. */
export function ModuleGizmo({pose,mode,onChange,onCancel,moveSettings}:ModuleGizmoProps){
 const object=useMemo(()=>new Object3D(),[]),drag=useRef(false),latest=useRef({onChange,onCancel});latest.current={onChange,onCancel}
 const transform=useRef<any>(null),pointer=useRef<number|undefined>(undefined)
 const canvas=useThree(s=>s.gl.domElement)
 const controls=useThree(s=>s.controls) as {enabled:boolean;domElement?:HTMLElement}|null
 useEffect(()=>{if(!drag.current){object.position.fromArray(pose.position);object.quaternion.fromArray(pose.quaternion)}},[pose,object])
 useEffect(()=>{
  const rememberPointer=(e:PointerEvent)=>{pointer.current=e.pointerId};canvas.addEventListener('pointerdown',rememberPointer,true)
  function cancel(event?:Event){if(!drag.current)return;drag.current=false;if(transform.current)transform.current.dragging=false;object.position.fromArray(pose.position);object.quaternion.fromArray(pose.quaternion);if(mode==='translate'&&event?.type!=='pointercancel')cancelMoveCameraGesture(controls,pointer.current);if(controls)controls.enabled=true;latest.current.onCancel()}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel(e)}
  window.addEventListener('keydown',key);window.addEventListener('pointercancel',cancel);window.addEventListener('lostpointercapture',cancel)
  return()=>{canvas.removeEventListener('pointerdown',rememberPointer,true);window.removeEventListener('keydown',key);window.removeEventListener('pointercancel',cancel);window.removeEventListener('lostpointercapture',cancel);if(controls)controls.enabled=true}
 },[controls,pose,object,canvas,mode])
 function report(commit:boolean){latest.current.onChange({position:object.position.toArray(),quaternion:object.quaternion.clone().normalize().toArray()},commit)}
 return <><primitive object={object} visible={false}/><TransformControls ref={transform} {...(mode==='translate'&&moveSettings?moveGizmoOptions(moveSettings):{translationSnap:null,showX:true,showY:true,showZ:true})} object={object} mode={mode} space="local" size={.9} onMouseDown={()=>{drag.current=true;if(controls)controls.enabled=false}} onObjectChange={()=>{if(drag.current)report(false)}} onMouseUp={()=>{if(!drag.current)return;drag.current=false;if(controls)controls.enabled=true;const position=object.position.toArray(),quaternion=object.quaternion.toArray();const samePosition=position.every((v,i)=>Math.abs(v-pose.position[i])<1e-12),sameRotation=Math.abs(quaternion.reduce((dot,v,i)=>dot+v*pose.quaternion[i],0))>1-1e-12;if(samePosition&&sameRotation)latest.current.onCancel();else report(true)}}/></>
}
