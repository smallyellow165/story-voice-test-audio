import {describe,it,expect} from 'vitest'
import pair from '../../src/magnetic-tiles/three-d/examples/right-angle.json'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {generateBuildOrder3D} from '../../src/magnetic-tiles/three-d/build-order.ts'
import {validateTutorial3D,serializeTutorial3D} from '../../src/magnetic-tiles/three-d/tutorial.ts'
import {generatedPreview,tutorialReadyToSave} from '../../src/magnetic-tiles/three-d/tutorial-workflow.ts'
import {TUTORIAL_3D_KEY,loadTutorial3D,saveTutorial3D,openSavedTutorial3D} from '../../src/magnetic-tiles/three-d/tutorial-storage.ts'
const assembly=parseAssembly3D(JSON.stringify(pair))
const complete=()=>generateBuildOrder3D(assembly)
function storage(initial:string|null=null){const values=new Map<string,string>();if(initial!==null)values.set(TUTORIAL_3D_KEY,initial);return {values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}}
describe('tutorial UI preview acceptance',()=>{
 it('previews complete validated results without converting review-required into a stability claim',()=>{
  const result=complete(),before=JSON.stringify(result),snapshot=JSON.stringify(assembly)
  expect(generatedPreview(result,assembly)).toEqual(result.tutorial)
  expect(result.buildabilityEstimate).toBe('review-required');expect(result.physicalStability).toBe('not-assessed')
  expect(JSON.stringify(result)).toBe(before);expect(JSON.stringify(assembly)).toBe(snapshot)
 })
 it('rejects source revision/content mismatches, incomplete searches and invalid tutorial edits',()=>{
  const result=complete(),t=result.tutorial!
  expect(generatedPreview(result,{...assembly,revision:assembly.revision+1})).toBeNull()
  const changed=structuredClone(assembly);changed.pieces[0].color='#abcdef';expect(generatedPreview(result,changed)).toBeNull()
  expect(generatedPreview(generateBuildOrder3D(assembly,{maxEvaluations:0}),assembly)).toBeNull()
  const incomplete=structuredClone(t);incomplete.steps.pop();expect(tutorialReadyToSave(incomplete,validateTutorial3D(incomplete),assembly)).toBe(false)
  const invalid=structuredClone(t);invalid.assembly.pieces[1].pose=structuredClone(invalid.assembly.pieces[0].pose)
  expect(tutorialReadyToSave(invalid,validateTutorial3D(invalid),invalid.assembly)).toBe(false)
 })
})
describe('same-key tutorial saved collection',()=>{
 it('reads legacy bytes without migration and retains them when another tutorial is explicitly saved',()=>{
  const legacy=complete().tutorial!,raw=serializeTutorial3D(legacy),s=storage(raw)
  expect(loadTutorial3D(s).tutorial).toEqual(legacy);expect(s.getItem(TUTORIAL_3D_KEY)).toBe(raw)
  const next={...structuredClone(legacy),id:'another-tutorial',title:'第二个教程'}
  const saved=saveTutorial3D(s,next,raw),loaded=loadTutorial3D(s)
  expect(loaded.saved).toEqual([next,legacy]);expect(loaded.tutorial).toEqual(next)
  const opened=openSavedTutorial3D(s,legacy.id,saved);expect(opened.tutorial).toEqual(legacy)
  expect(loadTutorial3D(s).saved).toEqual([next,legacy])
 })
 it('updates a saved ID explicitly, preserves other tutorials and rejects stale opens/saves and quota failures',()=>{
  const a=complete().tutorial!,b={...structuredClone(a),id:'second'},s=storage()
  const first=saveTutorial3D(s,a,null),second=saveTutorial3D(s,b,first)
  const edited={...structuredClone(a),title:'修改后的标题'},third=saveTutorial3D(s,edited,second)
  expect(loadTutorial3D(s).saved).toEqual([edited,b])
  expect(()=>openSavedTutorial3D(s,b.id,second)).toThrow('其他页面')
  expect(()=>saveTutorial3D(s,b,second)).toThrow('其他页面')
  expect(()=>saveTutorial3D({...s,setItem:()=>{throw Error('quota')}},b,third)).toThrow('quota')
  expect(s.getItem(TUTORIAL_3D_KEY)).toBe(third)
  expect(()=>openSavedTutorial3D(s,'missing',third)).toThrow('不存在')
  expect([...s.values.keys()]).toEqual([TUTORIAL_3D_KEY])
 })
 it('never replaces damaged history and continues allowing explicitly unverified draft storage',()=>{
  const s=storage('{"schemaVersion":1,"current":{},"saved":[]}'),raw=s.getItem(TUTORIAL_3D_KEY)
  expect(()=>loadTutorial3D(s)).toThrow();expect(()=>saveTutorial3D(s,complete().tutorial!,raw)).toThrow();expect(s.getItem(TUTORIAL_3D_KEY)).toBe(raw)
  const t=complete().tutorial!;t.steps=[];const draft=storage();saveTutorial3D(draft,t,null)
  expect(loadTutorial3D(draft).tutorial).toEqual(t);expect(validateTutorial3D(t).verified).toBe(false)
 })
})
