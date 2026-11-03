import {GizmoHelper,GizmoViewport} from '@react-three/drei'

/** Existing Drei HUD follows the inverse main-camera rotation each frame.
 * Disabled axis heads cannot tween the camera or edit any Assembly state. */
export function WorldOrientationGizmo(){
 return <GizmoHelper alignment="top-right" margin={[58,58]}>
  <GizmoViewport disabled hideNegativeAxes scale={28} labels={['+X','+Y','+Z']}
   axisColors={['#c64a55','#32815b','#3f79bd']} labelColor="#ffffff" font="16px Arial, sans-serif"/>
 </GizmoHelper>
}

export function WorldOrientationCaption(){
 return <div className="world-orientation-caption" role="img" aria-label="世界 XYZ 方向：+Y 为竖直向上">World XYZ · Y↑</div>
}
