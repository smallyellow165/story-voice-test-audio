import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {Vector3} from 'three'
import {geometryIssueReferences,geometryIssueVisual} from '../../src/magnetic-tiles/three-d/reconstruction/diagnostic-visual.ts'
import {createViewerModel} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import type {ValidationIssue} from '../../src/magnetic-tiles/three-d/vendor/engine/types.ts'
const f=JSON.parse(readFileSync(new URL('./fixtures/front-diagnostic-geometry.json',import.meta.url),'utf8'))
describe('read-only saved Diagnostic error locations',()=>{
 it('resolves all six recorded port conflicts to exact ports and every involved real connection',()=>{
  const before=JSON.stringify(f),issues=f.geometry.issues.filter((i:ValidationIssue)=>i.code==='port-reuse')
  expect(issues).toHaveLength(6)
  for(const issue of issues){const visual=geometryIssueVisual(f.assembly,issue,f.collisions,'front');expect(visual.connectionIndices).toHaveLength(2);expect(visual.pieceIds).toContain(issue.pieceId);expect(visual.segments).toHaveLength(3);expect(visual.collision).toBeUndefined();expect(visual.focusVertices.length).toBeGreaterThan(0)
   const p=createViewerModel(f.assembly).find(p=>p.id===issue.pieceId)!,port=p.shape.ports.find(p=>p.portId===issue.portId)!,segment=visual.segments.find(s=>s.id===JSON.stringify([p.id,port.portId]))!
   expect(segment.points).toEqual([port.p0,port.p1].map(v=>new Vector3(v.x,v.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position).toArray()))
   for(const i of visual.connectionIndices)expect(visual.connections).toContain(f.assembly.connections[i])
  }
  expect(JSON.stringify(f)).toBe(before)
 })
 it('uses the four saved exact prism intersections; does not infer radius from SAT depth',()=>{
  const issues=f.geometry.issues.filter((i:ValidationIssue)=>i.code==='intersection');expect(issues).toHaveLength(4)
  for(const issue of issues){const v=geometryIssueVisual(f.assembly,issue,f.collisions,'front').collision!,e=f.collisions.find((e:{pieceIds:string[]})=>JSON.stringify(e.pieceIds)===JSON.stringify(issue.relatedPieceIds))
   expect(v.kind).toBe('volume');expect(v.vertices).toEqual(e.intersectionVertices);expect(v.volume).toBeGreaterThan(0);expect(v.bounds).toEqual(e.region);expect(v.sourceKey).toBe('front')
   const changed=structuredClone(e);changed.penetrationDepth=100
   expect(geometryIssueVisual(f.assembly,issue,[changed],'other').collision!.positions).toEqual(v.positions)
  }
 })
 it('highlights an indexed dihedral/position error connection without claiming an error volume',()=>{
  for(const code of ['loop-dihedral-error','loop-position-error','loop-direction-error','port-length','port-missing']){
   const issue:ValidationIssue={modelId:f.assembly.id,code,message:'offline location fixture',severity:'error',connectionIndex:2}
   const v=geometryIssueVisual(f.assembly,issue,[],'angle');expect(v.connectionIndices).toEqual([2]);expect(v.pieceIds).toEqual([f.assembly.connections[2].pieceA,f.assembly.connections[2].pieceB]);expect(v.segments).toHaveLength(2);expect(v.collision).toBeUndefined()
  }
 })
 it('locates non-root disconnected components using the actual graph, not the message text',()=>{
  const a=structuredClone(f.assembly);a.connections=a.connections.filter((c:{pieceA:string;pieceB:string})=>c.pieceA!=='p23'&&c.pieceB!=='p23')
  const report=validateAssembly3D(a,{requireConnected:true}),issue=report.issues.find(i=>i.code==='unconnected')!
  expect(issue).toBeDefined();expect(geometryIssueReferences(a,{...issue,message:'do not parse this'}).pieceIds).toEqual(['p23'])
 })
 it('missing region data/unknown errors only locate known pieces; no new Validator result is generated',()=>{
  const issue=f.geometry.issues.find((i:ValidationIssue)=>i.code==='intersection')!,v=geometryIssueVisual(f.assembly,issue,[],'missing')
  expect(v.collision).toBeUndefined();expect(v.pieceIds).toEqual(issue.relatedPieceIds);expect(v.focusVertices.length).toBeGreaterThan(0)
  const unknown=geometryIssueVisual(f.assembly,{modelId:'unknown',code:'other',pieceId:'not-in-snapshot',severity:'error',message:'unlocatable'},[],'unknown');expect(unknown.pieceIds).toEqual([]);expect(unknown.segments).toEqual([]);expect(unknown.focusVertices).toEqual([]);expect(unknown.collision).toBeUndefined()
 })
})
