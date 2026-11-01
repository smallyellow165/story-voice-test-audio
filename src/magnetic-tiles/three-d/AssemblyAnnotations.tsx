import { useRef } from 'react'
import type { RefObject } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Raycaster, Vector2, Vector3 } from 'three'
import type { ShapeDef, PieceTransform, Connection } from './vendor/engine/types.ts'

export type TileLabelElements = RefObject<Map<string, HTMLSpanElement>>
export type AnnotationPiece = { id: string; shape: ShapeDef; transform: PieceTransform }

/** Assembly-only presentation. No Pose changes, picking surfaces or saved state. */
export function AssemblyTileLabels({ pieces, selectedIds, solids, elements }: {
  pieces: AnnotationPiece[]; selectedIds: string[]; solids: RefObject<Group | null>; elements: TileLabelElements
}) {
  const { camera, size } = useThree()
  const ray = useRef(new Raycaster())
  useFrame(() => {
    const occupied: { x: number; y: number; width: number; height: number }[] = []
    // Selected IDs win label space; ties follow the actual Piece order.
    const ordered = [...pieces].sort((a, b) => Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id)))
    for (const piece of ordered) {
      const el = elements.current.get(piece.id)
      if (!el) continue
      const { position, quaternion } = piece.transform
      const center = piece.shape.vertices.reduce<Vector3>((sum, p) => sum.add(new Vector3(p.x, p.y, 0)), new Vector3())
        .multiplyScalar(1 / Math.max(1, piece.shape.vertices.length)).applyQuaternion(quaternion).add(position)
      const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion)
      // Either face may face the camera; local +Z is not a visibility rule.
      const towardCamera = camera.getWorldDirection(new Vector3()).negate()
      center.addScaledVector(normal, (normal.dot(towardCamera) >= 0 ? 1 : -1) * (piece.shape.thickness / 2 + .004))
      const ndc = center.clone().project(camera)
      const active = selectedIds.includes(piece.id)
      let occluded = false
      if (solids.current) {
        ray.current.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
        const hit = ray.current.intersectObject(solids.current, true)[0]
        if (hit) {
          let owner = hit.object
          while (owner.parent && !owner.userData.tileId) owner = owner.parent
          occluded = !!owner.userData.tileId && owner.userData.tileId !== piece.id
        }
      }
      const x = (ndc.x + 1) * size.width / 2, y = (1 - ndc.y) * size.height / 2
      const width = Math.min(Math.max(42, el.offsetWidth), size.width), height = el.offsetHeight || 24
      const inView = ndc.z >= -1 && ndc.z <= 1 && x >= 0 && x <= size.width && y >= 0 && y <= size.height
      let placed: typeof occupied[number] | undefined
      if (inView && (!occluded || active)) {
        for (const dy of [0, -28, 28, -56, 56]) {
          const box = { x: Math.max(0, Math.min(size.width - width, x - width / 2)), y: Math.max(0, Math.min(size.height - height, y - height / 2 + dy)), width, height }
          if (!occupied.some(b => box.x < b.x + b.width + 3 && box.x + width + 3 > b.x && box.y < b.y + b.height + 3 && box.y + height + 3 > b.y)) { placed = box; break }
        }
      }
      el.style.visibility = placed ? 'visible' : 'hidden'
      el.dataset.occluded = String(occluded)
      if (placed) { occupied.push(placed); el.style.transform = `translate(${placed.x}px,${placed.y}px)` }
    }
  })
  return null
}

/** Ordinary React overlay avoids creating/unmounting a second React root in Canvas. */
export function TileLabelLayer({ids,selectedIds,elements,previewIds=[]}:{ids:string[];selectedIds:string[];elements:TileLabelElements;previewIds?:string[]}){
  return <div className="magnetic-3d-label-layer" aria-hidden="true">
    {ids.map(id=><span key={id} ref={el=>{if(el)elements.current.set(id,el);else elements.current.delete(id)}}
      data-tile-label={id} data-symmetry-preview={previewIds.includes(id)} data-selected={selectedIds.includes(id)} className="magnetic-3d-tile-label">{id}</span>)}
  </div>
}

/** Highlight actual A/B Port edges, including separated endpoints in invalid Drafts. */
export function AssemblyConnectionHighlight({ pieces, connection, onSelect }: {
  pieces: AnnotationPiece[]; connection?: Connection; onSelect?: () => void
}) {
  if (!connection) return null
  return <group name="assembly-selected-connection">{(['A', 'B'] as const).map(side => {
    const p = pieces.find(p => p.id === (side === 'A' ? connection.pieceA : connection.pieceB))
    const port = p?.shape.ports.find(port => port.portId === (side === 'A' ? connection.portA : connection.portB))
    if (!p || !port) return null
    const world = (v: { x: number; y: number }) => new Vector3(v.x, v.y, 0).applyQuaternion(p.transform.quaternion).add(p.transform.position)
    return <Line key={side} name={`selected-port-${side}`} points={[world(port.p0), world(port.p1)]} color="#153f39" lineWidth={7}
      depthTest={false} renderOrder={10} raycast={onSelect?undefined:()=>{}} onClick={e => { e.stopPropagation(); onSelect?.() }}/>
  })}</group>
}
