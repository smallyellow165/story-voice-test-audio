import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, BoxGeometry, BufferGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute, OrthographicCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { CollisionVisual } from './collision-visual.ts'
import { computeFitCamera, applyFitResult } from './vendor/components/magnet3d/cameraUtils.ts'

export type CollisionFocus = { target: CollisionVisual; sequence: number } | null
export type CollisionDisplayProps = { collision?: CollisionVisual; collisionFocus?: CollisionFocus }

/** The only mesh is the actual evidence hull. It has no picking surface. */
export function CollisionOverlay({ collision, collisionFocus, label }: CollisionDisplayProps & { label: RefObject<HTMLOutputElement | null> }) {
  const { camera, size, controls } = useThree()
  const renderedFocus = useRef<CollisionFocus>(null)
  const geometry = useMemo(() => {
    if (!collision?.bounds) return null
    if(collision.positions.length){
      const mesh = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(collision.positions, 3));mesh.computeVertexNormals()
      return {mesh,edges:new EdgesGeometry(mesh)}
    }
    const size=new Vector3(...collision.bounds.max).sub(new Vector3(...collision.bounds.min)),box=new BoxGeometry(size.x,size.y,size.z),edges=new EdgesGeometry(box);box.dispose()
    return {mesh:null,edges}
  }, [collision])
  useEffect(() => () => { geometry?.mesh?.dispose(); geometry?.edges.dispose() }, [geometry])
  useEffect(() => {
    if (!collision || !collisionFocus || collisionFocus.target !== collision || renderedFocus.current === collisionFocus || !collision.bounds || !(camera instanceof OrthographicCamera) || !controls) return
    const box = new Box3(new Vector3(...collision.bounds.min), new Vector3(...collision.bounds.max))
    box.expandByScalar(box.getSize(new Vector3()).length() * .4)
    const worldVertices = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => new Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z))))
    const result = computeFitCamera({ camera, worldVertices, size, preferredView: 'current' })
    if (result) { applyFitResult(camera, result, controls as OrbitControls); renderedFocus.current = collisionFocus }
  }, [collisionFocus, collision, camera, controls, size])
  useFrame(() => {
    const el = label.current
    if (!el || !collision?.center) return
    const p = new Vector3(...collision.center).project(camera)
    const x = Math.max(8, Math.min(size.width - el.offsetWidth - 8, (p.x + 1) * size.width / 2 + 12))
    const y = Math.max(8, Math.min(size.height - el.offsetHeight - 8, (1 - p.y) * size.height / 2 + 12))
    el.style.visibility = p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 ? 'visible' : 'hidden'
    el.style.transform = `translate(${x}px,${y}px)`
  })
  if (!collision?.center) return null
  return <group name="collision-geometry-overlay">
    {geometry ? <group position={collision.origin}>
      {geometry.mesh&&<mesh geometry={geometry.mesh} raycast={() => {}} renderOrder={100}>
        <meshBasicMaterial color="#e03434" transparent opacity={.5} side={DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>}
      <lineSegments geometry={geometry.edges} raycast={() => {}} renderOrder={101}>
        <lineBasicMaterial color="#8d1919" depthTest={false} depthWrite={false}/>
      </lineSegments>
    </group> : null}
  </group>
}

export function CollisionLabel({ collision, label }: { collision?: CollisionVisual; label: RefObject<HTMLOutputElement | null> }) {
  if (!collision) return null
  return <output ref={label} className="magnetic-3d-collision-label" data-collision-overlay={collision.key} data-collision-kind={collision.kind}
    data-collision-center={JSON.stringify(collision.center)} data-collision-bounds={JSON.stringify(collision.bounds)} data-collision-volume={collision.volume}>
    {collision.evidence.pieceIds.join(' / ')} · depth {Number(collision.evidence.penetrationDepth.toPrecision(5))}<br/>
    {collision.kind === 'volume' ? 'Collision Geometry · 实际交集（透视）' : 'Approximate · 交集包围范围'}
  </output>
}
