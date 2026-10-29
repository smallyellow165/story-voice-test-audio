import test from 'node:test'
import assert from 'node:assert/strict'
import {GalleryActivity} from '../src/brick-gallery/activity.ts'
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222',planId='33333333-3333-4333-8333-333333333333'
const detail=(galleryId=id,title='公鸡')=>({item:{id:galleryId,title,description:'rooster',buildPlanId:planId,layoutSelectionId:other},canBuild:true,plan:{build_plan_id:planId,steps:[{stepId:'one',description:'一'},{stepId:'two',description:'二'},{stepId:'three',description:'三'}]}})
function fixture(){
 Object.assign(globalThis,{location:{search:''},window:{removeEventListener(){}}})
 const events=[],g=new GalleryActivity({instanceId:'gallery-test',onMessage:m=>events.push(m)})
 let rows=[{item:detail().item}],data=detail(),offline=false
 g.read=async route=>{if(offline)throw Error('503 unavailable');return route==='items'?{items:rows,warnings:[]}:structuredClone(data)}
 let finish=true
 g.subscribe(()=>{if(finish)queueMicrotask(()=>g.visualDone())})
 function command(action,args={},cmdId=crypto.randomUUID(),reference=g.snapshot()){
  const c={v:1,id:cmdId,instanceId:'gallery-test',kind:'command',name:'gallery_control',sessionEpoch:'epoch',payload:{expectedRunId:reference.runId,expectedTaskAttemptId:reference.taskAttemptId,baseRevision:reference.revision,args:{action,...args}}}
  g.receive(c);return c
 }
 const result=async c=>{for(let i=0;i<40;i++){const r=events.findLast(m=>m.payload.replyTo===c.id);if(r)return r.payload;await new Promise(r=>setImmediate(r))}throw Error('missing receipt')}
 return {g,events,command,result,rows(v){rows=v},data(v){data=v},offline(){offline=true},pause(){finish=false}}
}
test('empty, unique, ambiguous search; exact Gallery identity and saved-plan refusal',async()=>{
 const f=fixture();f.rows([]);await f.g.apply({action:'search_models',query:'公鸡'});assert.equal(f.g.id,null);assert.deepEqual(f.g.snapshot().gallery.candidates,[])
 f.rows([{item:detail().item},{item:detail(other).item}]);await f.g.apply({action:'search_models',query:'公鸡'});assert.equal(f.g.id,null);assert.equal(f.g.snapshot().gallery.candidates.length,2)
 f.rows([{item:detail().item}]);await f.g.apply({action:'search_models',query:'公鸡'});assert.equal(f.g.id,id)
 f.data({...detail(),canBuild:false,plan:null});await assert.rejects(f.g.apply({action:'start_build'}),/saved_build_plan_required/)
 f.data(detail(other));await assert.rejects(f.g.apply({action:'select_model',galleryId:id}),/identity_mismatch/);f.g.dispose()
})
test('actual visual completion gates receipts; duplicate IDs, independent next turns, bounds, progress and replay',async()=>{
 const f=fixture();await f.g.apply({action:'select_model',galleryId:id});await f.g.apply({action:'start_build'});assert.equal(f.g.snapshot().gallery.currentStep,1)
 const first=f.command('next_step');assert.equal((await f.result(first)).status,'applied');assert.equal(f.g.step,1)
 f.g.receive(first);await f.result(first);assert.equal(f.g.step,1)
 const second=f.command('next_step');assert.equal((await f.result(second)).status,'applied');assert.equal(f.g.step,2);assert.equal(f.g.snapshot().gallery.remainingSteps,0)
 assert.match((await f.result(f.command('next_step'))).error,/last_step/)
 // A boundary rejection does not invalidate a successfully rendered player.
 await f.g.apply({action:'start_build'});assert.match((await f.result(f.command('previous_step'))).error,/first_step/)
 await f.g.apply({action:'start_build'});const before=f.g.replay;await f.result(f.command('replay_step'));assert.equal(f.g.replay,before+1)
 f.pause();const pending=f.command('next_step');await new Promise(r=>setImmediate(r));assert.equal(f.events.some(m=>m.payload.replyTo===pending.id),false)
 f.g.receive(pending);assert.equal(f.g.step,1)
 const busy=f.command('next_step');assert.match((await f.result(busy)).error,/player_busy/)
 f.g.visualDone();assert.equal((await f.result(pending)).status,'applied')
 f.g.dispose()
})
test('stale refs, player absent, service failure, disposal and authority loss reject without retargeting',async()=>{
 const f=fixture();assert.match((await f.result(f.command('next_step'))).error,/player_not_loaded/)
 await f.g.apply({action:'select_model',galleryId:id});const old=f.g.snapshot();await f.g.apply({action:'start_build'})
 assert.match((await f.result(f.command('next_step',{},'stale',old))).error,/stale_game_input/);assert.equal(f.g.step,0)
 await f.g.apply({action:'finish_build'});assert.equal(f.g.mode,'detail')
 f.offline();assert.match((await f.result(f.command('search_models'))).error,/503/)
 f.g.dispose();const count=f.events.length;f.command('next_step');assert.equal(f.events.length,count)
 const next=fixture();await next.g.apply({action:'select_model',galleryId:id});await next.g.apply({action:'start_build'});next.pause()
 const pending=next.command('next_step');next.g.setEnabled(false);assert.equal((await next.result(pending)).status,'rejected');next.g.dispose()
})
test('late visual callback cannot acknowledge a new render; restoration keeps official identity',async()=>{
 const f=fixture();await f.g.apply({action:'select_model',galleryId:id});await f.g.apply({action:'start_build'});
 const saved=f.g.snapshot();f.pause();const pending=f.command('next_step');const version=f.g.renderVersion;
 f.g.visualDone('renderer_failure',version);assert.equal((await f.result(pending)).status,'rejected');
 const retry=f.command('start_build');await new Promise(r=>setImmediate(r));
 f.g.visualDone(undefined,version);assert.equal(f.events.some(m=>m.payload.replyTo===retry.id),false);
 f.g.visualDone();assert.equal((await f.result(retry)).status,'applied');
 const restored=fixture();restored.g.restore({...saved,instanceId:'gallery-test'});
 assert.equal(restored.g.snapshot().gallery.busy,true);
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(restored.g.snapshot().gallery.galleryId,id);assert.equal(restored.g.snapshot().gallery.currentStep,1);
 f.g.dispose();restored.g.dispose();
})
test('startup never advertises ready before the initial Gallery request settles',async()=>{
 const f=fixture();let release;
 f.g.read=()=>new Promise(resolve=>{release=resolve});
 const started=f.g.start();assert.equal(f.events.some(m=>m.name==='ready'),false);
 assert.equal(f.events[0].payload.snapshot.gallery.busy,true);
 release({items:[],warnings:[]});await started;
 assert.equal(f.events.at(-1).name,'ready');assert.equal(f.events.at(-1).payload.snapshot.gallery.busy,false);
 f.g.dispose();
})
