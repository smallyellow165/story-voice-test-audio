import {ReadOnlyAssemblyGroups} from '../../ReadOnlyAssemblyGroups.tsx'
import {displayAnnotationPieces,displayLabels,displayPieceKey,EMPTY_ASSEMBLY_DISPLAYS} from '../../multi-assembly-display.ts'
import type {MultiAssemblyDisplayProps} from '../../multi-assembly-display.ts'
import {GeometryIssueOverlay} from '../../GeometryIssueOverlay.tsx'
import type {GeometryIssueDisplayProps} from '../../GeometryIssueOverlay.tsx'
import {captureCameraView,restoreCameraView,resizeSavedCamera} from '../../camera-view.ts'
import type {CameraView3D} from '../../camera-view.ts'
import {pieceViewPreset} from '../../reconstruction/pose-inspection.ts'
// Adapted from MIT 3D_Magnetic_Pieces MagnetScene3D.
// Kept: R3F Canvas → SceneContent → SceneLighting/MagnetPieceMesh + OrbitControls.
// Replaced product Model/step/solver lookup with the host's exact snapshot boundary.
// See third_party/3D_Magnetic_Pieces/VIEWER.md for source and adaptation record.
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Group,OrthographicCamera,Vector3 } from 'three'
import type {Connection} from '../engine/types.ts'
import {AssemblyTileLabels,AssemblyConnectionHighlight,TileLabelLayer} from '../../AssemblyAnnotations.tsx'
import type {TileLabelElements} from '../../AssemblyAnnotations.tsx'
import {CollisionOverlay,CollisionLabel} from '../../CollisionOverlay.tsx'
import type {CollisionDisplayProps} from '../../CollisionOverlay.tsx'
import type { Assembly3D } from '../../assembly.ts'
import { createViewerModel } from '../../viewer-model.ts'
import type { ViewerPiece } from '../../viewer-model.ts'
import { MagnetPieceMesh, disposeShapeResources } from './magnet3d/primitives.tsx'
import { SceneLighting, defaultGLProps } from './magnet3d/SceneLighting.tsx'
import { computeFitCamera, applyFitResult, pieceWorldVertices } from './magnet3d/cameraUtils.ts'

