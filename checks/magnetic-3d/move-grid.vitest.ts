import {describe,it,expect} from 'vitest'
import {Object3D,OrthographicCamera,Quaternion,Vector3} from 'three'
import {TransformControls} from 'three-stdlib'
import {moveGridSize,moveGizmoOptions,DEFAULT_MOVE_CONTROLS} from '../../src/magnetic-tiles/three-d/move-controls.ts'

// Exercise the installed TransformControls itself. No replacement rounding implementation.
function drag(space:'world'|'local',axis:string,spacing:number,start:[number,number,number],offset:[number,number,number],rotation=new Quaternion()){
 const camera=new OrthographicCamera(-10,10,10,-10,.01,100);camera.position.set(8,7,9);camera.lookAt(0,0,0);camera.updateMatrixWorld(true)
 const object=new Object3D(),parent=new Object3D();object.position.fromArray(start);object.quaternion.copy(rotation);parent.add(object);parent.updateMatrixWorld(true)
 // Pin the installed control's drag-start fixture; the production code uses only public Drei props.
 const control:any=new TransformControls(camera,undefined);control.attach(object);control.mode='translate';control.space=space;control.axis=axis;control.translationSnap=spacing;control.dragging=true
 // The ray / plane hit supplies a world-space cursor point, as it does in the Viewer.
 control.worldPositionStart.copy(object.position);control.worldQuaternionStart.copy(rotation)
 control['positionStart'].copy(object.position);control['quaternionStart'].copy(rotation)
 control['worldQuaternionInv'].copy(rotation).invert();control['parentQuaternionInv'].identity();control['parentScale'].set(1,1,1)
 control.pointStart.set(0,0,0)
 control['raycaster'].intersectObject=()=>[{object:control['plane'],point:object.position.clone().add(new Vector3(...offset))}]
 control.pointerMove({x:0,y:0,button:-1})
 return object.position.clone()
}
describe('Move: real library world-origin grid and axis / plane constraints',()=>{
 for(const step of [.1,.25,.5,1])for(const axis of ['X','Y','Z','XY','XZ','YZ','XYZ'])it(`${axis}, grid ${step}: moved coordinates land on world grid; locked coordinates stay exact`,()=>{
  const start:[number,number,number]=[1.13,2.07,-.19],p=drag('world',axis,step,start,[.63,-.43,.71])
  for(const [i,key]of ['X','Y','Z'].entries())if(axis.includes(key))expect(p.getComponent(i)/step).toBeCloseTo(Math.round(p.getComponent(i)/step),10);else expect(p.getComponent(i)).toBe(start[i])
 })
 it('Local X: origin-projected lattice, exact local line, no perpendicular grid jump',()=>{
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/6),start=new Vector3(1.13,2.07,-.19),direction=new Vector3(1,0,0).applyQuaternion(q),p=drag('local','X',.25,start.toArray(),direction.clone().multiplyScalar(.63).toArray(),q),local=p.clone().applyQuaternion(q.clone().invert()),before=start.clone().applyQuaternion(q.clone().invert())
  expect(local.x/.25).toBeCloseTo(Math.round(local.x/.25),10);expect(local.y).toBeCloseTo(before.y,10);expect(local.z).toBeCloseTo(before.z,10);expect(p.clone().sub(start).cross(direction).length()).toBeLessThan(1e-10)
 })
 it('Grid helper has exact requested spacing and is bounded; disabled uses no translation snap',()=>{
  for(const step of [.1,.25,.3,.5,1]){const [size,n]=moveGridSize(step);expect(size/n).toBeCloseTo(step,12);expect(n%2).toBe(0);expect(n).toBeLessThanOrEqual(400)}
  expect(moveGizmoOptions(DEFAULT_MOVE_CONTROLS).translationSnap).toBeNull()
 })
})
