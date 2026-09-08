import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRingHistory } from '../server/ring-history.mjs'

test('history persists full detection across store instances; summary excludes image; invalid IDs rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ring-history-'))
  try {
    const store = createRingHistory(dir)
    const result = { model: 'gemini-3.6-flash', rings: [], rawJson: '{"rings":[]}' }
    const input = { width: 600, height: 338, mimeType: 'image/jpeg', imageBase64: 'dGVzdA==' }
    const [first, second] = await Promise.all([store.save(result,input), store.save(result,input)])
    assert.notEqual(first.id,second.id)
    const restarted = createRingHistory(dir)
    const list = await restarted.list()
    assert.equal(list.length,2)
    assert.equal(list[0].snapshot,undefined)
    const loaded = await restarted.load(first.id)
    assert.deepEqual(loaded.rings,result.rings)
    assert.equal(loaded.rawJson,result.rawJson)
    assert.deepEqual(loaded.snapshot,{mimeType:input.mimeType,imageBase64:input.imageBase64})
    assert.equal(loaded.width,600)
    await assert.rejects(restarted.load('../secret'),{statusCode:400})
    await assert.rejects(restarted.load('00000000-0000-0000-0000-000000000000'),{statusCode:404})
    await assert.rejects(store.save({...result,error:'failed'},input))
    assert.equal((await restarted.list()).length,2)
  } finally { await rm(dir,{recursive:true,force:true}) }
})

test('ring names survive reload without changing IDs/geometry; rejects unknown IDs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ring-names-'))
  try {
    const store = createRingHistory(dir)
    const ring = {id:'ring_1',center:{x:.5,y:.5},bbox:{xMin:0,yMin:0,xMax:1,yMax:1},
      polygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],colorGuess:'white',confidence:.9,explanation:'test'}
    const saved = await store.save({model:'gemini-3.6-flash',rings:[ring],rawJson:'original'},
      {width:600,height:338,mimeType:'image/jpeg',imageBase64:'dGVzdA=='})
    await store.renameRings(saved.id,{ring_1:'白色圈'})
    const loaded = await createRingHistory(dir).load(saved.id)
    assert.deepEqual(loaded.ringNames,{ring_1:'白色圈'})
    assert.deepEqual(loaded.rings,[ring])
    assert.equal(loaded.rawJson,'original')
    await assert.rejects(store.renameRings(saved.id,{wrong:'黑色圈'}),{statusCode:400})
    await assert.rejects(store.renameRings(saved.id,{ring_1:'x'.repeat(81)}),{statusCode:400})
  } finally {await rm(dir,{recursive:true,force:true})}
})
