import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles,profileKey} from '../src/magnetic-tiles/profiles.ts'
import {readStudioUrl,workflowStages} from '../src/magnetic-tiles/studio-url.ts'
import {resolvePanelState} from '../src/magnetic-tiles/studio-panel-state.ts'
const first=profileKey(profiles[0]),large='large-equilateral-triangle@1',tall='tall-right-triangle@1'

test('legacy Catalog URLs normalize to five real stages without changing snapshot identities',()=>{
 assert.equal(workflowStages.length,5);assert.ok(!workflowStages.includes('catalog'))
 for(const [context,expected] of [['','assembly'],['sourceId=source','source'],['analysisId=analysis','source'],['reviewId=review&analysisId=analysis&observationId=p1','review'],['reconstructionId=reconstruction&candidateId=c1&reviewId=review','reconstruction'],['assemblyId=assembly&reviewId=review','assembly'],['buildId=build&assemblyId=assembly','build']]){
  const href='http://localhost/?stage=catalog&'+context,r=readStudioUrl(href),state=resolvePanelState(href,{})
  assert.deepEqual(r.errors,[]);assert.equal(r.values.stage,expected);assert.equal(state.stage,expected);assert.equal(state.rightTab,'catalog')
  for(const [key,value] of new URL(href).searchParams)if(key!=='stage')assert.equal(r.values[key],value)
 }
})
test('explicit URL Tab/Profile wins over browser preference while all work identities stay authoritative',()=>{
 const href=`http://localhost/?stage=review&sourceId=source&analysisId=analysis&reviewId=review&observationId=p1&rightTab=catalog&catalogProfile=${large}`,saved={rightTab:'inspector',catalogProfile:tall,lastStage:'build'}
 const state=resolvePanelState(href,saved)
 assert.equal(state.stage,'review');assert.equal(state.rightTab,'catalog');assert.equal(state.catalogProfile,large);assert.deepEqual(state.warnings,[])
 assert.deepEqual(readStudioUrl(href).values,{stage:'review',sourceId:'source',analysisId:'analysis',reviewId:'review',observationId:'p1'})
 assert.equal(resolvePanelState('http://localhost/?stage=source',{rightTab:'catalog',catalogProfile:tall,lastStage:'review'}).catalogProfile,tall)
 assert.equal(resolvePanelState('http://localhost/?stage=source',saved).stage,'source')
})
test('bare old Catalog links use a valid remembered work stage; ordinary bare URLs retain Assembly default',()=>{
 const saved={rightTab:'inspector',catalogProfile:tall,lastStage:'review'}
 assert.equal(resolvePanelState('http://localhost/?stage=catalog',saved).stage,'review')
 assert.equal(resolvePanelState('http://localhost/',saved).stage,'assembly')
 assert.equal(resolvePanelState('http://localhost/?stage=catalog&reviewId=r',{...saved,lastStage:'build'}).stage,'review')
 assert.equal(resolvePanelState('http://localhost/?stage=catalog&rightTab=inspector',saved).rightTab,'catalog')
})
test('invalid visual preferences are reported without rejecting independent URL snapshots or inventing profiles',()=>{
 const href='http://localhost/?stage=review&reviewId=r&rightTab=bad&catalogProfile=removed@99',r=readStudioUrl(href),state=resolvePanelState(href,{})
 assert.deepEqual(r.errors,[]);assert.equal(r.values.reviewId,'r');assert.equal(state.stage,'review');assert.equal(state.rightTab,'inspector');assert.equal(state.catalogProfile,first);assert.equal(state.warnings.length,2)
 for(const saved of [null,{},'broken',{rightTab:'bad',catalogProfile:'invented@1',lastStage:'catalog'}]){
  const s=resolvePanelState('http://localhost/?stage=catalog',saved);assert.ok(workflowStages.includes(s.stage));assert.ok(profiles.some(p=>profileKey(p)===s.catalogProfile))
 }
})