export type CameraState = CameraView3D
type Props = CollisionDisplayProps & GeometryIssueDisplayProps & MultiAssemblyDisplayProps & { assembly: Assembly3D; selected: string | null; onSelect: (id: string | null) => void; showTileIds?:boolean;selectedConnection?:Connection;inspectionTools?:boolean;initialCameraView?:CameraView3D;onSaveCameraView?:(view:CameraView3D)=>void }
function SceneContent({ pieces, selected, onSelect, fitRequest, resetRequest, onCameraChange, preset,initialCameraView,showTileIds,selectedConnection,labelElements,collision,collisionFocus,collisionLabel,geometryIssue,issueFocus,readOnlyAssemblies=EMPTY_ASSEMBLY_DISPLAYS,activeVisible=true,onInspectAssemblyPiece,readOnlySelection,assemblyId }: CollisionDisplayProps & GeometryIssueDisplayProps & MultiAssemblyDisplayProps & {
 assemblyId:string;
  labelElements:TileLabelElements;collisionLabel:React.RefObject<HTMLOutputElement|null>;
  showTileIds?:boolean;selectedConnection?:Connection;pieces: ViewerPiece[]; selected: string | null; onSelect: Props['onSelect']; fitRequest: number; resetRequest: number;
  initialCameraView?:CameraView3D;onCameraChange: (state: CameraState) => void; preset:{up:[number,number,number];direction:[number,number,number]}|null
}) {
  const solids=useRef<Group>(null)
  const selectedIds=collision?collision.evidence.pieceIds:geometryIssue?geometryIssue.pieceIds:selectedConnection?[selectedConnection.pieceA,selectedConnection.pieceB]:selected?[selected]:[]
  const controls = useRef<OrbitControlsImpl | null>(null)
  const { camera, size } = useThree()
  const otherPieces=useMemo(()=>displayAnnotationPieces(readOnlyAssemblies),[readOnlyAssemblies])
  const vertices = useMemo(() => [...(activeVisible?pieces:[]),...otherPieces].flatMap(p => pieceWorldVertices(p.shape, p.transform.position, p.transform.quaternion)), [pieces,activeVisible,otherPieces])
  const report = useCallback(() => {
    if (camera instanceof OrthographicCamera && controls.current) onCameraChange(captureCameraView(camera,controls.current))
  }, [camera, onCameraChange])
  const lastReset = useRef<number | null>(null),restored=useRef(false),lastRequests=useRef({fit:fitRequest,reset:resetRequest})
  const fit = useCallback((preferredView: 'current' | 'threeQuarter') => {
    if (!(camera instanceof OrthographicCamera) || !size.width || !size.height) return
    if(preferredView==='threeQuarter')camera.up.set(0,1,0)
    const result = computeFitCamera({ worldVertices: vertices, camera, size, preferredView })
    if (result) { applyFitResult(camera, result, controls.current); report() }
  }, [camera, vertices, size.width, size.height, report])
  // Document load, container resize and explicit Fit/Reset affect the CAMERA only.
  useEffect(() => {
    if(initialCameraView&&camera instanceof OrthographicCamera&&controls.current&&!restored.current){restoreCameraView(camera,controls.current,initialCameraView,size);restored.current=true;lastReset.current=resetRequest;report();return}
    if(restored.current&&camera instanceof OrthographicCamera){resizeSavedCamera(camera,size);if(lastRequests.current.fit===fitRequest&&lastRequests.current.reset===resetRequest){report();return}}
    lastRequests.current={fit:fitRequest,reset:resetRequest};fit(lastReset.current === resetRequest ? 'current' : 'threeQuarter');lastReset.current=resetRequest
  }, [fit, fitRequest, resetRequest])
  const displayKey=JSON.stringify([activeVisible,readOnlyAssemblies.map(a=>[a.id,a.offset])]),lastDisplay=useRef(displayKey)
  useEffect(()=>{if(lastDisplay.current===displayKey&&!readOnlyAssemblies.length)return;lastDisplay.current=displayKey;const timer=setTimeout(()=>fit('current'),100);return()=>clearTimeout(timer)},[displayKey])
  useEffect(()=>{
    if(!preset||!(camera instanceof OrthographicCamera))return
    const target=vertices.reduce((s,v)=>s.add(v),new Vector3()).multiplyScalar(1/Math.max(1,vertices.length))
    camera.up.fromArray(preset.up);camera.position.copy(target).add(new Vector3(...preset.direction).multiplyScalar(8));camera.lookAt(target);camera.updateMatrixWorld(true)
    const result=computeFitCamera({worldVertices:vertices,camera,size,preferredView:'current'});if(result){applyFitResult(camera,result,controls.current);report()}
  },[preset])
  useEffect(() => () => disposeShapeResources([...new Set(pieces.map(p => p.shape))]), [pieces])
  return <>
    <SceneLighting shadowOpacity={0}><group ref={solids}><group visible={activeVisible} userData={{assemblyId}}>{(activeVisible?pieces:[]).map(p => <group key={p.id} userData={{tileId:p.id}}><MagnetPieceMesh shape={p.shape}
      transform={p.transform} color={p.color} selected={selectedIds.includes(p.id)} dimmed={(!!collision||!!geometryIssue?.pieceIds.length)&&!selectedIds.includes(p.id)} inspectionMuted={(!!collision||!!geometryIssue?.pieceIds.length)&&!selectedIds.includes(p.id)} opacity={(collision||geometryIssue?.pieceIds.length)&&!selectedIds.includes(p.id)?.14:1}
      onClick={e => { e.stopPropagation(); if (e.delta <= 3) onSelect(p.id) }}/></group>)}</group><ReadOnlyAssemblyGroups readOnlyAssemblies={readOnlyAssemblies} onInspectAssemblyPiece={onInspectAssemblyPiece} readOnlySelection={readOnlySelection}/></group><AssemblyConnectionHighlight pieces={pieces} connection={activeVisible?selectedConnection:undefined}/>{(showTileIds||collision||geometryIssue)&&<AssemblyTileLabels pieces={[...(activeVisible?pieces:[]),...otherPieces]} selectedIds={[...selectedIds,...(readOnlySelection?[displayPieceKey(readOnlySelection.assemblyId,readOnlySelection.pieceId)]:[])]} solids={solids} elements={labelElements}/>}<GeometryIssueOverlay pieces={pieces} geometryIssue={activeVisible?geometryIssue:undefined} issueFocus={issueFocus}/><CollisionOverlay collision={activeVisible?collision:undefined} collisionFocus={collisionFocus} label={collisionLabel}/></SceneLighting>
    <OrbitControls ref={controls} makeDefault enablePan enableZoom enableRotate enableDamping={false}
      minZoom={.01} maxZoom={100000} onChange={report}/>
  </>
}
export class ViewerErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <p role="alert">3D 画布无法启动：{this.state.error}。请确认浏览器支持 WebGL；可继续使用 2D 查看。</p> : this.props.children }
}
export function MagnetScene3D({ assembly, selected, onSelect,inspectionTools=false,initialCameraView,onSaveCameraView,showTileIds,selectedConnection,collision,collisionFocus,geometryIssue,issueFocus,readOnlyAssemblies=EMPTY_ASSEMBLY_DISPLAYS,activeVisible=true,onInspectAssemblyPiece,readOnlySelection }: Props) {
  const otherPieces=useMemo(()=>displayAnnotationPieces(readOnlyAssemblies),[readOnlyAssemblies])
  const labelNames=useMemo(()=>displayLabels(readOnlyAssemblies),[readOnlyAssemblies])
  const collisionLabel=useRef<HTMLOutputElement>(null)
  const labelElements=useRef(new Map<string,HTMLSpanElement>())
  const selectedIds=collision?collision.evidence.pieceIds:geometryIssue?geometryIssue.pieceIds:selectedConnection?[selectedConnection.pieceA,selectedConnection.pieceB]:selected?[selected]:[]
  const pieces = useMemo(() => createViewerModel(assembly), [assembly])
  const [preset,setPreset]=useState<ReturnType<typeof pieceViewPreset>|null>(null)
  const [fitRequest, requestFit] = useState(0), [resetRequest, requestReset] = useState(0)
  const cameraRef=useRef<CameraView3D|null>(null)
  const report=useCallback((state:CameraView3D)=>{cameraRef.current=state;setCameraState(state)},[])
  const [cameraState, setCameraState] = useState<CameraState | null>(null)
  return <section className="magnetic-3d-scene" data-viewer-selected-piece={selected??''} data-geometry-highlight-pieces={geometryIssue?.pieceIds.join(',')} data-geometry-highlight-connections={geometryIssue?.connectionIndices.join(',')} data-geometry-highlight-ports={geometryIssue?.segments.map(s=>s.id).join(';')} aria-label="磁力片三维画布">
    <div className="magnetic-3d-camera-tools"><button onClick={() => requestFit(n => n + 1)}>Fit to View</button>
      <button onClick={() => requestReset(n => n + 1)}>Reset Camera</button>{onSaveCameraView&&<button disabled={!cameraState} onClick={()=>cameraRef.current&&onSaveCameraView(cameraRef.current)}>保存当前视角</button>}{inspectionTools&&<><button disabled={!selected} onClick={()=>selected&&setPreset(pieceViewPreset(assembly,selected,'face'))}>正对所选面</button><button disabled={!selected} onClick={()=>selected&&setPreset(pieceViewPreset(assembly,selected,'up'))}>以所选面为上方观察</button></>}</div>
    <div className="magnetic-3d-canvas" data-testid="magnetic-3d-canvas">
      <ViewerErrorBoundary>
        <Canvas orthographic camera={{ position: [5, 5, 5], zoom: 50, near: .001, far: 100 }}
          dpr={[1, 2]} gl={defaultGLProps} fallback={<p role="alert">浏览器不支持 WebGL，无法显示 3D。可切回 2D 查看。</p>}
          onPointerMissed={() => onSelect(null)}>
          <SceneContent pieces={pieces} assemblyId={assembly.id} readOnlyAssemblies={readOnlyAssemblies} activeVisible={activeVisible} onInspectAssemblyPiece={onInspectAssemblyPiece} readOnlySelection={readOnlySelection} geometryIssue={geometryIssue} issueFocus={issueFocus} collision={collision} collisionFocus={collisionFocus} collisionLabel={collisionLabel} labelElements={labelElements} selected={selected} onSelect={onSelect} fitRequest={fitRequest}
            resetRequest={resetRequest} onCameraChange={report} preset={preset} showTileIds={showTileIds} selectedConnection={selectedConnection} initialCameraView={initialCameraView}/>
        </Canvas>
      </ViewerErrorBoundary>
      {(showTileIds||collision||geometryIssue)&&<TileLabelLayer ids={[...(activeVisible?(collision?collision.evidence.pieceIds:geometryIssue?geometryIssue.pieceIds:pieces.map(p=>p.id)):[]),...otherPieces.map(p=>p.id)]} labels={labelNames} selectedIds={[...selectedIds,...(readOnlySelection?[displayPieceKey(readOnlySelection.assemblyId,readOnlySelection.pieceId)]:[])]} elements={labelElements}/>}
      <CollisionLabel collision={activeVisible?collision:undefined} label={collisionLabel}/>
    </div>
    <p className="hint">左键拖动旋转 · 滚轮缩放 · 右键拖动平移 · 点击零件查看详情</p>
    <details className="magnetic-3d-camera-state"><summary>相机状态</summary>
      <output aria-label="3D 相机状态">{JSON.stringify(cameraState)}</output></details>
  </section>
}
