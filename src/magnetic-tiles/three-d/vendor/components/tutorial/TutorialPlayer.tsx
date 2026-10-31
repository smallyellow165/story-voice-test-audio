// Adapted MIT upstream TutorialPlayer; preserves AnimatedPiece, CameraRig and orchestration.
import { useRef, useMemo, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { ShapeDef, PieceTransform } from '../../engine/types.ts'
import type { BuildStepV2, StepCamera } from './types.ts'
import type { Tutorial3D } from '../../../tutorial.ts'
import { createViewerModel } from '../../../viewer-model.ts'
import type { ViewerPiece } from '../../../viewer-model.ts'
import { MagnetPieceMesh, disposeShapeResources } from '../magnet3d/primitives.tsx'
import { SceneLighting, defaultGLProps } from '../magnet3d/SceneLighting.tsx'
import { computeFitCamera, applyFitResult, pieceWorldVertices } from '../magnet3d/cameraUtils.ts'
import { useTutorialOrchestrator } from './useTutorialOrchestrator.ts'
import { getEntranceOffset } from './orchestrator.ts'
import { ViewerErrorBoundary } from '../MagnetScene3D.tsx'
import { canonical } from '../../../../build-plan.ts'
export type TutorialCamera = Omit<StepCamera,'transitionMs'>
interface AnimatedPieceProps {
  shape: ShapeDef;
  transform: PieceTransform;
  color: string;
  /** 入场偏移：[px, py, pz] */
  positionOffset: [number, number, number];
  /** 旋转偏移（欧拉角弧度）：[rx, ry, rz] */
  rotationOffset: [number, number, number];
  /** 透明度 0..1 */
  opacity: number;
  /** 是否高亮 */
  highlighted: boolean;
  /** 是否为新零件 */
  isNew: boolean;
}

function AnimatedPiece({
  shape,
  transform,
  color,
  positionOffset,
  rotationOffset,
  opacity,
  highlighted,
  isNew,
}: AnimatedPieceProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // 应用入场偏移：最终位置 + 偏移
    groupRef.current.position.set(
      transform.position.x + positionOffset[0],
      transform.position.y + positionOffset[1],
      transform.position.z + positionOffset[2],
    );
    // 旋转：最终旋转 * 偏移旋转
    const q = transform.quaternion.clone();
    const offsetQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotationOffset[0], rotationOffset[1], rotationOffset[2]),
    );
    q.multiply(offsetQuat);
    groupRef.current.quaternion.copy(q);
  });

  if (!shape) return null;

  return (
    <group ref={groupRef}>
      <MagnetPieceMesh
        shape={shape}
        transform={{
          position: new THREE.Vector3(0, 0, 0),
          quaternion: new THREE.Quaternion(),
        } as PieceTransform}
        color={color}
        isNew={false}
        selected={isNew}
        highlighted={highlighted}
        opacity={opacity}
      />
    </group>
  );
}

interface CameraRigProps {
  /** 目标镜头（来自当前步骤的 camera 字段） */
  targetCamera: StepCamera | null;
  /** 镜头过渡进度 0..1 */
  transitionProgress: number;
  /** 是否锁定视角（锁定后不应用步骤镜头） */
  locked: boolean;
  transitionKey: string;
  cancelled: React.MutableRefObject<boolean>;
  onCamera: () => void;
  /** 默认相机状态 ref */
  defaultCameraRef: React.MutableRefObject<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>;
  /** OrbitControls ref */
  controlsRef: React.MutableRefObject<any>;
}

