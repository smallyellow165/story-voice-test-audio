import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,cp,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
import {createSelectedSpatialStore} from '../server/brick-selected-spatial.mjs'
import {createSourceImageStore} from '../server/brick-source-images.mjs'
import {createBuildOrderStore} from '../server/brick-build-order.mjs'
import {createWorkflowHistory} from '../server/brick-workflow-history.mjs'
import {createBrickReverse} from '../server/brick-reverse.mjs'
const penguin='c34c5c9a-b513-4ce5-b87b-47cbd96154f5',camel='eca76c4b-a188-4b39-a644-1fbd086ebe19'
async function fixture(t,checkpoint=async()=>{}){
 const root=await mkdtemp(path.join(tmpdir(),'layout-adoption-'));t.after(()=>rm(root,{recursive:true,force:true}))
 for(const name of ['brick-source-images','brick-reverse','brick-spatial-traces','brick-spatial-geometry','brick-spatial-selections','brick-parts-inputs','brick-build-plans'])await cp('generated/'+name,path.join(root,name),{recursive:true})
 const sourceImages=createSourceImageStore(path.join(root,'brick-source-images')),reverse=createBrickReverse(path.join(root,'brick-reverse'),{sourceImages,getCatalog:async()=>({colors:[]})})
 const make=(adoptionCheckpoint=checkpoint)=>{const selectedSpatial=createSelectedSpatialStore(root,{reverse,sourceImages,adoptionCheckpoint});return {choices:selectedSpatial,service:createSpatialWorkflow(root,{reverse,selectedSpatial,runPlanning:()=>assert.fail('no model'),execute:()=>assert.fail('no geometry')})}}
 const f={root,make,sourceImages,reverse,...make()}
 f.body=async(gid=penguin,candidateId='candidate-1')=>{const g=JSON.parse(await readFile(path.join(root,'brick-spatial-geometry',gid+'.json'))),scope=await f.choices.read(g.planId);return {requestId:randomUUID(),geometryId:gid,candidateId,planId:g.planId,selectionKey:scope.selectionKey,expectedRevision:scope.choice.revision}}
 f.adopt=b=>f.service.dispatch('POST','select-layout',b)
 return f
}
test('real Penguin and Camel adopt exact sources; restart retry is idempotent and old Penguin layout/build remain byte-identical',async t=>{
 const f=await fixture(t),files=['brick-spatial-selections/77d99b0e-9c62-4ba6-b655-bcf1a8db5828.json','brick-build-plans/426f27c7-a9a9-4ee9-9965-39e1cd9e30f8.json'],before=await Promise.all(files.map(x=>readFile(path.join(f.root,x))))
 for(const gid of [penguin,camel]){
  const b=await f.body(gid),r=await f.adopt(b),g=JSON.parse(await readFile(path.join(f.root,'brick-spatial-geometry',gid+'.json')))
  assert.equal(r.state,'complete');assert.equal((await f.choices.read(b.planId)).choice.selectedSpatialPlanId,b.planId)
  const layout=JSON.parse(await readFile(path.join(f.root,'brick-spatial-selections',r.selectionId+'.json')))
  assert.equal(layout.geometryId,gid);assert.equal(layout.planId,g.planId);assert.equal(layout.candidateId,'candidate-1');assert.deepEqual(layout.assembly,g.candidates[0].assembly)
  const scope=await f.choices.read(b.planId),buildOrder=createBuildOrderStore(f.root)
  const history=await createWorkflowHistory(f.root,{sourceImages:f.sourceImages,reverse:f.reverse,selectedSpatial:f.choices,buildOrder}).read(scope.identity.sourceImageId)
  assert.equal(history.nodes.find(n=>n.stage==='Layout Selection'&&n.id===r.selectionId)?.parent,'Candidate:'+gid+'/candidate-1')
  assert.equal((await buildOrder.dispatch('GET','sources/'+r.selectionId)).geometryId,gid)
  assert.deepEqual(await f.make().service.dispatch('POST','select-layout',b),r)
  await assert.rejects(f.adopt({...b,candidateId:'candidate-2'}),/不同输入/)
 }
 assert.deepEqual(await Promise.all(files.map(x=>readFile(path.join(f.root,x)))),before)
})
test('different candidates save separately; stale CAS and concurrent adoption cannot overwrite',async t=>{
 const f=await fixture(t),a=await f.body(),b={...await f.body(),candidateId:'candidate-2'}
 const outcomes=await Promise.allSettled([f.adopt(a),f.make().service.dispatch('POST','select-layout',b)])
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1)
 const c=await f.body(penguin,'candidate-3');await f.adopt(c)
 const stale=await f.body();await f.adopt(await f.body(penguin,'candidate-4'));await assert.rejects(f.adopt(stale),e=>e.statusCode===409)
})
for(const phase of ['layout-saved','choice-saved'])test('partial failure '+phase+' blocks competing writes and resumes original request once',async t=>{
 let fail=true;const f=await fixture(t,async stage=>{if(fail&&stage===phase)throw Error('injected failure')})
 const b=await f.body();await assert.rejects(f.adopt(b),/injected/)
 const scope=await f.choices.read(b.planId)
 await assert.rejects(f.choices.select(b.planId,{selectionKey:b.selectionKey,expectedRevision:scope.choice.revision}),/未完成/)
 await assert.rejects(f.adopt({...b,requestId:randomUUID(),expectedRevision:scope.choice.revision}),/未完成/)
 fail=false;const r=await f.make().service.dispatch('POST','select-layout',b);assert.equal(r.state,'complete');assert.equal(r.choice.revision,1)
 assert.equal((await readdir(path.join(f.root,'brick-spatial-selections'))).filter(x=>x===b.requestId+'.json').length,1)
 const next=await f.body(penguin,'candidate-2');await f.adopt(next)
 assert.deepEqual(await f.adopt(b),r);assert.equal((await f.choices.read(b.planId)).choice.revision,2)
})
test('prepared Spatial, invalid candidate and forged plan associations reject without selection changes',async t=>{
 const f=await fixture(t),b=await f.body();await assert.rejects(f.adopt({...b,candidateId:'missing'}))
 await assert.rejects(f.adopt({...b,planId:randomUUID()}),/关联/)
 const file=path.join(f.root,'brick-spatial-traces',b.planId+'.json'),p=JSON.parse(await readFile(file));p.status='prepared';await writeFile(file,JSON.stringify(p));await assert.rejects(f.adopt(b),/Validator/)
 assert.equal((await f.choices.read(b.planId)).choice.revision,0)
})
test('same Analysis different genuine plan branch switches choice without rewriting lineage',async t=>{
 const f=await fixture(t),b=await f.body();await f.adopt(b)
 const p=JSON.parse(await readFile(path.join(f.root,'brick-spatial-traces',b.planId+'.json'))),g=JSON.parse(await readFile(path.join(f.root,'brick-spatial-geometry',b.geometryId+'.json')))
 p.id=randomUUID();g.id=randomUUID();g.planId=p.id
 await writeFile(path.join(f.root,'brick-spatial-traces',p.id+'.json'),JSON.stringify(p));await writeFile(path.join(f.root,'brick-spatial-geometry',g.id+'.json'),JSON.stringify(g))
 await f.adopt(await f.body(g.id));assert.equal((await f.choices.read(b.planId)).choice.selectedSpatialPlanId,p.id)
 assert.equal(JSON.parse(await readFile(path.join(f.root,'brick-spatial-selections',b.requestId+'.json'))).planId,b.planId)
})
test('actual UI adoption handler retries same operation after failure and duplicate click without a second write API',async()=>{
 const ts=await import('typescript'),source=await readFile(new URL('../src/brick-test/SpatialAssemblyPanel.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let fn;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='adoptLayout')fn=n;ts.forEachChild(n,visit)}visit(ast)
 const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const storage=new Map(),bodies=[],notices=[];let failing=true
 const ctx={geometry:{id:camel,planId:'plan'},candidate:'candidate-1',layoutChoice:{eligible:true,selectionKey:'key',choice:{revision:0}},crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},action:async f=>f(),setChoiceRevision:()=>{},setSavedSelections:()=>{},setLayoutChoice:()=>{},setNotice:n=>notices.push(n),request:async(route,body)=>{
  if(route==='select-layout'){bodies.push(body);if(failing)throw Error('network failure');return {state:'complete',selectionId:'layout',planId:'plan',choice:{revision:1}}}
  if(route.startsWith('selections?'))return {items:[]}
  if(route==='plan-choice/plan')return {choice:{revision:1,selectedSpatialPlanId:'plan'}}
  assert.fail(route)
 }}
 const adopt=Function(...Object.keys(ctx),code+';return adoptLayout')(...Object.values(ctx))
 await assert.rejects(adopt(),/未确认整体完成/);assert.deepEqual(notices,[])
 failing=false;await adopt();ctx.layoutChoice.choice.revision=1;await adopt()
 assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[1],bodies[2]);assert.match(notices.at(-1),/已同步采用/)
 assert.ok(source.includes('<SpatialPlanningHistory choiceRevision={choiceRevision}'))
})
