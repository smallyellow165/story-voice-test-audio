// Adapted from MIT 3D_Magnetic_Pieces MagnetScene3D.
// Kept: R3F Canvas → SceneContent → SceneLighting/MagnetPieceMesh + OrbitControls.
// Replaced product Model/step/solver lookup with the host's exact snapshot boundary.
// See third_party/3D_Magnetic_Pieces/VIEWER.md for source and adaptation record.
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { OrthographicCamera } from 'three'
import type { Assembly3D } from '../../assembly.ts'
import { createViewerModel } from '../../viewer-model.ts'
import type { ViewerPiece } from '../../viewer-model.ts'
import { MagnetPieceMesh, disposeShapeResources } from './magnet3d/primitives.tsx'
import { SceneLighting, defaultGLProps } from './magnet3d/SceneLighting.tsx'
import { computeFitCamera, applyFitResult, pieceWorldVertices } from './magnet3d/cameraUtils.ts'

export type CameraState = { position: number[]; target: number[]; zoom: number }
type Props = { assembly: Assembly3D; selected: string | null; onSelect: (id: string | null) => void }
function SceneContent({ pieces, selected, onSelect, fitRequest, resetRequest, onCameraChange }: {
  pieces: ViewerPiece[]; selected: string | null; onSelect: Props['onSelect']; fitRequest: number; resetRequest: number;
  onCameraChange: (state: CameraState) => void
}) {
  const controls = useRef<OrbitControlsImpl | null>(null)
  const { camera, size } = useThree()
  const vertices = useMemo(() => pieces.flatMap(p => pieceWorldVertices(p.shape, p.transform.position, p.transform.quaternion)), [pieces])
  const report = useCallback(() => {
    if (camera instanceof OrthographicCamera && controls.current) onCameraChange({
      position: camera.position.toArray(), target: controls.current.target.toArray(), zoom: camera.zoom,
    })
  }, [camera, onCameraChange])
  const lastReset = useRef<number | null>(null)
  const fit = useCallback((preferredView: 'current' | 'threeQuarter') => {
    if (!(camera instanceof OrthographicCamera) || !size.width || !size.height) return
    const result = computeFitCamera({ worldVertices: vertices, camera, size, preferredView })
    if (result) { applyFitResult(camera, result, controls.current); report() }
  }, [camera, vertices, size.width, size.height, report])
  // Document load, container resize and explicit Fit/Reset affect the CAMERA only.
  useEffect(() => { fit(lastReset.current === resetRequest ? 'current' : 'threeQuarter'); lastReset.current = resetRequest }, [fit, fitRequest, resetRequest])
  useEffect(() => () => disposeShapeResources([...new Set(pieces.map(p => p.shape))]), [pieces])
  return <>
    <SceneLighting shadowOpacity={0}>{pieces.map(p => <MagnetPieceMesh key={p.id} shape={p.shape}
      transform={p.transform} color={p.color} selected={p.id === selected}
      onClick={e => { e.stopPropagation(); if (e.delta <= 3) onSelect(p.id) }}/>)}</SceneLighting>
    <OrbitControls ref={controls} makeDefault enablePan enableZoom enableRotate enableDamping={false}
      minZoom={.01} maxZoom={100000} onChange={report}/>
  </>
}
export class ViewerErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <p role="alert">3D 画布无法启动：{this.state.error}。请确认浏览器支持 WebGL；可继续使用 2D 查看。</p> : this.props.children }
}
export function MagnetScene3D({ assembly, selected, onSelect }: Props) {
  const pieces = useMemo(() => createViewerModel(assembly), [assembly])
  const [fitRequest, requestFit] = useState(0), [resetRequest, requestReset] = useState(0)
  const [cameraState, setCameraState] = useState<CameraState | null>(null)
  return <section className="magnetic-3d-scene" aria-label="磁力片三维画布">
    <div className="magnetic-3d-camera-tools"><button onClick={() => requestFit(n => n + 1)}>Fit to View</button>
      <button onClick={() => requestReset(n => n + 1)}>Reset Camera</button></div>
    <div className="magnetic-3d-canvas" data-testid="magnetic-3d-canvas">
      <ViewerErrorBoundary>
        <Canvas orthographic camera={{ position: [5, 5, 5], zoom: 50, near: .001, far: 100 }}
          dpr={[1, 2]} gl={defaultGLProps} fallback={<p role="alert">浏览器不支持 WebGL，无法显示 3D。可切回 2D 查看。</p>}
          onPointerMissed={() => onSelect(null)}>
          <SceneContent pieces={pieces} selected={selected} onSelect={onSelect} fitRequest={fitRequest}
            resetRequest={resetRequest} onCameraChange={setCameraState}/>
        </Canvas>
      </ViewerErrorBoundary>
    </div>
    <p className="hint">左键拖动旋转 · 滚轮缩放 · 右键拖动平移 · 点击零件查看详情</p>
    <details className="magnetic-3d-camera-state"><summary>相机状态</summary>
      <output aria-label="3D 相机状态">{JSON.stringify(cameraState)}</output></details>
  </section>
}