function CameraRig({ targetCamera, transitionProgress, locked, transitionKey, cancelled, onCamera, defaultCameraRef, controlsRef }: CameraRigProps) {
  const { camera } = useThree();
  const startStateRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null);

  const done = useRef(false);
  useEffect(() => {
    done.current=false; cancelled.current=false;
    if (locked) return;
    if (!targetCamera) return;
    // 记录起始状态:优先用 defaultCameraRef 作为起点,实现"从默认视角平滑过渡到本步镜头"
    const ortho = camera as THREE.OrthographicCamera;
    const fallbackTarget = controlsRef.current ? controlsRef.current.target.clone() : new THREE.Vector3(0, 0, 0);
    startStateRef.current = {
      position: ortho.position.clone(),
      target: fallbackTarget,
      zoom: ortho.zoom,
    };
  }, [targetCamera, locked, camera, controlsRef, defaultCameraRef, transitionKey, cancelled]);

  useFrame(() => {
    if (locked || cancelled.current || done.current || !targetCamera || !startStateRef.current) return;
    const ortho = camera as THREE.OrthographicCamera;
    if (!ortho.isOrthographicCamera) return;

    const t = transitionProgress;
    const startPos = startStateRef.current.position;
    const startTarget = startStateRef.current.target;
    const startZoom = startStateRef.current.zoom;

    // 沿用上游实现：线性插值 position、target 和 zoom。
    ortho.position.lerpVectors(startPos, new THREE.Vector3(...targetCamera.position), t);
    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(startTarget, new THREE.Vector3(...targetCamera.target), t);
      controlsRef.current.update();
    }
    ortho.zoom = startZoom + (targetCamera.zoom - startZoom) * t;
    ortho.lookAt(controlsRef.current?.target ?? new THREE.Vector3(...targetCamera.target));
    ortho.updateProjectionMatrix();
    onCamera();
    if(t>=1)done.current=true;
  });

  return null;
}

