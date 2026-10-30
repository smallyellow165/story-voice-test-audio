import test from 'node:test'
import assert from 'node:assert/strict'
import {readStudioUrl} from '../src/magnetic-tiles/studio-url.ts'
test('Studio deep links retain stable IDs and reject path-like/invalid parameters',()=>{
 const r=readStudioUrl('http://localhost/?stage=review&sourceId='+ 'a'.repeat(64)+'&analysisId=abc-def&reviewId=r1&observationId=p6')
 assert.deepEqual(r.errors,[]);assert.equal(r.values.observationId,'p6');assert.equal(r.values.reviewId,'r1')
 for(const stage of ['source','review','reconstruction','assembly','build'])assert.equal(readStudioUrl('http://localhost/?stage='+stage).values.stage,stage)
 for(const value of ['../secret','/etc/passwd','a/b','', 'x'.repeat(101)]){
  const bad=readStudioUrl('http://localhost/?sourceId='+encodeURIComponent(value));assert.equal(bad.errors.length,1);assert.equal(bad.values.sourceId,undefined)
 }
 assert.equal(readStudioUrl('http://localhost/?stage=other').errors.length,1)
})

import {resolveIntakePreferences} from '../src/magnetic-tiles/studio-url.ts'
test('Intake preferences: explicit URL > recent preference > available registered default',()=>{
 const config={models:[{id:'gpt-4.1',provider:'openai'},{id:'future.registered-model',provider:'openai'},{id:'disabled',provider:'offline'}],providers:{openai:true,offline:false}}
 const saved={sourceType:'uploaded',model:'gpt-4.1'}
 const explicit=resolveIntakePreferences('http://localhost/?sourceType=server&model=future.registered-model',saved,config)
 assert.equal(explicit.sourceType,'server');assert.equal(explicit.model,'future.registered-model')
 assert.equal(resolveIntakePreferences('http://localhost/',{sourceType:'server',model:'future.registered-model'},config).model,'future.registered-model')
 assert.equal(resolveIntakePreferences('http://localhost/',null,config).model,'gpt-4.1')
 for(const model of ['unknown','disabled','']){
  const r=resolveIntakePreferences('http://localhost/?model='+model,saved,config);assert.equal(r.model,'');assert.match(r.warnings.model,/URL/)
 }
 assert.equal(resolveIntakePreferences('http://localhost/?sourceType=invalid',saved,config).sourceType,'')
 assert.equal(resolveIntakePreferences('http://localhost/',{model:'removed'},config).model,'')
})
