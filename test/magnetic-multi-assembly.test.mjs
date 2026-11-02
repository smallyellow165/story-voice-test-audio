import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {Box3,Vector3,Quaternion} from 'three'
import {arrangeAssemblyDisplays,displayAnnotationPieces,displayPieceKey,readAssemblyVisibility,saveAssemblyVisibility,ASSEMBLY_VISIBILITY_KEY} from '../src/magnetic-tiles/three-d/multi-assembly-display.ts'
import {pieceWorldVertices} from '../src/magnetic-tiles/three-d/vendor/components/magnet3d/cameraUtils.ts'
const example=JSON.parse(await readFile(new URL('../src/magnetic-tiles/three-d/examples/right-angle.json',import.meta.url),'utf8'))
const record=(id,assembly)=>({id,name:id,snapshotHash:id+'-hash',assembly})
const bounds=ps=>new Box3().setFromPoints(ps.flatMap(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion)))
test('deterministic independent display groups preserve exact poses, profiles, connections and shared Tile IDs',()=>{
 const active=structuredClone(example),other=structuredClone(example);other.id='other';const before=JSON.stringify([active,other])
 const first=arrangeAssemblyDisplays(active,[record(other.id,other)]),second=arrangeAssemblyDisplays(active,[record(other.id,other)])
 assert.deepEqual(first.map(a=>a.offset),second.map(a=>a.offset));assert.equal(JSON.stringify([active,other]),before)
 const local=first[0].pieces,world=displayAnnotationPieces(first);for(let i=0;i<world.length;i++){
  assert.equal(local[i].id,other.pieces[i].id);assert.deepEqual(local[i].transform.position.toArray(),other.pieces[i].pose.position)
  assert.deepEqual(world[i].transform.quaternion.toArray(),other.pieces[i].pose.quaternion)
  assert.equal(world[i].transform.position.distanceTo(local[i].transform.position),new Vector3(...first[0].offset).length())
  assert.notEqual(world[i].id,active.pieces[i].id)
 }
 assert.ok(bounds(world).min.x>bounds(arrangeAssemblyDisplays(active,[record('copy',active)])[0].pieces).max.x)
 assert.equal(world.length,other.pieces.length);assert.notEqual(displayPieceKey('a','b/c'),displayPieceKey('a/b','c'))
})
test('separation and camera bounds work with different root rotations and never accumulate offsets',()=>{
 const active=structuredClone(example),other=structuredClone(example),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/3)
 for(const p of other.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(new Vector3(30,-12,9)).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
 const a=arrangeAssemblyDisplays(active,[record('b',other),record('a',active)]),b=arrangeAssemblyDisplays(active,[record('a',active),record('b',other)])
 assert.deepEqual(a.map(g=>[g.id,g.offset]),b.map(g=>[g.id,g.offset]));const worlds=a.map(layer=>bounds(displayAnnotationPieces([layer])));assert.ok(worlds[1].min.x>worlds[0].max.x)
 for(const layer of a){const world=displayAnnotationPieces([layer]);assert.ok(Math.abs(world[0].transform.position.distanceTo(world[1].transform.position)-layer.pieces[0].transform.position.distanceTo(layer.pieces[1].transform.position))<1e-12)}
 assert.deepEqual(arrangeAssemblyDisplays(active,[]),[])
})
test('visibility is Project-scoped UI state and cannot mutate working Draft, lineage or active identity',()=>{
 const map=new Map([['draft','unchanged']]),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}
 assert.deepEqual(readAssemblyVisibility(store,'project-a','front'),{front:true});saveAssemblyVisibility(store,'project-a',{front:false,rear:true})
 assert.deepEqual(readAssemblyVisibility(store,'project-a','front'),{front:false,rear:true});assert.deepEqual(readAssemblyVisibility(store,'project-b','rear'),{rear:true});assert.equal(map.get('draft'),'unchanged');assert.equal(map.size,2)
 map.set(ASSEMBLY_VISIBILITY_KEY+'project-a','{"rear":"yes"}');assert.throws(()=>readAssemblyVisibility(store,'project-a','front'),/显示偏好/)
})
