import {useEffect,useMemo,useRef} from 'react'
import {TransformControls} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {Object3D} from 'three'
import type {Pose3D} from './assembly.ts'
export type ModuleGizmoProps={pose:Pose3D;mode:'translate'|'rotate';onChange:(target:Pose3D,commit:boolean)=>void;onCancel:()=>void}
/** Existing Drei TransformControls, one transaction per module drag. */
export function ModuleGizmo({pose,mode,onChange,onCancel}:ModuleGizmoProps){
 const object=useMemo(()=>new Object3D(),[]),drag=useRef(false),latest=useRef({onChange,onCancel});latest.current={onChange,onCancel}
 const controls=useThree(s=>s.controls) as {enabled:boolean}|null
 useEffect(()=>{if(!drag.current){object.position.fromArray(pose.position);object.quaternion.fromArray(pose.quaternion)}},[pose,object])
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&drag.current){drag.current=false;object.position.fromArray(pose.position);object.quaternion.fromArray(pose.quaternion);if(controls)controls.enabled=true;latest.current.onCancel()}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);if(controls)controls.enabled=true}},[controls,pose,object])
 function report(commit:boolean){latest.current.onChange({position:object.position.toArray(),quaternion:object.quaternion.clone().normalize().toArray()},commit)}
 return <><primitive object={object} visible={false}/><TransformControls object={object} mode={mode} space="local" size={.9} onMouseDown={()=>{drag.current=true;if(controls)controls.enabled=false}} onObjectChange={()=>{if(drag.current)report(false)}} onMouseUp={()=>{if(!drag.current)return;drag.current=false;if(controls)controls.enabled=true;report(true)}}/></>
}
