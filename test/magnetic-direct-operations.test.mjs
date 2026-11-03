import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {generateBuildOrder3D} from '../src/magnetic-tiles/three-d/build-order.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {validateTutorial3D,serializeTutorial3D,parseTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave,generatedPreview} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
import {saveTutorial3D,loadTutorial3D} from '../src/magnetic-tiles/three-d/tutorial-storage.ts'
import {createInitialHistory,commit,undo,redo} from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
const fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/front-diagnostic-geometry.json',import.meta.url),'utf8')).assembly

test('Invalid collision geometry can generate, preview, save and reopen a Tutorial without permission; diagnostics stay strict',()=>{
 const a=structuredClone(fixture),before=structuredClone(a),geometry=validateAssembly3D(a)
 assert.equal(geometry.valid,false)
 const result=generateBuildOrder3D(a)
 assert.equal(result.status,'complete');assert.equal(result.finalGeometryValid,false);assert.equal(result.connectedConstruction,true)
 assert.equal('humanApproved' in result,false);assert.deepEqual(a,before)
 const t=generatedPreview(result,a);assert.ok(t);assert.equal(t.steps.length,a.pieces.length)
 const report=validateTutorial3D(t);assert.equal(report.finalValid,false);assert.equal(report.verified,false)
 assert.ok(report.issues.some(i=>i.severity==='error'&&i.code==='FINAL_GEOMETRY'))
 assert.ok(report.steps.some(s=>!s.geometryValid));assert.equal(tutorialReadyToSave(t,report,a),true)
 assert.equal('humanCollisionApproval' in t.source,false)
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}
 saveTutorial3D(storage,t,null);assert.deepEqual(loadTutorial3D(storage).tutorial,t)
 assert.deepEqual(validateAssembly3D(loadTutorial3D(storage).tutorial.assembly),geometry)
})

test('step coverage, duplicate assignment, source identity, connectivity and broken joints still have real checks',()=>{
 const a=structuredClone(fixture),t=generateBuildOrder3D(a).tutorial
 const missing=structuredClone(t);missing.steps.pop()
 assert.equal(tutorialReadyToSave(missing,validateTutorial3D(missing),a),false)
 const duplicate=structuredClone(t);duplicate.steps.push({...duplicate.steps[0],id:100,addedConnections:[]})
 assert.equal(tutorialReadyToSave(duplicate,validateTutorial3D(duplicate),a),false)
 assert.equal(tutorialReadyToSave(t,validateTutorial3D(t),{...a,revision:a.revision+1}),false)
 const wrong=structuredClone(a);wrong.connections[0].dihedralDeg+=15
 const result=generateBuildOrder3D(wrong);assert.equal(result.status,'invalid-assembly');assert.equal(result.finalGeometryValid,false)
 assert.ok(result.diagnostics.some(d=>d.code==='CONNECTION_CONSTRAINT_INVALID'))
})

test('legacy Tutorial approval references are ignored on read and omitted on new writes',()=>{
 const t=generateBuildOrder3D(fixture).tutorial,legacy=structuredClone(t)
 legacy.source.humanCollisionApproval={id:'retired',assemblyHash:'a'.repeat(64),diagnosticHash:'b'.repeat(64)}
 const loaded=parseTutorial3D(JSON.stringify(legacy))
 assert.deepEqual(loaded,t);assert.deepEqual(loaded.assembly,fixture)
 assert.equal(serializeTutorial3D(legacy).includes('humanCollisionApproval'),false)
 assert.equal(validateTutorial3D(loaded).finalValid,false)
})

test('edits and Undo/Redo need no review synchronization and retain exact source snapshots',()=>{
 const h=createInitialHistory(fixture),changed=commit(h,a=>{a.pieces[0].color='#123456';return a})
 assert.deepEqual(undo(changed).current,fixture)
 const restored=redo(undo(changed)).current;assert.deepEqual(restored,changed.current)
 const result=generateBuildOrder3D(restored)
 assert.equal(result.status,'complete');assert.deepEqual(result.tutorial.assembly,restored);assert.equal(result.finalGeometryValid,false)
})

test('retired review/token/approval API endpoints are absent and create no approval records',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-no-review-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const api=createMagneticIntake(dir)
 for(const action of ['session','status','sync','accept','approve','accept-diagnostic','restore-saved','revalidate','generate','saveTutorial'])await assert.rejects(api.dispatch('POST','assembly3d-review/'+action,{assembly:fixture}),e=>e.statusCode===404)
})
