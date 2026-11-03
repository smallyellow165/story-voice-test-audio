import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {confirmSymmetryFill,previewSymmetryFill,proposeSymmetryPlane} from '../src/magnetic-tiles/three-d/symmetry-fill.ts'
import {createInitialHistory,undo,redo} from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {generateBuildOrder3D} from '../src/magnetic-tiles/three-d/build-order.ts'
import {validateTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
import {saveDraft3D,loadDraft3D} from '../src/magnetic-tiles/three-d/draft-storage.ts'
const file=new URL('../generated/magnetic-intake/visible3d/executions/21b18495-3ff3-4d5f-95d3-dc7902ea7cb7.json',import.meta.url),raw=await readFile(file,'utf8'),a=JSON.parse(raw).diagnosticCandidates.find(d=>d.assembly.pieces.length===6).assembly

test('symmetry 6 → 9 tiles preserves poses, joints, strict collisions, Undo/Redo, save and direct Tutorial generation',async()=>{
 const ids=['tile2','tile3','tile4'],preview=previewSymmetryFill(a,{sourceIds:ids,plane:proposeSymmetryPlane(a,ids),planeMode:'auto'}),h=confirmSymmetryFill(createInitialHistory(a),preview),nine=h.current
 assert.equal(nine.pieces.length,9);assert.equal(nine.connections.length,12);assert.deepEqual(nine.pieces.slice(0,6),a.pieces);assert.deepEqual(nine.connections.slice(0,7),a.connections)
 assert.deepEqual(undo(h).current,a);assert.deepEqual(redo(undo(h)).current,nine)
 const geometry=validateAssembly3D(nine);assert.equal(geometry.valid,false);assert.equal(geometry.issues.filter(i=>i.code==='intersection').length,8)
 const result=generateBuildOrder3D(nine);assert.equal(result.status,'complete');assert.equal(result.tutorial.steps.length,9);assert.equal(result.finalGeometryValid,false)
 assert.deepEqual(result.tutorial.assembly,nine);assert.equal(tutorialReadyToSave(result.tutorial,validateTutorial3D(result.tutorial),nine),true)
 const storage={raw:null,getItem(){return this.raw},setItem(_k,v){this.raw=v}};saveDraft3D(storage,nine,null);assert.deepEqual(loadDraft3D(storage).assembly,nine)
 assert.deepEqual(validateAssembly3D(nine),geometry);assert.equal(await readFile(file,'utf8'),raw)
})
