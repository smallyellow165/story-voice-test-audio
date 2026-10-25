import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promptVersion, validatePlan, assessConversion } from '../experiments/spatial-planning/plan.mjs'
import { buildSpatialRequest, prepareInput, prepareReferenceImage } from '../experiments/spatial-planning/input.mjs'
import { renderReport } from '../experiments/spatial-planning/report.mjs'
import { runSpatialPlanning } from '../experiments/spatial-planning/runner.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'

const exact = v => ({min:v,max:v})
function fixture() {
  const input={observations:['a','b'].map(id => ({id,part:'3437',color:'14',geometry:{top:[{}],bottom:[{}]}}))}
  const plan={version:promptVersion,scene:{method:'near_planar',cameraEvidence:'edges',depthAxisEvidence:'top studs',scaleEvidence:'known brick',unknowns:[]},
    parts:['a','b'].map((id,i) => ({id,role:'body',image:{bbox:[0.1,0.2,0.5,0.6],features:[],occlusion:'underside'},
      pose:{relativeTo:i?'a':null,offsetLdu:{x:exact(i*40),y:exact(i*48),z:exact(0)},yawCandidates:[0],upright:true,evidence:'visible seam',confidence:0.7,unknowns:[]},
      connections:[]})),relations:[],alternatives:[],missingGeometry:[]}
  return {input,plan}
}
test('repeated part numbers retain instance identities; immutable diagnostics', () => {
  const {input,plan}=fixture(), before=JSON.stringify(plan)
  assert.equal(validatePlan(plan,input).valid,true)
  const result=assessConversion(plan,input)
  assert.equal(result.status,'single_pose_hypothesis')
  assert.equal(result.geometryStatus,'not_run')
  assert.deepEqual(result.candidates[1].worldOffsetLdu.x,exact(40))
  assert.equal(JSON.stringify(plan),before)
})
test('missing, duplicate, invented identity and build steps are rejected', () => {
  for (const edit of [p=>p.parts.pop(),p=>p.parts[1].id='a',p=>p.parts[1].id='invented',p=>p.steps=[]]) {
    const {input,plan}=fixture(); edit(plan); assert.equal(validatePlan(plan,input).valid,false)
  }
})
test('unknown depth and ambiguous yaw remain unresolved, never zero-filled', () => {
  const {input,plan}=fixture()
  plan.parts[1].pose.offsetLdu.z=null
  plan.parts[1].pose.yawCandidates=[90,270]
  const result=assessConversion(plan,input)
  assert.equal(result.status,'needs_resolution')
  assert.equal(result.candidates[1].worldOffsetLdu.z,null)
  assert.equal(plan.parts[1].pose.offsetLdu.z,null)
})
test('cycles, unknown references, nonzero anchor and malformed ranges fail', () => {
  for (const edit of [p=>p.parts[1].pose.relativeTo='b',p=>p.parts[1].pose.relativeTo='ghost',
    p=>p.parts[0].pose.offsetLdu.x=exact(4),p=>p.parts[1].pose.offsetLdu.x={min:10,max:2},
    p=>p.parts[1].image.bbox=[0.9,0.2,0.1,0.8]]) {
    const {input,plan}=fixture(); edit(plan); assert.equal(validatePlan(plan,input).valid,false)
  }
})
test('hidden connectors may remain null but fabricated indices fail', () => {
  const {input,plan}=fixture()
  const c={other:'a',intent:'mates',ownSurface:'bottom',otherSurface:'top',ownConnector:null,otherConnector:null,visibility:'inferred',evidence:'hidden seam'}
  plan.parts[1].connections=[c]
  assert.equal(validatePlan(plan,input).valid,true)
  assert.equal(assessConversion(plan,input).hiddenConnections.length,1)
  c.ownConnector=1
  assert.equal(validatePlan(plan,input).valid,false)
})
test('report escapes model text and never claims geometry passed', () => {
  const {input,plan}=fixture(); plan.parts[0].role='<script>alert(1)</script>'
  const html=renderReport({id:'test',plan,requestInput:input,validation:validatePlan(plan,input),rawOutput:'<script>bad()</script>'})
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('Geometry / Build Order'))
})
test('provider requests contain photo and planning contract, not Generator build order', () => {
  const prepared={input:fixture().input,image:{mimeType:'image/png',imageBase64:'AAAA'}}
  const openai=buildSpatialRequest('gpt-4.1',prepared)
  assert.equal(openai.input[0].content[1].image_url,'data:image/png;base64,AAAA')
  assert.match(openai.input[0].content[0].text,/Return a JSON object only/)
  assert.deepEqual(JSON.parse(openai.input[0].content[0].text.split('\n').slice(1).join('\n')),prepared.input)
  assert.ok(openai.instructions.includes('BODY BOTTOM CENTRE'))
  assert.ok(!openai.instructions.includes('EVERY construction prefix'))
  const gemini=buildSpatialRequest('gemini-3.6-flash',prepared)
  assert.equal(gemini.contents[0].parts[1].inlineData.data,'AAAA')
  assert.equal(gemini.config.httpOptions.retryOptions.attempts,1)
})
test('saved camel uses authoritative mapping and reviewed dimensions without modifying source', async () => {
  const analysis=JSON.parse(await readFile(new URL('../generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json',import.meta.url),'utf8'))
  const trace=JSON.parse(await readFile(new URL('../generated/brick-design-traces/0faf5079-d553-430f-9f12-fc95d190b769.json',import.meta.url),'utf8'))
  const before=JSON.stringify([analysis,trace]), rules=await loadBrickRules()
  const prepared=prepareInput(analysis,trace,rules)
  assert.equal(prepared.image.imageBase64,analysis.originalImage.imageBase64)
  assert.equal(prepared.input.imageProvenance.selectedPayloadSha256,prepared.imagePayloadSha256)
  assert.equal(prepared.input.observations.length,7)
  assert.equal(prepared.input.relations.length,13)
  const neck=prepared.input.observations.find(o=>o.id==='neck')
  assert.equal(neck.part,'4066a')
  assert.deepEqual(neck.geometry.bodySizeLdu,{x:80,y:96,z:40})
  const photoOnly=prepareInput(analysis,trace,rules,{includeEvidence:false})
  assert.equal(photoOnly.input.relations,undefined)
  assert.equal(photoOnly.input.observations[0].visionEvidence,undefined)
  assert.equal(JSON.stringify([analysis,trace]),before)
  const bad=structuredClone(trace); bad.inventorySource.mapping=[]
  assert.throws(()=>prepareInput(analysis,bad,rules))
  const wrong=structuredClone(analysis); wrong.image_reference.sha256='wrong'
  assert.throws(()=>prepareInput(wrong,trace,rules),/hash/)
})
test('prepare-only persists full request without provider call or key', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'spatial-prepare-'))
  try {
    const prepared={input:fixture().input,image:{mimeType:'image/png',imageBase64:'AAAA'},geometrySnapshot:[]}
    const record=await runSpatialPlanning(prepared,{model:'gpt-4.1',directory})
    const saved=JSON.parse(await readFile(record.tracePath,'utf8'))
    assert.equal(saved.status,'prepared')
    assert.equal(saved.request.input[0].content[1].image_url,'data:image/png;base64,AAAA')
    assert.equal(saved.request.text.format.type,'json_object')
    assert.match(saved.request.input[0].content[0].text,/Return a JSON object only/)
    assert.equal(saved.rawRequestPath,undefined)
    assert.equal(saved.geometryCorrection,null)
  } finally { await rm(directory,{recursive:true,force:true}) }
})

