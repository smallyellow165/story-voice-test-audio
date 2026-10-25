import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { solveGeometry, assessRelations } from '../experiments/geometry-solver/solver.mjs'
import { inputFromSavedAnalysis } from '../experiments/geometry-solver/input.mjs'
const camelText = await readFile(new URL('../experiments/geometry-solver/camel.fixture.json',import.meta.url),'utf8')
const rules = await loadBrickRules()
const limits = { beamWidth: 32, maxExpansions: 30000, maxMs: 60000 }
const small = () => ({ inventory:[{part:'3437',color:'14',quantity:2}], observations:[{id:'bottom',part:'3437',color:'14'},{id:'top',part:'3437',color:'14'}],
  relations:[{from:'bottom',to:'top',relation:'supports',status:'inferred',confidence:0.9}] })
test('generic search finds actual interface-aligned, collision-free placements deterministically', () => {
  const input=small(), before=structuredClone(input)
  const a=solveGeometry(input,rules,limits), b=solveGeometry(input,rules,limits)
  assert.equal(a.status,'candidates_found')
  assert.deepEqual(a.candidates,b.candidates)
  assert.deepEqual(input,before)
  assert.equal(a.candidates[0].reference.score,1)
  assert.ok(a.candidates.every(c=>c.geometry.valid))
  assert.deepEqual(Object.keys(a.candidates[0].observationPlacements).sort(),['bottom','top'])
})
test('conflicting and Unknown evidence is reported rather than promoted to hard truth', () => {
  const input=small()
  input.relations.push({from:'top',to:'bottom',relation:'supports',status:'observed',confidence:0.9})
  input.relations.push({from:'bottom',to:'top',relation:'left',status:'unknown',confidence:1})
  const result=solveGeometry(input,rules,limits)
  assert.equal(result.status,'candidates_found')
  assert.ok(result.candidates.every(c=>c.reference.violated>=1 && c.reference.score<1))
  assert.ok(result.candidates[0].reference.relations.some(r=>r.evidence.status==='unknown' && r.weight===0))
})
test('inventory, absent evidence, bounded-domain failure and budget exhaustion are distinct', () => {
  const input=small()
  assert.equal(solveGeometry({...input,inventory:[]},rules).status,'infeasible_input')
  assert.equal(solveGeometry({...input,relations:[]},rules).status,'insufficient_information')
  assert.equal(solveGeometry(input,rules,{...limits,maxTop:0.1}).status,'no_candidate_in_explored_domain')
  assert.equal(solveGeometry(input,rules,{...limits,maxExpansions:1}).termination,'expansion_budget')
  assert.throws(()=>solveGeometry(input,rules,{beamWidth:0}),/Invalid budget/)
})
test('saved mapping adapter refuses missing official evidence and never reads generated placements', () => {
  const analysis={id:'analysis',status:'complete',analysis:{observations:[{id:'neck'}],relations:[]}}
  const mapping={source:{part_num:'4066',color_id:14},target:{part:'4066a',color:'14'},errors:[],
    evidence:{part:{source:'rb_part_mappings',mappings:[{part_num:'4066',ext_system:'LD',ext_id:'4066a'}]}},
    partCandidateChecks:[{part:'4066a',eligible:true,local:{available:true}}]}
  const trace={id:'saved',reference:{analysisId:'analysis',review:{neck:{quantity:'1',excluded:false,confirmedPart:{part_num:'4066',color_id:14}}}},inventorySource:{mapping:[mapping]},requestInput:{inventory:[{part:'4066a',color:'14',quantity:1}]}}
  const result=inputFromSavedAnalysis(analysis,trace)
  assert.equal(result.observations[0].part,'4066a')
  trace.design={bricks:[{x:999}]}
  assert.deepEqual(inputFromSavedAnalysis(analysis,trace),result)
  mapping.evidence.part.mappings=[]
  assert.throws(()=>inputFromSavedAnalysis(analysis,trace),/official mapping/)
})
test('seven-part camel: body plates directly stack; legs ground; final geometry separate from prefix policy', () => {
  // Coordinates are calculated by the same generic search, never stored in this fixture.
  const input=JSON.parse(camelText)
  const result=solveGeometry(input,rules,{beamWidth:128,maxExpansions:1000000,maxMs:120000,maxCandidates:16})
  const candidate=result.candidates.find(c=>c.reference.violated===0 && c.hints.every(h=>h.satisfied) && c.support.every(s=>s.passesExistingThreshold)
    && c.observationPlacements.left_leg.layer===0 && c.observationPlacements.right_leg.layer===0)
  assert.ok(candidate,JSON.stringify({status:result.status,termination:result.termination,stats:result.stats,scores:result.candidates.map(c=>c.reference.score)}))
  assert.equal(candidate.design.bricks.length,7)
  assert.equal(candidate.geometry.valid,true)
  assert.ok(candidate.geometry.connections.some(c=>c.lowerId==='lower_horizontal' && c.upperId==='upper_horizontal'))
  assert.equal(candidate.observationPlacements.upper_horizontal.layer-candidate.observationPlacements.lower_horizontal.layer,0.5)
  assert.ok(candidate.buildOrder.report.issues.some(i=>i.code==='BUILD_ORDER'))
  assert.equal(candidate.buildOrder.report.usage.some(r=>r.remaining!==0),false)
  // Existing 50% rule: a lone tall leg offers 2 of a thin plate's 8 sockets.
  assert.equal(rules.footprint(candidate.observationPlacements.lower_horizontal).length,8)
  assert.equal(rules.connectors(candidate.observationPlacements.left_leg,'top').length,2)
  assert.equal(assessRelations(candidate.design.bricks,input.relations,rules,input.hints).filter(r=>r.satisfied===false).length,0)
})
