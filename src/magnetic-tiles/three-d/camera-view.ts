import {OrthographicCamera,Quaternion,Vector3} from 'three'
export type CameraView3D={
 version:1;projection:'orthographic';position:[number,number,number];quaternion:[number,number,number,number]
 up:[number,number,number];target:[number,number,number];zoom:number
 frustum:{left:number;right:number;top:number;bottom:number;near:number;far:number}
}
type Controls={target:Vector3;update:()=>unknown}
export function assertCameraView(value:unknown):asserts value is CameraView3D{
 const v=value as CameraView3D
 if(!v||v.version!==1||v.projection!=='orthographic')throw Error('保存的 Camera View 格式无效')
 for(const [a,n] of [[v.position,3],[v.quaternion,4],[v.up,3],[v.target,3]] as const)if(!Array.isArray(a)||a.length!==n||!a.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e12))throw Error('Camera View 坐标无效')
 const f=v.frustum;if(!f||![f.left,f.right,f.top,f.bottom,f.near,f.far,v.zoom].every(Number.isFinite)||f.left>=f.right||f.bottom>=f.top||f.near<=0||f.far<=f.near||v.zoom<=0)throw Error('Camera View 投影参数无效')
 const q=new Quaternion(...v.quaternion),up=new Vector3(...v.up),direction=new Vector3(...v.target).sub(new Vector3(...v.position))
 if(Math.abs(q.length()-1)>1e-6||Math.abs(up.length()-1)>1e-6||direction.length()<1e-8||new Vector3(0,0,-1).applyQuaternion(q).dot(direction.normalize())<1-1e-6)throw Error('Camera View 朝向与 Target 不一致')
}
export function captureCameraView(camera:OrthographicCamera,controls:Controls):CameraView3D{
 return {version:1,projection:'orthographic',position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),target:controls.target.toArray(),zoom:camera.zoom,frustum:{left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom,near:camera.near,far:camera.far}}
}
/** Keep vertical world extent, target and rotation across differently sized canvases.
 * Horizontal extent follows the new aspect ratio; no geometry-dependent refitting.
 */
export function resizeSavedCamera(camera:OrthographicCamera,size:{width:number;height:number}){
 if(!size.width||!size.height)return
 const height=camera.top-camera.bottom,width=height*size.width/size.height,center=(camera.left+camera.right)/2*width/(camera.right-camera.left)
 camera.left=center-width/2;camera.right=center+width/2;camera.updateProjectionMatrix()
}
export function restoreCameraView(camera:OrthographicCamera,controls:Controls,view:CameraView3D,size:{width:number;height:number}){
 assertCameraView(view)
 // R3F otherwise replaces the saved projection on a canvas/container resize.
 ;(camera as OrthographicCamera&{manual?:boolean}).manual=true
 Object.assign(camera,view.frustum);camera.position.fromArray(view.position);camera.up.fromArray(view.up);camera.zoom=view.zoom
 controls.target.fromArray(view.target);controls.update();camera.quaternion.fromArray(view.quaternion)
 resizeSavedCamera(camera,size);camera.updateMatrixWorld(true)
}