test('reference hashes compressed image separately from selected original', async () => {
  const analysis=JSON.parse(await readFile(new URL('../generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json',import.meta.url),'utf8'))
  const before=JSON.stringify(analysis)
  const {image,imageProvenance}=prepareReferenceImage(analysis)
  assert.equal(image.imageBase64,analysis.originalImage.imageBase64)
  assert.notEqual(image.sha256,analysis.image_reference.sha256)
  assert.equal(image.bytes,analysis.compression.original.bytes)
  assert.equal(imageProvenance.selectedSource,'originalImage')
  assert.equal(imageProvenance.analysisImageSha256,analysis.image_reference.sha256)
  assert.equal(imageProvenance.originalImageSha256,image.sha256)
  assert.equal(imageProvenance.selectedPayloadSha256,image.sha256)
  assert.equal(JSON.stringify(analysis),before)

  const noOriginal=structuredClone(analysis); delete noOriginal.originalImage
  const selected=prepareReferenceImage(noOriginal)
  assert.equal(selected.image.imageBase64,analysis.image.imageBase64)
  assert.equal(selected.imageProvenance.selectedSource,'image')
  assert.equal(selected.imageProvenance.originalImageSha256,null)

  const wrongReference=structuredClone(analysis); wrongReference.image_reference.sha256='wrong'
  assert.throws(()=>prepareReferenceImage(wrongReference),/hash/)
  const replacedSent=structuredClone(analysis); replacedSent.image.imageBase64=analysis.originalImage.imageBase64
  assert.throws(()=>prepareReferenceImage(replacedSent),/hash/)
  const wrongSentHash=structuredClone(analysis); wrongSentHash.image.sha256='wrong'
  assert.throws(()=>prepareReferenceImage(wrongSentHash),/hash/)
  const brokenOriginal=structuredClone(analysis); brokenOriginal.originalImage.imageBase64='invalid'
  assert.throws(()=>prepareReferenceImage(brokenOriginal))
  const wrongOriginalHash=structuredClone(analysis); wrongOriginalHash.originalImage.sha256='wrong'
  assert.throws(()=>prepareReferenceImage(wrongOriginalHash),/hash/)
})
