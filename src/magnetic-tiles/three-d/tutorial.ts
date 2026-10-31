import type { Assembly3D } from './assembly.ts'
import { assertAssembly3D } from './assembly.ts'
import { validateAssembly3D } from './engine-adapter.ts'
import { componentCount, createViewerModel } from './viewer-model.ts'
import { pieceWorldVertices } from './vendor/components/magnet3d/cameraUtils.ts'
import { editorProject } from './editor-project.ts'
import type { EditorProject } from './editor-project.ts'
import type { BuildStepV2, StepCamera } from './vendor/components/tutorial/types.ts'
import { uid } from './vendor/editor/id.ts'
import { canonical } from '../build-plan.ts'

export type Tutorial3D = {
  kind: 'magnetic-tutorial-3d'; schemaVersion: 1; id: string; revision: number; title: string
  source: { assemblyId: string; assemblyRevision: number }
  assembly: Assembly3D; steps: BuildStepV2[]
}
export type TutorialProject = EditorProject & { steps: BuildStepV2[] }
export type TutorialIssue = { code: string; severity: 'error' | 'warning'; message: string; stepId?: number }
export type TutorialDiagnostics = { issues: TutorialIssue[]; verified: boolean; finalValid: boolean; steps: {
  stepId: number; geometryValid: boolean; connected: boolean; components: number; grounded: boolean
}[] }
const fail = (s: string): never => { throw Error(s) }
function obj(x: unknown, keys: string[]) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !keys.includes(k))) fail('Invalid Tutorial3D fields')
}
function finite(n: unknown, lo = -1e9, hi = 1e9): n is number { return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi }
function tuple(x: unknown) { return Array.isArray(x) && x.length === 3 && x.every(v => finite(v)) }
function text(x: unknown) { return typeof x === 'string' && x.length <= 10000 }
const safeId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(x) && !['__proto__','prototype','constructor'].includes(x)
export function assertCamera(camera: StepCamera) {
  obj(camera, ['position','target','zoom','transitionMs'])
  if (!tuple(camera.position) || !tuple(camera.target) || !finite(camera.zoom, .01, 100000) || !finite(camera.transitionMs, 0, 10000) ||
    camera.position.every((v,i) => Math.abs(v-camera.target[i]) < 1e-9)) fail('Invalid tutorial camera')
}
/** Structural validation only. Incomplete, disconnected and invalid-geometry Drafts remain saveable. */
export function assertTutorial3D(t: Tutorial3D): void {
  obj(t, ['kind','schemaVersion','id','revision','title','source','assembly','steps'])
  if(t.kind!=='magnetic-tutorial-3d'||t.schemaVersion!==1||!safeId(t.id)||!Number.isSafeInteger(t.revision)||t.revision<0||!text(t.title)) fail('Unsupported Tutorial3D')
  assertAssembly3D(t.assembly); obj(t.source,['assemblyId','assemblyRevision'])
  if(t.source.assemblyId!==t.assembly.id || t.source.assemblyRevision!==t.assembly.revision) fail('Tutorial source version does not match embedded Assembly3D')
  if(!Array.isArray(t.steps)||t.steps.length>1000) fail('Invalid tutorial steps')
  const ids=new Set<number>(),pieces=new Set(t.assembly.pieces.map(p=>p.id))
  for(const s of t.steps){
    obj(s,['id','title','description','parentGuide','addedPieceIds','addedConnections','camera','entrance','highlightMs','snapFeedback','annotations','hint','focusPoints'])
    if(!Number.isSafeInteger(s.id)||s.id<1||ids.has(s.id)||![s.title,s.description,s.parentGuide].every(text)||!Array.isArray(s.addedPieceIds)||s.addedPieceIds.some(id=>!pieces.has(id))||!Array.isArray(s.addedConnections)) fail('Invalid tutorial step reference')
    ids.add(s.id)
    if(s.camera) assertCamera(s.camera)
    if(s.highlightMs!==undefined&&!finite(s.highlightMs,0,10000)) fail('Invalid highlight duration')
    if(s.hint!==undefined&&!text(s.hint)||s.focusPoints!==undefined&&(!Array.isArray(s.focusPoints)||!s.focusPoints.every(text))) fail('Invalid tutorial hints')
    if(s.snapFeedback!==undefined&&!['none','pulse','glow'].includes(s.snapFeedback)) fail('Invalid feedback')
    if(s.annotations){obj(s.annotations,s.addedPieceIds);if(!Object.values(s.annotations).every(text))fail('Invalid annotations')}
    if(s.entrance){
      obj(s.entrance,s.addedPieceIds)
      for(const cfg of Object.values(s.entrance)){
        obj(cfg,['type','delayMs','durationMs','easing','startOffset','startRotation'])
        if(!['fade','none','drop','side','fold'].includes(cfg.type)||!['linear','easeOutCubic','easeInOutCubic','easeOutBack','easeOutBounce','easeOutElastic'].includes(cfg.easing)||!finite(cfg.delayMs,0,10000)||!finite(cfg.durationMs,0,10000)||cfg.startOffset!==undefined&&!tuple(cfg.startOffset)||cfg.startRotation!==undefined&&!tuple(cfg.startRotation))fail('Invalid entrance animation')
      }
    }
  }
  // Connections are derived from the immutable assembly and first-visible steps.
  const derived=structuredClone(t);syncStepConnections(derived)
  if(canonical(derived.steps.map(s=>s.addedConnections))!==canonical(t.steps.map(s=>s.addedConnections)))fail('Tutorial step connections do not match source Assembly3D')
  if(new TextEncoder().encode(JSON.stringify(t)).byteLength>2_000_000)fail('Tutorial JSON 超过 2 MB')
}
export function syncStepConnections(t: Tutorial3D) {
  const seen=new Set<string>()
  for(const s of t.steps){
    const before=new Set(seen);s.addedPieceIds.forEach(id=>seen.add(id))
    s.addedConnections=t.assembly.connections.filter(c=>seen.has(c.pieceA)&&seen.has(c.pieceB)&&!(before.has(c.pieceA)&&before.has(c.pieceB))).map(c=>({...c}))
  }
}
export function createTutorial3D(assembly: Assembly3D): Tutorial3D {
  assertAssembly3D(assembly)
  return {kind:'magnetic-tutorial-3d',schemaVersion:1,id:uid('tutorial'),revision:0,title:'3D 搭建教程',
    source:{assemblyId:assembly.id,assemblyRevision:assembly.revision},assembly:structuredClone(assembly),steps:[]}
}
export function tutorialProject(t: Tutorial3D): TutorialProject { return {...editorProject(t.assembly),steps:t.steps} }
export function stepAssembly(t: Tutorial3D,index: number): Assembly3D {
  const ids=new Set(t.steps.slice(0,index+1).flatMap(s=>s.addedPieceIds))
  return {...t.assembly,pieces:t.assembly.pieces.filter(p=>ids.has(p.id)),connections:t.assembly.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))}
}
export function validateTutorial3D(t: Tutorial3D): TutorialDiagnostics {
  assertTutorial3D(t)
  const issues: TutorialIssue[]=[],final=validateAssembly3D(t.assembly)
  for(const i of final.issues)issues.push({code:'FINAL_GEOMETRY',severity:'error',message:`最终结构：${i.message}`})
  if(!t.assembly.pieces.length)issues.push({code:'EMPTY_ASSEMBLY',severity:'error',message:'来源结构没有零件'})
  const assigned=new Set<string>()
  const steps=t.steps.map((s,index)=>{
    if(!s.addedPieceIds.length)issues.push({stepId:s.id,code:'EMPTY_STEP',severity:'warning',message:'本步没有新增零件'})
    for(const id of s.addedPieceIds){if(assigned.has(id))issues.push({stepId:s.id,code:'DUPLICATE_PIECE',severity:'error',message:`零件 ${id} 重复分配`});assigned.add(id)}
    const a=stepAssembly(t,index),geometry=validateAssembly3D(a),components=componentCount(a)
    for(const i of geometry.issues)issues.push({stepId:s.id,code:'STEP_GEOMETRY',severity:'error',message:i.message})
    const connected=!!a.pieces.length&&components===1
    if(!connected)issues.push({stepId:s.id,code:'DISCONNECTED',severity:'warning',message:`本步有 ${components} 个组件，未满足 Connected Construction`})
    // Reuse the same Validator's ground check; this is only ground contact, not support simulation.
    const ground=validateAssembly3D(a,{checkGround:true})
    for(const i of ground.issues.filter(i=>i.code==='ground'))issues.push({stepId:s.id,code:'GROUND',severity:'warning',message:i.message})
    const grounded=createViewerModel(a).some(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion).some(v=>Math.abs(v.y)<=.02))
    if(!grounded)issues.push({stepId:s.id,code:'NO_GROUND_CONTACT',severity:'warning',message:'当前步骤没有接触地面；支撑与现实可搭建性尚未验证'})
    return {stepId:s.id,geometryValid:geometry.valid,connected,components,grounded}
  })
  const missing=t.assembly.pieces.filter(p=>!assigned.has(p.id))
  if(missing.length)issues.push({code:'UNASSIGNED',severity:'error',message:`尚有 ${missing.length} 片未安排到步骤：${missing.map(p=>p.id).join(', ')}`})
  if(!t.steps.length)issues.push({code:'NO_STEPS',severity:'error',message:'尚未创建步骤'})
  return {issues,finalValid:final.valid&&!!t.assembly.pieces.length,verified:!issues.length,steps}
}
export function tutorialMatchesAssembly(t: Tutorial3D,a: Assembly3D|null) {return !!a&&canonical(t.assembly)===canonical(a)}
export function serializeTutorial3D(t: Tutorial3D) {assertTutorial3D(t);return JSON.stringify(t)}
export function parseTutorial3D(raw: string): Tutorial3D {if(new TextEncoder().encode(raw).byteLength>2_000_000)fail('Tutorial JSON 超过 2 MB');const t=JSON.parse(raw);assertTutorial3D(t);return t}
