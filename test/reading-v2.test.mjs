import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { runV2 } from '../server/reading-v2.mjs'
import { ReadingWorkbench } from '../src/reading-workbench.ts'
import { v2Defaults } from '../src/reading-v2.ts'
const root = new URL('../../story-voice-pipecat-poc-v4/server/', import.meta.url).pathname
const fixture = async name => JSON.parse(await readFile(`${root}src/reading_tracker_v2/fixtures/${name}.json`,'utf8'))
function work() {const w=new ReadingWorkbench(); w.draftReference='春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。'; w.draftSequence=JSON.stringify([['P','春'],['P','春年不绝'],['F','春年不绝小']]);w.load();w.strategy='V2';return w}
test('Python defaults match UI contract, Chunxiao bridge equals direct CLI including actual paths', async () => {
 const defaults=JSON.parse(execFileSync(`${root}.venv-reading-v2/bin/python`,['-B','-c','import json; from dataclasses import asdict; from src.reading_tracker_v2 import Parameters; print(json.dumps(asdict(Parameters())))'],{cwd:root,encoding:'utf8'}))
 assert.deepEqual(v2Defaults,defaults)
 const input=await fixture('chunxiao'), result=await runV2(input)
 const direct=JSON.parse(execFileSync(`${root}.venv-reading-v2/bin/python`,['-B','-m','src.reading_tracker_v2'],{cwd:root,input:JSON.stringify(input),encoding:'utf8'}))
 assert.deepEqual(result,direct)
 const m=result.rows.at(-1).matching
 assert.deepEqual(m.reference_range,[0,5]);assert.equal(m.candidate_cursor,4);assert.equal(m.cost,.65)
 assert.deepEqual(m.path.map(p=>p.op),['exact','phonetic','exact','phonetic','phonetic'])
})
test('Jingyesi finals and repeated Mingyue ambiguity remain Python outputs',async()=>{
 const r=await runV2(await fixture('jingyesi'))
 assert.deepEqual(r.rows.filter(r=>r.matching.stt_type==='F').map(r=>r.matching.candidate_cursor),[4,9,14,19])
 const a=await runV2({reference:r.reference,sequence:[['F','明月']],cursor:4})
 assert.equal(a.rows[0].matching.ambiguous,true);assert.equal(a.rows[0].matching.candidate_cursor,null)
})
test('V2 isolated parameters, explicit Match and stale snapshots, V1 survives Python failure',async()=>{
 const w=work();assert.equal(w.last,undefined)
 await w.matchV2(runV2);const last=w.last
 w.draftV2.near_cost=.5;w.apply();assert.equal(w.last,last);assert.equal(w.stale,true)
 assert.equal(last.v2Config.near_cost,.45)
 await w.matchV2(runV2);assert.equal(w.last.v2.rows.at(-1).matching.cost,.7)
 w.resetParameters();assert.equal(w.stale,true)
 await assert.rejects(w.matchV2(()=>runV2({}, {python:'/missing/python'})),/不可用/)
 assert.equal(w.loading,false)
 w.strategy='V1';w.match();assert.equal(w.last.results.find(r=>r.strategy==='V1').rows.at(-1).state.cursor,0)
})
test('older async completion cannot overwrite newer request or V1 results',async()=>{
 const w=work();let first,second
 const a=w.matchV2(()=>new Promise(r=>first=r)), b=w.matchV2(()=>new Promise(r=>second=r))
 second({rows:[]});await b;const last=w.last;first({rows:[1]});assert.equal(await a,false);assert.equal(w.last,last)
 const c=w.matchV2(()=>new Promise(r=>first=r));w.strategy='V1';w.match();first({rows:[]});await c;assert.equal(w.last.strategy,'V1')
})
test('CLI invalid parameters, timeout and missing executable give errors',async()=>{
 await assert.rejects(runV2({reference:'春',sequence:[['F','春']],parameters:{near_cost:9}}),/require/)
 await assert.rejects(runV2({reference:'春',sequence:[['F','春']]},{timeout:1}),/超时/)
})
test('input changes during V2 computation retain actual snapshot and mark stale',async()=>{
 const w=work();let resolve
 const pending=w.matchV2(()=>new Promise(r=>resolve=r))
 w.draftReference='床前明月光';w.load()
 resolve({rows:[]});await pending
 assert.match(w.last.input.reference,/春眠/);assert.equal(w.stale,true)
 assert.throws(()=>w.match(),/异步/)
})
