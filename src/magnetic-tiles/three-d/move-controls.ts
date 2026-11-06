export type MoveConstraint='XYZ'|'X'|'Y'|'Z'|'XY'|'XZ'|'YZ'
/** Viewer preferences only: no Assembly fields or connection operations. */
export type MoveControlsSettings={grid:boolean;spacing:number;constraint:MoveConstraint;space:'global'|'local'}
export const DEFAULT_MOVE_CONTROLS:MoveControlsSettings={grid:false,spacing:.5,constraint:'XYZ',space:'global'}
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
