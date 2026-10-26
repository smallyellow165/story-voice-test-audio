import * as THREE from 'three'
import {TransformControls} from 'three/addons/controls/TransformControls.js'
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {MM_PER_LDU} from './catalog'
export type DebugPose={x:number;y:number;z:number;rotation:number}
export type DebugInstance=DebugPose&{id:string;part:string}
export type DebugScene={instances:DebugInstance[];selected:string|null;mode:'none'|'translate'|'rotate'}
// Opt-in mouse/keyboard adapter. Owns no renderer, geometry loader or validator.
export class ProfileInteraction{
 private transform:TransformControls
 private selected:THREE.Object3D|null=null
 private mode:DebugScene['mode']='none'
 private outline=new THREE.BoxHelper(new THREE.Object3D(),0x00a6e8)
 private down:{x:number;y:number;id:number;gizmo:boolean}|null=null
 private drag:{plane:THREE.Plane;start:THREE.Vector3;position:THREE.Vector3;id:number}|null=null
 private canvas:HTMLCanvasElement;private camera:THREE.Camera;private orbit:OrbitControls;private assembly:THREE.Group;private scene:THREE.Scene;private changed:(state:DebugScene)=>void
 constructor(canvas:HTMLCanvasElement,camera:THREE.Camera,orbit:OrbitControls,assembly:THREE.Group,scene:THREE.Scene,changed:(state:DebugScene)=>void){
  this.canvas=canvas;this.camera=camera;this.orbit=orbit;this.assembly=assembly;this.scene=scene;this.changed=changed
  this.transform=new TransformControls(camera,canvas);this.transform.setSpace('world');this.transform.setSize(.8)
  scene.add(this.transform.getHelper(),this.outline);this.outline.visible=false;this.outline.material.depthTest=false;this.outline.renderOrder=30
  this.transform.addEventListener('dragging-changed',this.controlDrag)
  this.transform.addEventListener('objectChange',this.emit)
  canvas.tabIndex=0
  canvas.addEventListener('pointerdown',this.pointerDown,true);canvas.addEventListener('pointermove',this.pointerMove,true);canvas.addEventListener('pointerup',this.pointerUp,true);canvas.addEventListener('pointercancel',this.cancel,true)
  canvas.addEventListener('keydown',this.keyDown);canvas.addEventListener('keyup',this.keyUp);canvas.addEventListener('blur',this.cancel)
 }
 private ray(event:PointerEvent){const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();this.camera.updateMatrixWorld();this.assembly.updateMatrixWorld(true);ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);return ray}
 private hit(event:PointerEvent){const hit=this.ray(event).intersectObjects(this.assembly.children,true).find(h=>(h.object as THREE.Mesh).isMesh);if(!hit)return null;let object=hit.object;while(object.parent!==this.assembly&&object.parent)object=object.parent;return object.parent===this.assembly?object:null}
 private pointerDown=(event:PointerEvent)=>{
  this.canvas.focus({preventScroll:true});if(event.button!==0)return
  this.down={x:event.clientX,y:event.clientY,id:event.pointerId,gizmo:!!(this.transform.axis&&this.mode!=='none')}
  if(event.shiftKey){const object=this.hit(event);if(!object)return
   event.preventDefault();event.stopImmediatePropagation();this.select(object.name);this.setMode('none')
   const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-object.position.y),point=this.ray(event).ray.intersectPlane(plane,new THREE.Vector3())
   if(!point)return
   this.drag={plane,start:point,position:object.position.clone(),id:event.pointerId};this.orbit.enabled=false;this.canvas.setPointerCapture(event.pointerId)
  }else if(this.down.gizmo)this.orbit.enabled=false
 }
 private pointerMove=(event:PointerEvent)=>{
  if(!this.drag||!this.selected)return
  event.preventDefault();event.stopImmediatePropagation();const point=this.ray(event).ray.intersectPlane(this.drag.plane,new THREE.Vector3());if(!point)return
  this.selected.position.copy(this.drag.position).add(point.sub(this.drag.start));this.emit()
 }
 private pointerUp=(event:PointerEvent)=>{
  const down=this.down;this.down=null
  if(this.drag){event.stopImmediatePropagation();this.endDrag();return}
  if(down&&!down.gizmo&&event.button===0&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<5)this.select(this.hit(event)?.name??null)
  // TransformControls handles pointerup before the queued restoration.
  queueMicrotask(()=>{this.orbit.enabled=true})
 }
 private endDrag(){if(this.drag&&this.canvas.hasPointerCapture(this.drag.id))this.canvas.releasePointerCapture(this.drag.id);this.drag=null;this.orbit.enabled=true}
 private cancel=()=>{this.endDrag();if(this.transform.dragging)this.transform.pointerUp(null);this.down=null}
 private controlDrag=(event:{value:unknown})=>{this.orbit.enabled=!event.value}
 private keyUp=(event:KeyboardEvent)=>{if(event.key==='Shift')this.endDrag()}
 private keyDown=(event:KeyboardEvent)=>{
  if(event.target!==this.canvas||event.ctrlKey||event.metaKey||event.altKey)return
  const key=event.key.toLowerCase();if(!['g','r','escape'].includes(key))return
  event.preventDefault();event.stopPropagation()
  if(key==='escape'){this.cancel();this.select(null)}else if(this.selected)this.setMode(key==='g'?'translate':'rotate')
 }
 select(id:string|null){this.selected=this.assembly.children.find(o=>o.name===id)??null;this.setMode('none');this.emit()}
 setMode(mode:DebugScene['mode']){this.mode=this.selected?mode:'none';this.transform.detach();if(this.selected&&this.mode!=='none'){this.transform.setMode(this.mode);this.transform.showX=this.mode==='translate';this.transform.showY=true;this.transform.showZ=this.mode==='translate';this.transform.attach(this.selected)}this.emit()}
 pose(id:string,pose:DebugPose){if(!(['x','y','z','rotation'] as const).every(k=>Number.isFinite(pose[k])))throw Error('位置和角度必须是有限数值');const object=this.assembly.children.find(o=>o.name===id);if(!object)return;object.position.set(pose.x*MM_PER_LDU,pose.y*MM_PER_LDU,pose.z*MM_PER_LDU);object.rotation.set(0,THREE.MathUtils.degToRad(pose.rotation),0);object.updateMatrixWorld(true);this.emit()}
 snapshot():DebugScene{return {selected:this.selected?.name??null,mode:this.mode,instances:this.assembly.children.map(o=>({id:o.name,part:o.userData.part,x:o.position.x/MM_PER_LDU,y:o.position.y/MM_PER_LDU,z:o.position.z/MM_PER_LDU,rotation:THREE.MathUtils.radToDeg(Math.atan2(2*(o.quaternion.w*o.quaternion.y+o.quaternion.x*o.quaternion.z),1-2*(o.quaternion.y**2+o.quaternion.z**2)))}))}}
 update(){if(this.selected){this.outline.setFromObject(this.selected);this.outline.visible=true}else this.outline.visible=false}
 private emit=()=>{this.update();this.changed(this.snapshot())}
 dispose(){this.cancel();this.transform.removeEventListener('dragging-changed',this.controlDrag);this.transform.removeEventListener('objectChange',this.emit);this.transform.detach();this.scene.remove(this.transform.getHelper(),this.outline);this.transform.dispose();this.outline.geometry.dispose();this.outline.material.dispose();for(const [name,listener] of [['pointerdown',this.pointerDown],['pointermove',this.pointerMove],['pointerup',this.pointerUp],['pointercancel',this.cancel]] as const)this.canvas.removeEventListener(name,listener,true);this.canvas.removeEventListener('keydown',this.keyDown);this.canvas.removeEventListener('keyup',this.keyUp);this.canvas.removeEventListener('blur',this.cancel);this.canvas.removeAttribute('tabindex')}
}
