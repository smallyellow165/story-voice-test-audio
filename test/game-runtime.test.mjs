import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseGame, createGameRuntime } from '../src/games/game-runtime.ts'
const game = parseGame(JSON.parse(await readFile(new URL('../src/games/game-1.json',import.meta.url),'utf8')))
const bindings={ring_1:'ring_1',ring_2:'ring_2'}
const facts=(left,right)=>({ringIds:['ring_1','ring_2'],leftFootRingId:left,rightFootRingId:right,
 leftFootStatus:left?'IN':'OUT',rightFootStatus:right?'IN':'OUT'})
test('JSON tasks evaluate both feet independently; next/reset and live reversal',()=>{
 const runtime=createGameRuntime(game)
 const check=(f,expected)=>assert.equal(runtime.read(f,bindings).result,expected)
 check(facts('ring_1',null),'SUCCESS')
 check(facts('ring_2',null),'NOT_YET')
 runtime.next();check(facts(null,'ring_2'),'SUCCESS')
 runtime.next();check(facts('ring_1','ring_2'),'NOT_YET');check(facts('ring_1','ring_1'),'SUCCESS')
 runtime.next();check(facts('ring_1','ring_2'),'SUCCESS');check(facts('ring_2','ring_1'),'SUCCESS')
 check(facts('ring_2','ring_2'),'NOT_YET');check(facts(null,'ring_2'),'NOT_YET')
 check({...facts('ring_1','ring_2'),leftFootStatus:'AMBIGUOUS'},'NOT_YET')
 check({...facts('ring_1','ring_2'),rightFootStatus:'UNKNOWN'},'NOT_YET')
 check({...facts('ring_1','ring_2'),ringIds:[]},'NOT_YET')
 runtime.next();assert.equal(runtime.read(facts(null,null),bindings).index,3)
 runtime.reset();assert.equal(runtime.read(facts(null,null),bindings).index,0)
 assert.equal(runtime.read(facts('ring_1','ring_2'),{}).result,'NOT_YET')
})
test('invalid rule fails explicitly instead of becoming a success',()=>{
 assert.throws(()=>parseGame({...game,tasks:[{id:'bad',description:'bad',condition:{type:'unknown'}}]}))
 assert.throws(()=>parseGame({...game,tasks:[]}))
})
