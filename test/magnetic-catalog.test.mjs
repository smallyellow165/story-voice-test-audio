import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles,profileSpec,profileSizeLabel} from '../src/magnetic-tiles/profiles.ts'
import {edges,profileIssues} from '../src/magnetic-tiles/geometry.ts'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'
import {prompt,recognitionSchema,recognitionRequest} from '../server/magnetic-intake-vision.mjs'

test('Catalog drives exact Vision facts, output choices and Geometry edges',()=>{
 assert.ok(prompt.includes(JSON.stringify(profiles.map(profileSpec))))
 const fields=recognitionSchema.properties.observations.items.properties
 assert.deepEqual(fields.profileId.enum,[...new Set(profiles.map(p=>p.id)),'unknown'])
 assert.deepEqual(fields.profileVersion.enum,[...new Set([1,...profiles.map(p=>p.version)])])
 for(const p of profiles){
  assert.deepEqual(profileIssues(p),[])
  const actual=edges({id:'t',profileId:p.id,profileVersion:p.version,pose:{x:0,y:0,angleRad:0}},profiles)
  assert.deepEqual(profileSpec(p).edges.map(e=>[e.id,e.length,e.connectable]),actual.map(e=>[e.id,e.length,e.enabled]))
 }
 const request=recognitionRequest('gpt-4.1',{width:100,height:100,mimeType:'image/png',imageBase64:''})
 assert.deepEqual(request.text.format.schema.properties.observations.items.properties.profileId.enum,fields.profileId.enum)
})
test('Observation validates Catalog identity pairs and preserves explicit unknown',()=>{
 const evidence=(id,version)=>({sourceKind:'diagram',reason:'',observations:[{id:'a',profileId:id,profileVersion:version,color:'#ff0000',outline:[[0,0],[1,0],[0,1]],confidence:.5,evidence:'',uncertainty:'',origin:'observed',excluded:false}],relations:[]})
 for(const p of profiles)assert.equal(parseEvidence(evidence(p.id,p.version)).observations[0].profileId,p.id)
 assert.equal(parseEvidence(evidence('unknown',1)).observations[0].profileId,'unknown')
 assert.throws(()=>parseEvidence(evidence('invented',1)))
 assert.throws(()=>parseEvidence(evidence(profiles[0].id,999)))
 assert.throws(()=>parseEvidence(evidence('unknown',2)))
})
test('Derived measurements support another convex profile without shape-name logic',()=>{
 const p={id:'test-rectangle',version:2,name:'测试',vertices:[[0,0],[2,0],[2,1],[0,1]],connectableEdges:['e0','e2']}
 assert.deepEqual(profileSpec(p).edges.map(e=>e.length),[2,1,2,1])
 assert.equal(profileSizeLabel(p),'边长 2 / 1 / 2 / 1')
 assert.deepEqual(profileSpec(p).edges.filter(e=>e.connectable).map(e=>e.id),['e0','e2'])
})
