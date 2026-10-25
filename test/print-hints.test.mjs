import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {observationPrintHints,applyPrintHint} from '../src/brick-vision/print-hints.mjs'
import {observationCatalogFields,catalogSearchParams} from '../src/brick-vision/catalog-features.mjs'
test('saved penguin explicit graphic evidence supplies hint independently of ID',async()=>{
 const r=JSON.parse(await readFile(new URL('../generated/brick-reverse/80a0ad1a-db21-4f5d-ba3b-96215e1aed83.json',import.meta.url)))
 const o=r.analysis.observations.find(o=>o.id==='eye_block'),before=JSON.stringify(o)
 const hints=observationPrintHints({...o,id:'unrelated'})
 assert.equal(hints[0].term,'eye');assert.equal(hints[0].status,'ungraded-text');assert.equal(hints[0].evidence,o.evidence)
 assert.equal(JSON.stringify(o),before)
 assert.deepEqual(observationPrintHints({...o,evidence:'A rectangular region.'}),[])
})
test('explicit print motifs generalize; uncertain, negated and ID-only claims stay unknown',()=>{
 for(const [term,evidence] of [['mouth','A printed mouth is visible.'],['face','The face graphic is on the side.'],['number','The printed number is clear.'],['eye','Printed eyes on a rectangular surface.']])assert.equal(observationPrintHints({evidence})[0].term,term)
 for(const evidence of ['Possibly an eye graphic.','No printed eyes are visible.','A face-shaped brick.','An eye shaped opening.','An unknown graphic may be an eye.'])assert.deepEqual(observationPrintHints({id:'eye_block',evidence}),[])
 assert.deepEqual(observationPrintHints({id:'eye_block',color:'printed eye'}),[])
})
test('retrieval snapshot keeps dimensions, color, shape, explicit no-print and does not confirm',()=>{
 const fields=observationCatalogFields({color_id:0,size:null,width_studs:2,depth_studs:2,height_brick_units:1,shape:'brick',print:'unknown'})
 const hinted=applyPrintHint(fields,observationPrintHints({evidence:'An eye graphic is visible.'})[0])
 assert.deepEqual(catalogSearchParams(hinted),{search:'eye',color:'0',size:'2×2×1',shape:'brick',printed:'yes',require_ldraw:'false'})
 assert.equal(fields.search,'');assert.equal(fields.printed,'unknown');assert.equal(hinted.confirmed,undefined)
 assert.equal(applyPrintHint({...fields,printed:'no'},{term:'eye'}).printed,'no')
})
