import test from 'node:test'
import assert from 'node:assert/strict'
import {readStudioUrl} from '../src/magnetic-tiles/studio-url.ts'
test('Studio deep links retain stable IDs and reject path-like/invalid parameters',()=>{
 const r=readStudioUrl('http://localhost/?stage=review&sourceId='+ 'a'.repeat(64)+'&analysisId=abc-def&reviewId=r1&observationId=p6')
 assert.deepEqual(r.errors,[]);assert.equal(r.values.observationId,'p6');assert.equal(r.values.reviewId,'r1')
 for(const stage of ['source','review','reconstruction','assembly','build','catalog'])assert.equal(readStudioUrl('http://localhost/?stage='+stage).values.stage,stage)
 for(const value of ['../secret','/etc/passwd','a/b','', 'x'.repeat(101)]){
  const bad=readStudioUrl('http://localhost/?sourceId='+encodeURIComponent(value));assert.equal(bad.errors.length,1);assert.equal(bad.values.sourceId,undefined)
 }
 assert.equal(readStudioUrl('http://localhost/?stage=other').errors.length,1)
})
