export type MoveConstraint='XYZ'|'X'|'Y'|'Z'|'XY'|'XZ'|'YZ'
/** Viewer preferences only: no Assembly fields or connection operations. */
export type MoveControlsSettings={grid:boolean;object:boolean;spacing:number;constraint:MoveConstraint;space:'global'|'local'}
export const DEFAULT_MOVE_CONTROLS:MoveControlsSettings={grid:false,object:false,spacing:.5,constraint:'XYZ',space:'global'}
export function validMoveSpacing(value:number){return Number.isFinite(value)&&value>0}
export function moveGizmoOptions(settings:MoveControlsSettings){
 return {translationSnap:settings.grid&&validMoveSpacing(settings.spacing)?settings.spacing:null,
  showX:settings.constraint.includes('X'),showY:settings.constraint.includes('Y'),showZ:settings.constraint.includes('Z')}
}
/** Keep exact spacing and a symmetric, origin-centred, bounded grid. */
export function moveGridSize(spacing:number):[number,number]{
 const half=Math.max(1,Math.min(200,Math.ceil(10/spacing)))
 return [2*half*spacing,2*half]
}
/** OrbitControls may have seen pointer-down before the Gizmo disabled it.
 * End that camera gesture through its existing DOM cancellation API before
 * re-enabling it, so Esc cannot turn the remaining object drag into an orbit. */
export function cancelMoveCameraGesture(controls:{domElement?:HTMLElement}|null,pointerId:number|undefined){
 if(controls?.domElement&&pointerId!==undefined)controls.domElement.dispatchEvent(new PointerEvent('pointercancel',{pointerId,bubbles:false}))
}
/** Read the installed TransformControls' constrained offset before its grid
 * rounding. Detection uses this continuous pose; ordinary Move keeps the
 * existing rounded object pose. No alignment or camera math is replaced. */
export function continuousMovePose(control:{positionStart:{clone:()=>import('three').Vector3};offset:import('three').Vector3;object:import('three').Object3D}):import('./assembly.ts').Pose3D{
 return{position:control.positionStart.clone().add(control.offset).toArray(),quaternion:control.object.quaternion.clone().normalize().toArray()}
}
