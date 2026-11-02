import {canonicalGeometryManifest,canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {multiImagePrompt,multiImagePromptVersion,multiImageSchema} from '../server/magnetic-multi-image-vision.mjs'
import {evidenceSchema,buildVisibleRequest,observationPrompt,planningPrompt} from '../server/magnetic-visible3d-vision.mjs'
import {prompt,recognitionRequest,multiRecognitionRequest} from '../server/magnetic-intake-vision.mjs'
import {parseVisibleEvidence} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {assertImageEvidence} from '../src/magnetic-tiles/intake/image-set.ts'
import {requestOpenaiResponse} from '../server/openai-responses.mjs'
import {png} from './magnetic-visible3d-fixtures.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/multi-image-color-contract.json',import.meta.url),'utf8'))
// In-memory schema-test placeholder ONLY. It is not a restored Recognition
// Result, a measured physical color, an import, or a name-to-hex conversion.
function contractCopy(){const e=structuredClone(fixture.originalEvidence);e.observations.forEach(o=>o.color='#808080');return e}
const prepared={source:fixture.source,image:png,images:fixture.source.images.map(i=>({...i,...i.view,...png})),input:{source:{id:fixture.source.id,hash:fixture.source.hash},referenceImageId:fixture.source.primaryImageId,images:fixture.source.images,analysisMode:'visible3d',catalog:fixture.catalog}}
const hex='^#[0-9a-fA-F]{6}$'
test('independent multi-image prompt/version and color schema match strict canonical color expectations',()=>{
 assert.equal(multiImagePromptVersion,'magnetic-multi-image-analysis-v1.1-color-contract');assert.notEqual(multiImagePromptVersion,fixture.originalPromptVersion);assert.match(multiImagePrompt,/#RRGGBB|SIX hexadecimal digits/);assert.match(multiImagePrompt,/red\/pink/);assert.match(multiImagePrompt,/uncertainty\/evidence/)
 const original=structuredClone(evidenceSchema),schema=multiImageSchema(evidenceSchema,'3d',fixture.source.images.map(i=>i.sourceId),fixture.source.primaryImageId)
 assert.equal(schema.properties.observations.items.properties.color.pattern,hex);assert.equal(schema.properties.observations.items.properties.id.pattern,undefined,'do not mutate shared STRING nodes');assert.deepEqual(evidenceSchema,original,'single-image schema remains untouched')
})
test('OpenAI multi-image analysis uses actual strict Structured Outputs, correct null alternatives and closed objects',()=>{
 const r=buildVisibleRequest('gpt-6.1-sol',prepared,'analysis'),f=r.text.format;assert.equal(f.type,'json_schema');assert.equal(f.strict,true);assert.equal(r.reasoning.effort,'medium');assert.equal(r.model,'gpt-6.1-sol');assert.equal(r.input[0].content.filter(p=>p.type==='input_image').length,4);assert.equal(f.schema.properties.observations.items.properties.color.pattern,hex);assert.equal(f.schema.properties.observations.items.properties.color.minLength,7);assert.equal(f.schema.properties.observations.items.properties.color.maxLength,7)
 let nullable=0
 function walk(s){assert.ok(!Object.hasOwn(s,'nullable'),'Gemini nullable must not leak to OpenAI');if(s.anyOf){assert.ok(s.anyOf.some(n=>n.type==='null'));nullable++;s.anyOf.forEach(walk);return}assert.equal(s.type,s.type.toLowerCase());if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual([...s.required].sort(),Object.keys(s.properties).sort());Object.values(s.properties).forEach(walk)}if(s.items)walk(s.items)}
 walk(f.schema);assert.ok(nullable>=4,'bbox, per-image bbox, feature refs and angle range remain nullable');assert.equal(f.schema.properties.observations.items.properties.bbox.anyOf[0].type,'array')
 assert.deepEqual(f.schema.properties.referenceImageId.enum,[fixture.source.primaryImageId]);assert.deepEqual(f.schema.properties.observations.items.properties.imageEvidence.items.properties.imageId.enum,fixture.source.images.map(i=>i.sourceId))
})
test('Gemini and planar multi-image output contracts require the same hex colors without changing single or Planning formats',()=>{
 const g=buildVisibleRequest('gemini-3.6-flash',prepared,'analysis');assert.equal(g.config.responseSchema.properties.observations.items.properties.color.pattern,hex);assert.equal(g.config.responseSchema.properties.observations.items.properties.bbox.nullable,true)
 const p=multiRecognitionRequest('gpt-6.1-sol',prepared.images,fixture.source);assert.equal(p.text.format.type,'json_schema');assert.equal(p.text.format.schema.properties.observations.items.properties.color.pattern,hex)
 const single={image:png,input:{catalog:fixture.catalog}},r=buildVisibleRequest('gpt-6.1-sol',single,'analysis');assert.equal(r.text.format.type,'json_object');assert.ok(r.instructions.startsWith(observationPrompt));assert.equal(recognitionRequest('gpt-6.1-sol',png).text.format.type,'json_schema')
 prepared.input.geometryContract=canonicalGeometryManifest(fixture.catalog.map(canonicalProfileSnapshot));const plan=buildVisibleRequest('gpt-6.1-sol',prepared,'plan');assert.equal(plan.text.format.type,'json_object');assert.ok(plan.instructions.startsWith(planningPrompt))
 assert.equal(createHash('sha256').update(prompt).digest('hex'),'4ade987533137ac510ef46523c202b5617c29d51587840cbeb6ca2ee8f6ee8fb');assert.equal(createHash('sha256').update(observationPrompt).digest('hex'),'d9cfbad84d3e582ac2c16fac5ac06e6165832cb0b2a949437e853998a39b9366')
})
test('all 23 original colors remain rejected; changing ONLY color in a labeled in-memory copy passes full Recognition validation',()=>{
 const before=structuredClone(fixture),v=fixture.originalEvidence;assert.equal(v.observations.length,23);assert.equal(fixture.originalOutputFormat.type,'json_object');assert.ok(v.observations.every(o=>!new RegExp(hex).test(o.color)));assert.equal(v.observations.find(o=>o.id==='t21').color,'red/pink');assert.throws(()=>parseVisibleEvidence(v),/颜色需要 #RRGGBB/)
 const c=contractCopy();assert.deepEqual(parseVisibleEvidence(c),c);assert.doesNotThrow(()=>assertImageEvidence(c,fixture.source));for(let i=0;i<c.observations.length;i++){const original=v.observations[i],copy=c.observations[i];assert.deepEqual({...copy,color:original.color},original);for(const p of copy.profileCandidates)assert.ok(fixture.catalog.some(c=>c.id===p.profileId&&c.version===p.profileVersion))}assert.deepEqual(fixture,before,'never rewrite original evidence or provenance')
})
test('names, ambiguous colors, shorthand, alpha, null and malformed values stay invalid; legal mixed-case RGB remains exact',()=>{
 for(const color of ['purple','blue','red/pink','unknown','#123','123456','#12345678','rgb(255,0,0)',null,123,' #123456','#GG0000','#12345g','#123456\n']){const v=contractCopy();v.observations[0].color=color;assert.throws(()=>parseVisibleEvidence(v),/颜色需要 #RRGGBB/);assert.ok(typeof color!=='string'||!new RegExp(hex).test(color))}
 for(const color of ['#ABCDEF','#abcdef','#12aB90','#000000','#FFFFFF']){const v=contractCopy();v.observations[0].color=color;assert.equal(parseVisibleEvidence(v).observations[0].color,color,'no normalization or hidden mapping')}
})
test('the final HTTP body carries the hex pattern and strict schema, with exactly one intercepted fetch and no network',async t=>{
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='offline-contract-test-only';t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old})
 const r=buildVisibleRequest('gpt-6.1-sol',prepared,'analysis'),stop=Error('intercepted before network');let calls=0
 await assert.rejects(requestOpenaiResponse(r,{},async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.properties.observations.items.properties.color.pattern,hex);assert.equal(body.input[0].content.filter(p=>p.type==='input_image').length,4);assert.ok(body.instructions.includes(multiImagePrompt));throw stop}),e=>e===stop)
 assert.equal(calls,1)
})
