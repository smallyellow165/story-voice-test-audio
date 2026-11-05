import {OrthographicCamera,Quaternion,Vector3} from 'three'
import type {Assembly3D} from '../assembly.ts'
import type {RegistrationCamera} from './contracts.ts'
import {createViewerModel} from '../viewer-model.ts'
import {captureCameraView} from '../camera-view.ts'
import {computeFitCamera,pieceWorldVertices} from '../vendor/components/magnet3d/cameraUtils.ts'

/** Existing orbit viewer stays orthographic. Match the fitted photo direction
 * for inspection only; the SVG overlay uses the actual pinhole projection. */
export function registrationInspectionView(assembly:Assembly3D,photo:RegistrationCamera){
 const inverse=new Quaternion(...photo.worldToCamera.quaternion).invert(),camera=new OrthographicCamera(-5.33,5.33,5,-5,.001,1000)
 camera.position.fromArray(photo.worldToCamera.position).negate().applyQuaternion(inverse)
 camera.up.set(0,-1,0).applyQuaternion(inverse).normalize()
 camera.lookAt(camera.position.clone().add(new Vector3(0,0,1).applyQuaternion(inverse)))
 const vertices=createViewerModel(assembly).flatMap(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion)),fit=computeFitCamera({worldVertices:vertices,camera,preferredView:'current',size:{width:640,height:600}})
 if(!fit)throw Error('配准场景没有可查看的几何')
 camera.position.copy(fit.position);camera.quaternion.copy(fit.quaternion);camera.zoom=fit.zoom
 return captureCameraView(camera,{target:fit.target,update:()=>{}})
}