interface SceneProps {
  pieces: ViewerPiece[]; visibleIds: string[]; newIds: Set<string>; step: BuildStepV2 | undefined
  state: ReturnType<typeof useTutorialOrchestrator>['state']; transitionKey: string
  fitRequest: number; resetRequest: number; onCamera: (camera: TutorialCamera) => void
}
function SceneContent({ pieces, visibleIds, newIds, step, state, transitionKey, fitRequest, resetRequest, onCamera }: SceneProps) {
  const {camera,size}=useThree(), controlsRef=useRef<any>(null)
  const defaultCameraRef=useRef<{position:THREE.Vector3;target:THREE.Vector3;zoom:number}|null>(null)
  const cancelled=useRef(false), [ready,setReady]=useState(false)
  const visible=useMemo(()=>new Set(visibleIds),[visibleIds])
  const report=useCallback(()=>{
    if(camera instanceof THREE.OrthographicCamera && controlsRef.current)onCamera({position:camera.position.toArray(),target:controlsRef.current.target.toArray(),zoom:camera.zoom})
  },[camera,onCamera])
  const fit=useCallback((all:boolean,reset:boolean)=>{
    if(!(camera instanceof THREE.OrthographicCamera))return
    const vertices=pieces.filter(p=>all||visible.has(p.id)).flatMap(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion))
    const result=computeFitCamera({worldVertices:vertices,camera,size,preferredView:reset?'threeQuarter':'current'})
    if(result){applyFitResult(camera,result,controlsRef.current);report();return result}
  },[pieces,visible,camera,size,report])
  // Initialize the default full-assembly frame. Resize never rewrites the saved document.
  useEffect(()=>{
    const timer=setTimeout(()=>{
      const result=fit(true,true)
      if(result){defaultCameraRef.current={position:result.position.clone(),target:result.target.clone(),zoom:result.zoom};setReady(true)}
    },50)
    return ()=>clearTimeout(timer)
  },[pieces,size.width,size.height])
  const priorFit=useRef(fitRequest),priorReset=useRef(resetRequest)
  useEffect(()=>{if(priorFit.current!==fitRequest){priorFit.current=fitRequest;cancelled.current=true;fit(false,false)}},[fitRequest,fit])
  useEffect(()=>{if(priorReset.current!==resetRequest){priorReset.current=resetRequest;cancelled.current=true;fit(true,true)}},[resetRequest,fit])
  useEffect(()=>()=>disposeShapeResources([...new Set(pieces.map(p=>p.shape))]),[pieces])
  return <>
    <SceneLighting shadowOpacity={0}>
      {ready&&<CameraRig targetCamera={step?.camera??null} transitionProgress={state.cameraTransitionProgress}
        locked={state.lockedView} transitionKey={transitionKey} cancelled={cancelled} onCamera={report} defaultCameraRef={defaultCameraRef} controlsRef={controlsRef}/>}
      {pieces.filter(p=>visible.has(p.id)).map(p=>{
        const isNew=newIds.has(p.id),offset=isNew&&step?getEntranceOffset(p.id,state,step):{positionOffset:[0,0,0] as [number,number,number],rotationOffset:[0,0,0] as [number,number,number],opacity:1}
        return <AnimatedPiece key={p.id} shape={p.shape} transform={p.transform} color={p.color} {...offset} highlighted={state.pieceStates[p.id]?.phase==='highlight'} isNew={isNew}/>
      })}
    </SceneLighting>
    <OrbitControls ref={controlsRef} makeDefault enablePan enableDamping={false} minZoom={.01} maxZoom={100000}
      onStart={()=>{cancelled.current=true}} onChange={report}/>
  </>
}
export function TutorialPlayer({tutorial,initialStep=0,seekRequest,onStepChange,onCameraChange,controlsHost,detailsHost}:{
  controlsHost:HTMLElement|null;detailsHost:HTMLElement|null
  tutorial:Tutorial3D;initialStep?:number;seekRequest:{index:number;sequence:number}|null
  onStepChange:(index:number)=>void;onCameraChange:(camera:TutorialCamera)=>void
}) {
  const steps=tutorial.steps, [auto,setAuto]=useState(false), [epoch,setEpoch]=useState(0)
  const orch=useTutorialOrchestrator(steps,{initialStep,totalSteps:steps.length,autoNextMs:auto?400:0})
  const currentStep=orch.state.currentStep,step=steps[currentStep]
  const callback=useRef(onStepChange);callback.current=onStepChange
  // Match upstream: author edits must not report a stale playback index back to selection.
  useEffect(()=>{callback.current(currentStep)},[currentStep])
  const seek=orch.seek
  useEffect(()=>{if(seekRequest){setAuto(false);seek(seekRequest.index);setEpoch(n=>n+1)}},[seekRequest])
  useEffect(()=>{setAuto(false)},[steps])
  const complete=currentStep===steps.length-1&&orch.state.elapsedInStepMs>=orch.state.stepTotalMs&&orch.state.playState==='idle'
  useEffect(()=>{if(complete)setAuto(false)},[complete])
  const visibleIds=useMemo(()=>[...new Set(steps.slice(0,currentStep+1).flatMap(s=>s.addedPieceIds))],[steps,currentStep])
  const newIds=useMemo(()=>new Set(step?.addedPieceIds??[]),[step])
  const assemblyKey=canonical(tutorial.assembly)
  const pieces=useMemo(()=>createViewerModel(tutorial.assembly),[assemblyKey])
  const [fitRequest,requestFit]=useState(0),[resetRequest,requestReset]=useState(0),[camera,setCamera]=useState<TutorialCamera|null>(null)
  const report=useCallback((c:TutorialCamera)=>{setCamera(c);onCameraChange(c)},[onCameraChange])
  function navigate(fn:()=>void){setAuto(false);setEpoch(n=>n+1);fn()}
  const playbackControls=<section className="magnetic-tutorial-playback" aria-label="3D 教程播放控制">
    <p role="status" data-testid="tutorial-progress">{steps.length?`${currentStep+1} / ${steps.length} · ${step?.title}`:'尚无步骤'}{complete?' · 播放完成':''}</p>
    <p>本步新增：{step?.addedPieceIds.join('、')||'无'}</p><p>{step?.description}</p>
    <div className="magnetic-tutorial-navigation">
      <button onClick={()=>navigate(orch.prev)} disabled={!steps.length||currentStep===0}>上一步</button>
      <button disabled={!steps.length} onClick={()=>{
        if(auto||orch.state.playState==='playing'){setAuto(false);orch.pause()}
        else{setAuto(true);if(complete){orch.seek(0);setEpoch(n=>n+1)}else{orch.play();if(orch.state.playState!=='paused')setEpoch(n=>n+1)}}
      }}>{auto||orch.state.playState==='playing'?'暂停':'自动播放'}</button>
      <button onClick={()=>navigate(orch.next)} disabled={!steps.length||currentStep>=steps.length-1}>下一步</button>
      <button disabled={!steps.length} onClick={()=>navigate(()=>orch.seek(0))}>重新开始</button>
    </div>
    <label>查看步骤<select aria-label="3D 教程查看步骤" disabled={!steps.length} value={currentStep} onChange={e=>navigate(()=>orch.seek(Number(e.target.value)))}>{steps.map((s,i)=><option key={s.id} value={i}>第 {i+1} 步 · {s.title} · {s.addedPieceIds.length} 片</option>)}</select></label>
  </section>
  const displayDetails=<>
    <button disabled={!steps.length} onClick={()=>navigate(orch.replayStep)}>重播本步</button>
    <p>{step?.description}</p>{step?.hint&&<p>{step.hint}</p>}
    {step?.parentGuide&&<p>{step.parentGuide}</p>}
    {!!step?.focusPoints?.length&&<ul>{step.focusPoints.map((point,i)=><li key={i}>{point}</li>)}</ul>}
    {!!step?.annotations&&<ul>{Object.entries(step.annotations).map(([id,text])=><li key={id}>{id}：{text}</li>)}</ul>}
    <p className="hint">亮色轮廓为本步新增片；此前零件保持原色。左键旋转、右键平移、滚轮缩放。入场偏移仅用于呈现，最终 Pose 不变；不表示真实铰链折叠。</p>
    <details><summary>当前显示与相机</summary><output aria-label="3D Tutorial 可见零件">{JSON.stringify({visibleIds,newIds:[...newIds]})}</output>
      <output aria-label="3D Tutorial 相机">{JSON.stringify(camera)}</output>
      <output aria-label="3D Tutorial 播放状态">{JSON.stringify(orch.state)}</output>
      <ul>{pieces.filter(p=>visibleIds.includes(p.id)).map(p=><li key={p.id} data-tutorial-piece={p.id} data-new={newIds.has(p.id)} data-pose={JSON.stringify(p.piece.pose)}>{p.id} · {p.shape.id} · {newIds.has(p.id)?'本步新增':'已完成'}</li>)}</ul>
    </details>
  </>
  return <section className="magnetic-tutorial-player" data-testid="tutorial-player" data-step-index={currentStep} data-play-state={orch.state.playState} data-auto={auto}>
    <div className="button-row magnetic-tutorial-controls">
      <button onClick={()=>requestFit(n=>n+1)}>Fit to View</button><button onClick={()=>requestReset(n=>n+1)}>Reset Camera</button>
      <button onClick={orch.toggleLockView} aria-pressed={orch.state.lockedView}>{orch.state.lockedView?'解锁视角':'锁定视角'}</button>
    </div>
    <p className="magnetic-tutorial-view-progress">{steps.length?`第 ${currentStep+1} / ${steps.length} 步 · 新增 ${step?.addedPieceIds.join('、')}`:'尚无步骤，请在右侧生成搭建教程或展开高级编辑手动编排。'}</p>
    <div className="magnetic-3d-canvas magnetic-tutorial-canvas"><ViewerErrorBoundary>
      <Canvas orthographic camera={{position:[5,5,5],zoom:50,near:.001,far:100}} dpr={[1,2]} gl={defaultGLProps}>
        <SceneContent pieces={pieces} visibleIds={visibleIds} newIds={newIds} step={step} state={orch.state}
          transitionKey={`${currentStep}-${epoch}`} fitRequest={fitRequest} resetRequest={resetRequest} onCamera={report}/>
      </Canvas>
    </ViewerErrorBoundary></div>
    <p className="hint">亮色轮廓为本步新增片；此前零件保持原色。拖动旋转、右键平移、滚轮缩放。</p>
    {controlsHost&&createPortal(playbackControls,controlsHost)}
    {detailsHost&&createPortal(displayDetails,detailsHost)}
  </section>
}
